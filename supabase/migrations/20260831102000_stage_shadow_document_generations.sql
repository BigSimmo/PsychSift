-- U04 UNAPPLIED storage and read-only capture. Not an accepted operational migration.
-- Capture consumes independently admitted profiles; it does not approve them.
-- Full preservation, retention and transactional shadow writers remain pending.

-- Page identity is separate from the non-page artifact-null compatibility rule.
-- A present JSON-null page marker is ambiguous: refuse before DDL or backfill.
do $u04_pages$
begin
  if exists (
    select 1 from public.document_pages
    where pg_catalog.jsonb_typeof(metadata) is distinct from 'object'
      or (metadata ? 'index_generation_id' and not coalesce(
        pg_catalog.jsonb_typeof(metadata -> 'index_generation_id') = 'string'
        and pg_catalog.length(metadata ->> 'index_generation_id') = 36
        and metadata ->> 'index_generation_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$', false))
  ) then
    raise exception 'shadow_page_generation_provenance_ambiguous' using errcode = '23514';
  end if;
end
$u04_pages$;

-- Accepted U03 claim/terminal transitions persist null after scheduling is consumed.
alter table public.ingestion_jobs alter column next_run_at drop not null;

alter table public.document_pages add column index_generation_id uuid;
update public.document_pages
set index_generation_id = (metadata ->> 'index_generation_id')::uuid
where index_generation_id is null
  and metadata ? 'index_generation_id'
  and metadata -> 'index_generation_id' <> 'null'::jsonb;

alter table public.document_pages
  drop constraint document_pages_document_id_page_number_key,
  add constraint document_pages_generation_ordinal_key unique (document_id, index_generation_id, page_number),
  add constraint document_pages_generation_provenance check (coalesce(
    pg_catalog.jsonb_typeof(metadata) = 'object' and (
      (index_generation_id is null and
        not (metadata ? 'index_generation_id'))
      or (index_generation_id is not null and case when pg_catalog.jsonb_typeof(metadata -> 'index_generation_id') = 'string'
        and pg_catalog.length(metadata ->> 'index_generation_id') = 36
        and metadata ->> 'index_generation_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then index_generation_id = (metadata ->> 'index_generation_id')::uuid else false end)
    ), false));
create unique index document_pages_legacy_ordinal_key on public.document_pages (document_id, page_number) where index_generation_id is null;


-- Byte/shape checks only: these private predicates confer no source or operation authority.
create or replace function public.shadow_generation_envelope_valid(p_envelope jsonb, p_domain text, p_encoding text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_payload text; v_bytes bytea; v_digest text;
begin
  if not coalesce(pg_catalog.jsonb_typeof(p_envelope) = 'object'
    and p_envelope ?& array['version','domain','encoding','canonicalPayload','digest']
    and p_envelope - array['version','domain','encoding','canonicalPayload','digest'] = '{}'::jsonb
    and p_envelope -> 'version' = '1'::jsonb
    and pg_catalog.jsonb_typeof(p_envelope -> 'domain') = 'string'
    and p_envelope ->> 'domain' = p_domain
    and p_domain in ('plan','inventory','projection','baseline','control','member_receipt','wave_receipt','evaluation_report')
    and pg_catalog.jsonb_typeof(p_envelope -> 'encoding') = 'string'
    and p_envelope ->> 'encoding' = p_encoding
    and p_encoding in ('node-json-v1','pg-jsonb-text-v1')
    and pg_catalog.jsonb_typeof(p_envelope -> 'canonicalPayload') = 'string'
    and pg_catalog.jsonb_typeof(p_envelope -> 'digest') = 'string'
    and p_envelope ->> 'digest' ~ '^sha256:[0-9a-f]{64}$', false) then return false; end if;
  v_payload := p_envelope ->> 'canonicalPayload';
  -- Parse for shape without replacing the retained precision-bearing raw string.
  begin
    if pg_catalog.jsonb_typeof(v_payload::jsonb) is distinct from 'object'
      or v_payload::jsonb = '{}'::jsonb then return false; end if;
  exception when invalid_text_representation then return false;
  end;
  v_bytes := pg_catalog.convert_to(
    E'U04-SHADOW/1\n' || p_domain || E'\n' || p_encoding || E'\n'
    || pg_catalog.octet_length(pg_catalog.convert_to(v_payload,'UTF8'))::text || E'\n' || v_payload, 'UTF8');
  v_digest := 'sha256:' || pg_catalog.encode(extensions.digest(v_bytes,'sha256'),'hex');
  return (p_envelope ->> 'digest') = v_digest;
end $$;
alter function public.shadow_generation_envelope_valid(jsonb,text,text) owner to postgres;
revoke all on function public.shadow_generation_envelope_valid(jsonb,text,text) from public, anon, authenticated, service_role;

-- Structural manifest validation retains every slot/declaration, including known-empty
-- and unavailable declarations. Full evidence/producer/population admission is a later writer prerequisite.
create or replace function public.shadow_generation_manifest_shape(p_manifest jsonb, p_first_token uuid)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_slots constant jsonb := '[{"family":"pages","groups":[{"groupKey":"worker_core"}]},{"family":"native_structure","groups":[{"groupKey":"worker_native"}]},{"family":"chunks","groups":[{"groupKey":"worker_core"}]},{"family":"images","groups":[{"groupKey":"worker_core"}]},{"family":"table_facts","groups":[{"groupKey":"worker_core"}]},{"family":"embedding_fields","groups":[{"groupKey":"worker_core"}]},{"family":"index_units","groups":[{"groupKey":"worker_core"},{"groupKey":"deep_memory"}]},{"family":"sections","groups":[{"groupKey":"deep_memory"}]},{"family":"memory_cards","groups":[{"groupKey":"deep_memory"}]},{"family":"summary","groups":[{"groupKey":"enrichment"}]},{"family":"generated_labels","groups":[{"groupKey":"enrichment"}]},{"family":"quality","groups":[{"groupKey":"worker_core"}]},{"family":"document_metadata","groups":[{"groupKey":"projection_aggregate"}]},{"family":"producer_aliases","groups":[{"groupKey":"deep_memory"}]},{"family":"private_objects","groups":[{"groupKey":"private_objects"}]},{"family":"attempt_control","groups":[{"groupKey":"control"}]},{"family":"cache_inputs","groups":[{"groupKey":"cache"}]},{"family":"repair_audit_inputs","groups":[{"groupKey":"repair"}]}]'::jsonb;
  v_family jsonb; v_group jsonb; v_expected jsonb; v_declaration jsonb;
  v_i integer; v_j integer;
begin
  if not coalesce(pg_catalog.jsonb_typeof(p_manifest) = 'object'
    and p_manifest ?& array['version','documentId','candidateGenerationId','jobId','families']
    and p_manifest - array['version','documentId','candidateGenerationId','jobId','families'] = '{}'::jsonb
    and p_manifest -> 'version' = '1'::jsonb
    and pg_catalog.jsonb_typeof(p_manifest -> 'families') = 'array', false) then return false; end if;
  if pg_catalog.jsonb_array_length(p_manifest -> 'families') <> 18 then return false; end if;
  for v_i in 0..17 loop
    v_family := p_manifest -> 'families' -> v_i;
    v_expected := v_slots -> v_i;
    if not coalesce(pg_catalog.jsonb_typeof(v_family) = 'object'
      and v_family ?& array['family','groups'] and v_family - array['family','groups'] = '{}'::jsonb
      and v_family -> 'family' = v_expected -> 'family'
      and pg_catalog.jsonb_typeof(v_family -> 'groups') = 'array', false) then return false; end if;
    if pg_catalog.jsonb_array_length(v_family -> 'groups') <> pg_catalog.jsonb_array_length(v_expected -> 'groups')
      then return false; end if;
    for v_j in 0..pg_catalog.jsonb_array_length(v_expected -> 'groups') - 1 loop
      v_group := v_family -> 'groups' -> v_j;
      if not coalesce(pg_catalog.jsonb_typeof(v_group) = 'object'
        and v_group ?& array['groupKey','state','declaration']
        and v_group - array['groupKey','state','declaration'] = '{}'::jsonb
        and v_group -> 'groupKey' = v_expected -> 'groups' -> v_j -> 'groupKey'
        and v_group ->> 'state' in ('pending','declared'), false) then return false; end if;
      if v_group ->> 'state' = 'pending' then
        if v_group -> 'declaration' is distinct from 'null'::jsonb then return false; end if;
      else
        v_declaration := v_group -> 'declaration';
        if not coalesce(p_first_token is not null
          and pg_catalog.jsonb_typeof(v_declaration) = 'object'
          and v_declaration ?& array['firstLeaseToken','producer','artifactGenerationId','population']
          and v_declaration - array['firstLeaseToken','producer','artifactGenerationId','population'] = '{}'::jsonb
          and pg_catalog.jsonb_typeof(v_declaration -> 'firstLeaseToken') = 'string'
          and v_declaration ->> 'firstLeaseToken' = p_first_token::text
          and pg_catalog.jsonb_typeof(v_declaration -> 'producer') = 'object'
          and pg_catalog.jsonb_typeof(v_declaration -> 'population') = 'object'
          and pg_catalog.jsonb_typeof(v_declaration -> 'artifactGenerationId') in ('string','null'),
          false) then return false; end if;
        if v_declaration -> 'artifactGenerationId' <> 'null'::jsonb and not coalesce(
          pg_catalog.length(v_declaration ->> 'artifactGenerationId') = 36
          and v_declaration ->> 'artifactGenerationId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
          false) then return false; end if;
        if not coalesce(
          (v_declaration -> 'producer') ?& array['name','version','outputManifestDigest']
          and (v_declaration -> 'producer') - array['name','version','outputManifestDigest'] = '{}'::jsonb
          and pg_catalog.jsonb_typeof(v_declaration -> 'producer' -> 'name') = 'string'
          and pg_catalog.btrim(v_declaration -> 'producer' ->> 'name') <> ''
          and pg_catalog.jsonb_typeof(v_declaration -> 'producer' -> 'version') in ('string','null')
          and pg_catalog.jsonb_typeof(v_declaration -> 'producer' -> 'outputManifestDigest') = 'string'
          and pg_catalog.length(v_declaration -> 'producer' ->> 'outputManifestDigest') = 71
          and v_declaration -> 'producer' ->> 'outputManifestDigest' ~ '^sha256:[0-9a-f]{64}$'
          and v_declaration -> 'population' ->> 'tag' in ('known','unknown','unavailable'), false)
          then return false; end if;
        if v_declaration -> 'population' ->> 'tag' = 'known' then
          if not coalesce(
            (v_declaration -> 'population') ?& array['tag','expectedUnits','basis','reason']
            and (v_declaration -> 'population') - array['tag','expectedUnits','basis','reason'] = '{}'::jsonb
            and pg_catalog.jsonb_typeof(v_declaration -> 'population' -> 'expectedUnits') = 'array'
            and pg_catalog.jsonb_typeof(v_declaration -> 'population' -> 'basis') = 'array', false)
            then return false; end if;
          if pg_catalog.jsonb_array_length(v_declaration -> 'population' -> 'expectedUnits') = 0 then
            if v_declaration -> 'population' -> 'reason' is distinct from '"no_units_expected"'::jsonb
              then return false; end if;
          elsif v_declaration -> 'population' -> 'reason' is distinct from 'null'::jsonb then
            return false;
          end if;
        elsif not coalesce(
          (v_declaration -> 'population') ?& array['tag','limitation']
          and (v_declaration -> 'population') - array['tag','limitation'] = '{}'::jsonb
          and pg_catalog.jsonb_typeof(v_declaration -> 'population' -> 'limitation') = 'object'
          and v_declaration -> 'population' -> 'limitation' <> '{}'::jsonb, false) then
          return false;
        end if;
      end if;
    end loop;
  end loop;
  return true;
end $$;
alter function public.shadow_generation_manifest_shape(jsonb,uuid) owner to postgres;
revoke all on function public.shadow_generation_manifest_shape(jsonb,uuid) from public, anon, authenticated, service_role;

alter table public.ingestion_jobs
  add column operation text not null default 'standard',
  add column requested_generation_id uuid,
  add column shadow_plan_digest text,
  add constraint ingestion_jobs_operation_kind check (operation in ('standard', 'shadow_reindex')),
  add constraint ingestion_jobs_shadow_identity check (
    (operation = 'standard' and requested_generation_id is null and shadow_plan_digest is null)
    or (operation = 'shadow_reindex' and requested_generation_id is not null and shadow_plan_digest is not null and batch_id is null
      and shadow_plan_digest ~ '^sha256:[0-9a-f]{64}$')
  );

-- This branch protects only the immutable job tuple. It is NOT the pending complete
-- ledger, disposition, artifact, cascade, cleanup or TRUNCATE preservation barrier.
create or replace function public.guard_shadow_generation_evidence_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ingestion_jobs' or tg_op <> 'UPDATE' then
    raise exception 'shadow_evidence_guard_owner_not_implemented' using errcode = '23514';
  end if;
  if old.operation is distinct from new.operation
    or old.requested_generation_id is distinct from new.requested_generation_id
    or old.shadow_plan_digest is distinct from new.shadow_plan_digest
    or (old.operation = 'shadow_reindex' and
      (old.document_id is distinct from new.document_id or old.id is distinct from new.id
       or old.batch_id is distinct from new.batch_id)) then
    raise exception 'immutable_ingestion_job_operation' using errcode = '23514';
  end if;
  return new;
end $$;
alter function public.guard_shadow_generation_evidence_mutation() owner to postgres;
revoke all on function public.guard_shadow_generation_evidence_mutation() from public, anon, authenticated, service_role;
create trigger ingestion_jobs_shadow_identity_immutable before update on public.ingestion_jobs
for each row execute function public.guard_shadow_generation_evidence_mutation();

create table if not exists public.shadow_reindex_waves (
  candidate_generation_id uuid primary key,
  plan_digest text not null unique,
  plan_version integer not null,
  project_ref text not null,
  source_policy_version text not null,
  audit_digest text not null,
  population_fingerprint text not null,
  recovery_evidence_digest text not null,
  baseline_evaluation_digest text not null,
  operation_manifest_digest text not null,
  plan_payload jsonb not null,
  created_at timestamptz not null default now(),
  prepared_origin_digest text not null,
  execution_profile_digest text not null,
  case_set_digest text not null,
  baseline_report jsonb not null,
  baseline_report_digest text not null,
  constraint shadow_reindex_waves_version check (plan_version = 1),
  constraint shadow_reindex_waves_project check (project_ref = 'sjrfecxgysukkwxsowpy'),
  constraint shadow_reindex_waves_policy check (pg_catalog.btrim(source_policy_version) <> ''),
  constraint shadow_reindex_waves_payloads check (coalesce(
    public.shadow_generation_envelope_valid(plan_payload,'plan','node-json-v1')
    and plan_payload ->> 'digest' = plan_digest
    and public.shadow_generation_envelope_valid(baseline_report,'evaluation_report','node-json-v1')
    and baseline_report ->> 'digest' = baseline_report_digest, false)),
  constraint shadow_reindex_waves_digests check (
    plan_digest ~ '^sha256:[0-9a-f]{64}$'
    and audit_digest ~ '^sha256:[0-9a-f]{64}$'
    and population_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and recovery_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    and baseline_evaluation_digest ~ '^sha256:[0-9a-f]{64}$'
    and operation_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
    and prepared_origin_digest ~ '^sha256:[0-9a-f]{64}$'
    and execution_profile_digest ~ '^sha256:[0-9a-f]{64}$'
    and case_set_digest ~ '^sha256:[0-9a-f]{64}$'
    and baseline_report_digest ~ '^sha256:[0-9a-f]{64}$'
  )
);
alter table public.shadow_reindex_waves owner to postgres;
alter table public.shadow_reindex_waves enable row level security;
revoke all on table public.shadow_reindex_waves from public, anon, authenticated, service_role;
grant select on table public.shadow_reindex_waves to service_role;

create table if not exists public.document_index_generations (
  document_id uuid not null references public.documents(id) on delete restrict,
  index_generation_id uuid not null references public.shadow_reindex_waves(candidate_generation_id) on delete restrict,
  owner_id uuid,
  baseline_generation_id uuid,
  expected_state_digest text not null,
  authority_digest text not null,
  source_binding jsonb not null,
  job_id uuid not null unique references public.ingestion_jobs(id) on delete restrict,
  first_lease_token uuid,
  claimed_at timestamptz,
  state text not null,
  expected_inventory_digest text,
  inventory_digest text,
  candidate_projection_digest text,
  baseline_bundle_digest text not null,
  stage_receipt jsonb,
  stage_receipt_digest text unique,
  staged_at timestamptz,
  control_revision bigint not null default 0,
  control_snapshot jsonb not null,
  original_origin_envelope jsonb not null,
  inventory_manifest jsonb not null,
  primary key (document_id, index_generation_id),
  constraint document_index_generations_first_attempt_key unique (document_id, index_generation_id, first_lease_token),
  constraint document_index_generations_baseline_distinct check (baseline_generation_id is null or baseline_generation_id <> index_generation_id),
  constraint document_index_generations_expected_state check (expected_state_digest ~ '^[0-9a-f]{64}$'),
  constraint document_index_generations_control_revision check (control_revision >= 0),
  constraint document_index_generations_control_shape check (coalesce(
    pg_catalog.jsonb_typeof(control_snapshot) = 'object'
    and control_snapshot ?& array['controlRevision','ownNodeJobs','ownStages']
    and control_snapshot - array['controlRevision','ownNodeJobs','ownStages'] = '{}'::jsonb
    and control_snapshot -> 'controlRevision' = pg_catalog.to_jsonb(control_revision)
    and pg_catalog.jsonb_typeof(control_snapshot -> 'ownNodeJobs') = 'array'
    and pg_catalog.jsonb_typeof(control_snapshot -> 'ownStages') = 'array'
    and case when pg_catalog.jsonb_typeof(control_snapshot -> 'ownNodeJobs') = 'array'
      then pg_catalog.jsonb_array_length(control_snapshot -> 'ownNodeJobs') = 1 else false end
    and control_snapshot -> 'ownNodeJobs' -> 0 ->> 'id' = job_id::text
    and control_snapshot -> 'ownNodeJobs' -> 0 ->> 'document_id' = document_id::text, false)),
  constraint document_index_generations_source_binding check (coalesce(
    pg_catalog.jsonb_typeof(source_binding) = 'object'
    and source_binding ?& array['version','originDigest','executionProfileDigest','documentId','ownerId','contentHash',
      'authorityDigest','sourcePolicyVersion','manualAliasIds','source','baselineGenerationId']
    and source_binding - array['version','originDigest','executionProfileDigest','documentId','ownerId','contentHash',
      'authorityDigest','sourcePolicyVersion','manualAliasIds','source','baselineGenerationId'] = '{}'::jsonb
    and source_binding -> 'version' = '1'::jsonb
    and source_binding ->> 'documentId' = document_id::text
    and source_binding -> 'ownerId' = coalesce(pg_catalog.to_jsonb(owner_id),'null'::jsonb)
    and source_binding -> 'baselineGenerationId' = coalesce(pg_catalog.to_jsonb(baseline_generation_id),'null'::jsonb)
    and source_binding ->> 'authorityDigest' = authority_digest
    and source_binding ->> 'originDigest' = original_origin_envelope ->> 'digest'
    and pg_catalog.jsonb_typeof(source_binding -> 'executionProfileDigest') = 'string'
    and source_binding ->> 'executionProfileDigest' ~ '^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(source_binding -> 'contentHash') = 'string'
    and source_binding ->> 'contentHash' ~ '^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(source_binding -> 'sourcePolicyVersion') = 'string'
    and pg_catalog.btrim(source_binding ->> 'sourcePolicyVersion') <> ''
    and pg_catalog.jsonb_typeof(source_binding -> 'manualAliasIds') = 'array'
    and pg_catalog.jsonb_typeof(source_binding -> 'source') = 'object', false)),
  constraint document_index_generations_origin_envelope check (coalesce(
    pg_catalog.jsonb_typeof(original_origin_envelope -> 'canonicalPayload') = 'string'
    and original_origin_envelope ->> 'version' = '1'
    and original_origin_envelope ->> 'domain' = 'baseline'
    and original_origin_envelope ->> 'encoding' = 'pg-jsonb-text-v1'
    and original_origin_envelope ->> 'digest' = 'sha256:' || expected_state_digest
    and public.shadow_generation_envelope_valid(original_origin_envelope,'baseline','pg-jsonb-text-v1'), false)),
  constraint document_index_generations_manifest check (coalesce(
    public.shadow_generation_manifest_shape(inventory_manifest,first_lease_token)
    and pg_catalog.jsonb_typeof(inventory_manifest -> 'documentId') = 'string'
    and pg_catalog.jsonb_typeof(inventory_manifest -> 'candidateGenerationId') = 'string'
    and pg_catalog.jsonb_typeof(inventory_manifest -> 'jobId') = 'string'
    and inventory_manifest ->> 'documentId' = document_id::text
    and inventory_manifest ->> 'candidateGenerationId' = index_generation_id::text
    and inventory_manifest ->> 'jobId' = job_id::text
    and case when pg_catalog.jsonb_typeof(inventory_manifest -> 'families') = 'array'
      then pg_catalog.jsonb_array_length(inventory_manifest -> 'families') = 18 else false end
    and inventory_manifest -> 'families' @> '[{"family":"pages","groups":[{"groupKey":"worker_core"}]},{"family":"native_structure","groups":[{"groupKey":"worker_native"}]},{"family":"chunks","groups":[{"groupKey":"worker_core"}]},{"family":"images","groups":[{"groupKey":"worker_core"}]},{"family":"table_facts","groups":[{"groupKey":"worker_core"}]},{"family":"embedding_fields","groups":[{"groupKey":"worker_core"}]},{"family":"index_units","groups":[{"groupKey":"worker_core"},{"groupKey":"deep_memory"}]},{"family":"sections","groups":[{"groupKey":"deep_memory"}]},{"family":"memory_cards","groups":[{"groupKey":"deep_memory"}]},{"family":"summary","groups":[{"groupKey":"enrichment"}]},{"family":"generated_labels","groups":[{"groupKey":"enrichment"}]},{"family":"quality","groups":[{"groupKey":"worker_core"}]},{"family":"document_metadata","groups":[{"groupKey":"projection_aggregate"}]},{"family":"producer_aliases","groups":[{"groupKey":"deep_memory"}]},{"family":"private_objects","groups":[{"groupKey":"private_objects"}]},{"family":"attempt_control","groups":[{"groupKey":"control"}]},{"family":"cache_inputs","groups":[{"groupKey":"cache"}]},{"family":"repair_audit_inputs","groups":[{"groupKey":"repair"}]}]'::jsonb
    and (expected_inventory_digest is not null) =
      (not pg_catalog.jsonb_path_exists(inventory_manifest, '$.families[*].groups[*] ? (@.state == "pending")')), false)),
  constraint document_index_generations_state check (state in ('reserved', 'building', 'staged')),
  constraint document_index_generations_lifecycle check (
    (state = 'reserved' and first_lease_token is null and claimed_at is null
      and stage_receipt is null and stage_receipt_digest is null and staged_at is null
      and inventory_digest is null and candidate_projection_digest is null)
    or (state = 'building' and first_lease_token is not null and claimed_at is not null
      and stage_receipt is null and stage_receipt_digest is null and staged_at is null
      and inventory_digest is null and candidate_projection_digest is null)
    or (state = 'staged' and first_lease_token is not null and claimed_at is not null
      and stage_receipt is not null and stage_receipt_digest is not null and staged_at is not null
      and expected_inventory_digest is not null and inventory_digest is not null and candidate_projection_digest is not null)
  ),
  constraint document_index_generations_receipt check (stage_receipt is null or coalesce(
    public.shadow_generation_envelope_valid(stage_receipt,'member_receipt','pg-jsonb-text-v1')
    and stage_receipt ->> 'digest' = stage_receipt_digest, false)),
  constraint document_index_generations_digests check (
    authority_digest ~ '^sha256:[0-9a-f]{64}$'
    and (expected_inventory_digest is null or expected_inventory_digest ~ '^sha256:[0-9a-f]{64}$')
    and (inventory_digest is null or inventory_digest ~ '^sha256:[0-9a-f]{64}$')
    and (candidate_projection_digest is null or candidate_projection_digest ~ '^sha256:[0-9a-f]{64}$')
    and baseline_bundle_digest ~ '^sha256:[0-9a-f]{64}$'
    and (stage_receipt_digest is null or stage_receipt_digest ~ '^sha256:[0-9a-f]{64}$')
  )
);
alter table public.document_index_generations owner to postgres;
alter table public.document_index_generations enable row level security;
revoke all on table public.document_index_generations from public, anon, authenticated, service_role;
grant select on table public.document_index_generations to service_role;

create table if not exists public.document_generation_projections (
  document_id uuid not null,
  index_generation_id uuid not null,
  lease_token uuid not null,
  owner_id uuid,
  summary jsonb,
  generated_labels jsonb,
  summary_projection_complete boolean,
  enrichment_metadata jsonb,
  quality jsonb,
  worker_metadata jsonb,
  document_counts jsonb,
  deep_memory_artifact_generation_id uuid unique,
  deep_memory_receipt jsonb,
  deep_memory_metadata jsonb,
  producer_aliases jsonb,
  summary_digest text,
  quality_digest text,
  deep_memory_digest text,
  worker_state_digest text,
  sealed_at timestamptz,
  primary key (document_id, index_generation_id),
  constraint document_generation_projections_member_fkey foreign key (document_id, index_generation_id) references public.document_index_generations(document_id, index_generation_id) on delete restrict,
  constraint document_generation_projections_attempt_fkey foreign key (document_id, index_generation_id, lease_token) references public.document_index_generations(document_id, index_generation_id, first_lease_token) on delete restrict,
  constraint document_generation_projections_d_distinct check (deep_memory_artifact_generation_id is null or deep_memory_artifact_generation_id <> index_generation_id),
  constraint document_generation_projections_summary_tuple check (
    (summary_digest is null and summary is null and generated_labels is null and summary_projection_complete is null and enrichment_metadata is null)
    or (summary_digest is not null and summary is not null and generated_labels is not null and summary_projection_complete is not null and enrichment_metadata is not null)),
  constraint document_generation_projections_quality_tuple check ((quality is null) = (quality_digest is null)),
  constraint document_generation_projections_worker_tuple check (
    (worker_state_digest is null and worker_metadata is null and document_counts is null)
    or (worker_state_digest is not null and worker_metadata is not null and document_counts is not null)),
  constraint document_generation_projections_deep_memory_tuple check (
    (deep_memory_digest is null and deep_memory_artifact_generation_id is null and deep_memory_receipt is null and deep_memory_metadata is null and producer_aliases is null)
    or (deep_memory_digest is not null and deep_memory_artifact_generation_id is not null and deep_memory_receipt is not null and deep_memory_metadata is not null and producer_aliases is not null)),
  constraint document_generation_projections_counts check (document_counts is null or coalesce(
    document_counts ?& array['page_count','chunk_count','image_count','status','error_message']
    and document_counts - array['page_count','chunk_count','image_count','status','error_message'] = '{}'::jsonb
    and pg_catalog.jsonb_typeof(document_counts -> 'page_count') = 'number'
    and pg_catalog.jsonb_typeof(document_counts -> 'chunk_count') = 'number'
    and pg_catalog.jsonb_typeof(document_counts -> 'image_count') = 'number'
    and pg_catalog.jsonb_typeof(document_counts -> 'status') = 'string'
    and pg_catalog.jsonb_typeof(document_counts -> 'error_message') in ('string','null'), false)),
  constraint document_generation_projections_digests check (
    (summary_digest is null or summary_digest ~ '^sha256:[0-9a-f]{64}$')
    and (quality_digest is null or quality_digest ~ '^sha256:[0-9a-f]{64}$')
    and (deep_memory_digest is null or deep_memory_digest ~ '^sha256:[0-9a-f]{64}$')
    and (worker_state_digest is null or worker_state_digest ~ '^sha256:[0-9a-f]{64}$')
  ),
  constraint dgp_summary_shape check (summary is null or coalesce(pg_catalog.jsonb_typeof(summary) = 'object' and summary <> '{}'::jsonb, false)),
  constraint dgp_generated_labels_shape check (generated_labels is null or coalesce(pg_catalog.jsonb_typeof(generated_labels) = 'array', false)),
  constraint dgp_enrichment_metadata_shape check (enrichment_metadata is null or coalesce(pg_catalog.jsonb_typeof(enrichment_metadata) = 'object' and enrichment_metadata <> '{}'::jsonb, false)),
  constraint dgp_quality_shape check (quality is null or coalesce(pg_catalog.jsonb_typeof(quality) = 'object' and quality <> '{}'::jsonb, false)),
  constraint dgp_worker_metadata_shape check (worker_metadata is null or coalesce(pg_catalog.jsonb_typeof(worker_metadata) = 'object' and worker_metadata <> '{}'::jsonb, false)),
  constraint dgp_document_counts_shape check (document_counts is null or coalesce(pg_catalog.jsonb_typeof(document_counts) = 'object' and document_counts <> '{}'::jsonb, false)),
  constraint dgp_deep_memory_receipt_shape check (deep_memory_receipt is null or coalesce(pg_catalog.jsonb_typeof(deep_memory_receipt) = 'object' and deep_memory_receipt <> '{}'::jsonb, false)),
  constraint dgp_deep_memory_metadata_shape check (deep_memory_metadata is null or coalesce(pg_catalog.jsonb_typeof(deep_memory_metadata) = 'object' and deep_memory_metadata <> '{}'::jsonb, false)),
  constraint dgp_producer_aliases_shape check (producer_aliases is null or coalesce(pg_catalog.jsonb_typeof(producer_aliases) = 'array', false))
);
alter table public.document_generation_projections owner to postgres;
alter table public.document_generation_projections enable row level security;
revoke all on table public.document_generation_projections from public, anon, authenticated, service_role;
grant select on table public.document_generation_projections to service_role;

create table if not exists public.document_generation_inventory (
  document_id uuid not null,
  index_generation_id uuid not null,
  family text not null,
  unit_key text not null,
  lease_token uuid not null,
  expected boolean not null,
  required boolean not null,
  disposition text not null,
  reason_code text,
  limitations jsonb not null,
  producer text not null,
  artifact_generation_id uuid,
  artifact_ref jsonb,
  content_digest text,
  source_binding jsonb not null,
  relationships jsonb not null,
  retained_evidence_text text,
  retained_native_payload text,
  representation_version text,
  transform_version text,
  primary key (document_id, index_generation_id, family, unit_key),
  constraint document_generation_inventory_member_fkey foreign key (document_id, index_generation_id) references public.document_index_generations(document_id, index_generation_id) on delete restrict,
  constraint document_generation_inventory_attempt_fkey foreign key (document_id, index_generation_id, lease_token) references public.document_index_generations(document_id, index_generation_id, first_lease_token) on delete restrict,
  constraint document_generation_inventory_family check (family in ('pages', 'native_structure', 'chunks', 'images', 'table_facts', 'embedding_fields', 'index_units', 'sections', 'memory_cards', 'summary', 'generated_labels', 'quality', 'document_metadata', 'producer_aliases', 'private_objects', 'attempt_control', 'cache_inputs', 'repair_audit_inputs')),
  constraint document_generation_inventory_identity check (pg_catalog.btrim(unit_key) <> '' and pg_catalog.btrim(producer) <> '' and (not required or expected)),
  constraint document_generation_inventory_disposition check (disposition in ('pending', 'retained', 'excluded', 'failed', 'skipped', 'not_required')),
  constraint document_generation_inventory_outcome check (
    (disposition = 'pending' and reason_code is null)
    or (disposition = 'retained' and artifact_ref is not null and content_digest is not null and reason_code is null)
    or (disposition in ('excluded','failed','skipped') and reason_code is not null and pg_catalog.btrim(reason_code) <> '')
    or (disposition = 'not_required' and not expected and not required and reason_code is not null and pg_catalog.btrim(reason_code) <> '')),
  constraint document_generation_inventory_d_distinct check (artifact_generation_id is null or artifact_generation_id <> index_generation_id),
  constraint document_generation_inventory_json check (coalesce(
    pg_catalog.jsonb_typeof(limitations) = 'array'
    and pg_catalog.jsonb_typeof(relationships) = 'array'
    and pg_catalog.jsonb_typeof(source_binding) = 'object' and source_binding <> '{}'::jsonb
    and (artifact_ref is null or (pg_catalog.jsonb_typeof(artifact_ref) = 'object' and artifact_ref <> '{}'::jsonb)), false)),
  constraint document_generation_inventory_digests check (
    (content_digest is null or content_digest ~ '^sha256:[0-9a-f]{64}$')
  )
);
alter table public.document_generation_inventory owner to postgres;
alter table public.document_generation_inventory enable row level security;
revoke all on table public.document_generation_inventory from public, anon, authenticated, service_role;
grant select on table public.document_generation_inventory to service_role;

create table if not exists public.document_generation_baselines (
  document_id uuid not null,
  candidate_generation_id uuid not null,
  baseline_generation_id uuid,
  expected_state_digest text not null,
  bundle_version integer not null,
  bundle_payload jsonb not null,
  bundle_digest text not null,
  captured_at timestamptz not null default now(),
  primary key (document_id, candidate_generation_id),
  constraint document_generation_baselines_member_fkey foreign key (document_id, candidate_generation_id) references public.document_index_generations(document_id, index_generation_id) on delete restrict,
  constraint document_generation_baselines_version check (bundle_version = 1),
  constraint document_generation_baselines_expected_state check (expected_state_digest ~ '^[0-9a-f]{64}$'),
  constraint document_generation_baselines_generation check (baseline_generation_id is null or baseline_generation_id <> candidate_generation_id),
  constraint document_generation_baselines_envelope check (coalesce(
    pg_catalog.jsonb_typeof(bundle_payload -> 'canonicalPayload') = 'string'
    and bundle_payload ->> 'version' = '1'
    and bundle_payload ->> 'domain' = 'baseline'
    and bundle_payload ->> 'encoding' = 'pg-jsonb-text-v1'
    and bundle_payload ->> 'digest' = bundle_digest
    and public.shadow_generation_envelope_valid(bundle_payload,'baseline','pg-jsonb-text-v1'), false)),
  constraint document_generation_baselines_digests check (
    bundle_digest ~ '^sha256:[0-9a-f]{64}$'
  )
);
alter table public.document_generation_baselines owner to postgres;
alter table public.document_generation_baselines enable row level security;
revoke all on table public.document_generation_baselines from public, anon, authenticated, service_role;
grant select on table public.document_generation_baselines to service_role;

-- U04 read-only capture foundation. No mutation, claim or seal entrypoint is exposed.
-- Canonical profile text is checked before JSONB can erase duplicate keys or order.
create or replace function public.shadow_utf16_order_v1(p_text text)
returns bytea language plpgsql immutable set search_path = '' as $$
declare v_result bytea := ''::bytea; v_code integer; v_index integer; v_unit integer;
begin
  for v_index in 1..pg_catalog.length(p_text) loop
    v_code := pg_catalog.ascii(pg_catalog.substr(p_text,v_index,1));
    if v_code > 65535 then
      v_unit := 55296 + ((v_code - 65536) / 1024);
      v_result := v_result || pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(v_unit),4,'0'),'hex');
      v_code := 56320 + ((v_code - 65536) % 1024);
    end if;
    v_result := v_result || pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(v_code),4,'0'),'hex');
  end loop;
  return v_result;
end $$;
alter function public.shadow_utf16_order_v1(text) owner to postgres;
revoke all on function public.shadow_utf16_order_v1(text) from public, anon, authenticated, service_role;

create or replace function public.shadow_node_json_text_v1(p_value json)
returns text language plpgsql immutable set search_path = '' set extra_float_digits = '3' as $$
declare v_type text := pg_catalog.json_typeof(p_value); v_result text; v_item record;
  v_first boolean := true; v_prior bytea; v_order bytea; v_number double precision;
  v_digits text; v_exponent integer; v_negative text; v_decimal integer;
begin
  if v_type = 'object' then
    v_result := '{';
    for v_item in select key,value from pg_catalog.json_each(p_value) loop
      v_order := public.shadow_utf16_order_v1(v_item.key);
      if v_prior is not null and v_order <= v_prior then raise exception 'invalid_shadow_profile'; end if;
      v_prior := v_order;
      v_result := v_result || case when v_first then '' else ',' end
        || pg_catalog.to_json(v_item.key)::text || ':' || public.shadow_node_json_text_v1(v_item.value);
      v_first := false;
    end loop;
    return v_result || '}';
  elsif v_type = 'array' then
    v_result := '[';
    for v_item in select value from pg_catalog.json_array_elements(p_value) loop
      v_result := v_result || case when v_first then '' else ',' end || public.shadow_node_json_text_v1(v_item.value);
      v_first := false;
    end loop;
    return v_result || ']';
  elsif v_type = 'string' then
    return pg_catalog.to_json(p_value #>> '{}')::text;
  elsif v_type in ('boolean','null') then return p_value::text;
  elsif v_type = 'number' then
    v_number := p_value::text::double precision;
    if v_number = 0 then return '0'; end if;
    if v_number::text in ('NaN','Infinity','-Infinity') then raise exception 'invalid_shadow_profile'; end if;
    v_result := pg_catalog.lower(v_number::text);
    v_negative := case when v_number < 0 then '-' else '' end;
    v_result := pg_catalog.ltrim(v_result,'-');
    if pg_catalog.strpos(v_result,'e') > 0 then
      v_exponent := pg_catalog.split_part(v_result,'e',2)::integer;
      v_digits := pg_catalog.replace(pg_catalog.split_part(v_result,'e',1),'.','');
    else
      v_decimal := pg_catalog.strpos(v_result,'.');
      if v_decimal = 0 then v_decimal := pg_catalog.length(v_result) + 1; end if;
      v_digits := pg_catalog.replace(v_result,'.','');
      v_exponent := v_decimal - 2;
      while pg_catalog.left(v_digits,1) = '0' loop
        v_digits := pg_catalog.substr(v_digits,2); v_exponent := v_exponent - 1;
      end loop;
    end if;
    v_digits := pg_catalog.rtrim(v_digits,'0');
    if v_exponent >= -6 and v_exponent < 21 then
      if v_exponent < 0 then return v_negative || '0.' || pg_catalog.repeat('0',-v_exponent-1) || v_digits; end if;
      if pg_catalog.length(v_digits) <= v_exponent+1 then
        return v_negative || v_digits || pg_catalog.repeat('0',v_exponent+1-pg_catalog.length(v_digits));
      end if;
      return v_negative || pg_catalog.substr(v_digits,1,v_exponent+1) || '.' || pg_catalog.substr(v_digits,v_exponent+2);
    end if;
    return v_negative || pg_catalog.left(v_digits,1)
      || case when pg_catalog.length(v_digits)>1 then '.' || pg_catalog.substr(v_digits,2) else '' end
      || 'e' || case when v_exponent>=0 then '+' else '' end || v_exponent::text;
  end if;
  raise exception 'invalid_shadow_profile';
end $$;
alter function public.shadow_node_json_text_v1(json) owner to postgres;
revoke all on function public.shadow_node_json_text_v1(json) from public, anon, authenticated, service_role;

create or replace function public.shadow_capture_raw_envelope_valid_v1(p_envelope jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_domain text; v_encoding text; v_payload text; v_digest text;
begin
  if not coalesce(pg_catalog.jsonb_typeof(p_envelope)='object' and p_envelope ?& array['version','domain','encoding','canonicalPayload','digest']
    and p_envelope-array['version','domain','encoding','canonicalPayload','digest']='{}'::jsonb and p_envelope->'version'='1'::jsonb
    and pg_catalog.jsonb_typeof(p_envelope->'domain')='string' and pg_catalog.jsonb_typeof(p_envelope->'encoding')='string'
    and pg_catalog.jsonb_typeof(p_envelope->'canonicalPayload')='string' and pg_catalog.jsonb_typeof(p_envelope->'digest')='string',false) then return false; end if;
  v_domain:=p_envelope->>'domain'; v_encoding:=p_envelope->>'encoding'; v_payload:=p_envelope->>'canonicalPayload';
  if v_domain not in ('plan','inventory','projection','baseline','control','member_receipt','wave_receipt','evaluation_report',
    'u04-evidence-expectations-v1','u04-reviewed-measurements-v1','u04-reviewed-evidence-approval-v1','u04-retained-evidence-v1','u04-evaluation-request-v1',
    'u04-execution-profile-v1','u04-engine-config-v1','u04-evaluation-cases-v1','u04-sql-execution-evidence-v1')
    or v_encoding not in ('node-json-v1','pg-jsonb-text-v1')
    or (v_domain in ('u04-execution-profile-v1','u04-engine-config-v1','u04-evaluation-cases-v1','u04-sql-execution-evidence-v1') and v_encoding<>'node-json-v1') then return false; end if;
  v_digest:='sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(E'U04-SHADOW/1\n'||v_domain||E'\n'||v_encoding||E'\n'
    ||pg_catalog.octet_length(pg_catalog.convert_to(v_payload,'UTF8'))::text||E'\n'||v_payload,'UTF8'),'sha256'),'hex');
  return p_envelope->>'digest'=v_digest;
end $$;
alter function public.shadow_capture_raw_envelope_valid_v1(jsonb) owner to postgres;
revoke all on function public.shadow_capture_raw_envelope_valid_v1(jsonb) from public, anon, authenticated, service_role;

create or replace function public.shadow_manual_alias_review_v1(p_envelope jsonb,p_profile jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_review jsonb; v_row jsonb; v_item jsonb; v_entry jsonb; v_basis_envelope jsonb; v_prior text;
begin
  if not coalesce(public.shadow_capture_raw_envelope_valid_v1(p_envelope) and p_envelope->>'domain'='u04-retained-evidence-v1'
    and p_envelope->>'encoding'='node-json-v1',false) then raise exception 'invalid_shadow_manual_review'; end if;
  if public.shadow_node_json_text_v1((p_envelope->>'canonicalPayload')::json) is distinct from p_envelope->>'canonicalPayload' then raise exception 'invalid_shadow_manual_review'; end if;
  v_review:=(p_envelope->>'canonicalPayload')::jsonb;
  if not coalesce(pg_catalog.jsonb_typeof(v_review)='object' and v_review ?& array[
    'kind','evidenceMode','target','aliasId','ownerId','rowDigest','rowEnvelope','producerIdentity','reviewer','basis','reviewText']
    and v_review-array['kind','evidenceMode','target','aliasId','ownerId','rowDigest','rowEnvelope','producerIdentity','reviewer','basis','reviewText']='{}'::jsonb
    and v_review->>'kind'='u04-manual-alias-lineage-review-v1' and v_review->'evidenceMode'=p_profile->'evidenceMode'
    and v_review->'target'=p_profile->'target' and pg_catalog.jsonb_typeof(v_review->'aliasId')='string'
    and p_profile->'manualAliasIds' @> pg_catalog.jsonb_build_array(v_review->'aliasId')
    and pg_catalog.jsonb_typeof(v_review->'producerIdentity')='string' and pg_catalog.length(pg_catalog.btrim(v_review->>'producerIdentity'))>0
    and v_review->>'producerIdentity'=pg_catalog.btrim(v_review->>'producerIdentity')
    and pg_catalog.jsonb_typeof(v_review->'reviewText')='string' and pg_catalog.length(pg_catalog.btrim(v_review->>'reviewText'))>0
    and v_review->>'reviewText'=pg_catalog.btrim(v_review->>'reviewText')
    and pg_catalog.jsonb_typeof(v_review->'reviewer')='object' and v_review->'reviewer' ?& array['identity','role','reviewedAt']
    and v_review->'reviewer'-array['identity','role','reviewedAt']='{}'::jsonb
    and pg_catalog.jsonb_typeof(v_review->'reviewer'->'identity')='string'
    and pg_catalog.length(pg_catalog.btrim(v_review->'reviewer'->>'identity'))>0
    and v_review->'reviewer'->>'identity'=pg_catalog.btrim(v_review->'reviewer'->>'identity')
    and v_review->'reviewer'->>'identity'<>v_review->>'producerIdentity'
    and v_review->'reviewer'->>'role' in ('clinical_governance','corpus_steward','source_governance')
    and pg_catalog.jsonb_typeof(v_review->'reviewer'->'reviewedAt')='string'
    and pg_catalog.length(v_review->'reviewer'->>'reviewedAt')=10 and v_review->'reviewer'->>'reviewedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and pg_catalog.jsonb_typeof(v_review->'basis')='array' and pg_catalog.jsonb_array_length(v_review->'basis')>0
    and public.shadow_capture_raw_envelope_valid_v1(v_review->'rowEnvelope')
    and v_review->'rowEnvelope'->>'domain'='baseline' and v_review->'rowEnvelope'->>'encoding'='pg-jsonb-text-v1'
    and v_review->'rowDigest'=v_review->'rowEnvelope'->'digest',false) then raise exception 'invalid_shadow_manual_review'; end if;
  v_row:=(v_review->'rowEnvelope'->>'canonicalPayload')::jsonb;
  if v_row::text is distinct from v_review->'rowEnvelope'->>'canonicalPayload' then raise exception 'invalid_shadow_manual_review'; end if;
  if not coalesce(pg_catalog.jsonb_typeof(v_row)='object' and v_row ?& array['id','owner_id','alias','canonical','alias_type','weight','enabled','metadata','created_at','updated_at']
    and v_row-array['id','owner_id','alias','canonical','alias_type','weight','enabled','metadata','created_at','updated_at']='{}'::jsonb
    and v_row->'id'=v_review->'aliasId' and v_row->'owner_id'=v_review->'ownerId'
    and pg_catalog.jsonb_typeof(v_row->'metadata')='object' and not(v_row->'metadata' ?| array['generated_by','artifact_generation_id','ingestion_lease_token'])
    and ((v_review->'ownerId'='null'::jsonb and p_profile->'access'->'includePublic'='true'::jsonb)
      or(p_profile->'access'->>'mode'='owner' and v_review->'ownerId'=p_profile->'access'->'ownerId')),false) then raise exception 'invalid_shadow_manual_review'; end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_review->'basis') loop
    if not coalesce(pg_catalog.jsonb_typeof(v_item)='object' and v_item ?& array['producerIdentity','entry'] and v_item-array['producerIdentity','entry']='{}'::jsonb
      and pg_catalog.jsonb_typeof(v_item->'producerIdentity')='string' and pg_catalog.length(pg_catalog.btrim(v_item->>'producerIdentity'))>0
      and v_item->>'producerIdentity'=pg_catalog.btrim(v_item->>'producerIdentity')
      and v_item->>'producerIdentity'<>v_review->'reviewer'->>'identity',false) then raise exception 'invalid_shadow_manual_review'; end if;
    v_entry:=v_item->'entry';v_basis_envelope:=v_entry->'envelope';
    if not coalesce(pg_catalog.jsonb_typeof(v_entry)='object' and v_entry ?& array['tag','envelope','representation','mediaType','byteLength']
      and v_entry-array['tag','envelope','representation','mediaType','byteLength']='{}'::jsonb and v_entry->>'tag'='payload'
      and v_entry->>'representation' in ('producer_text','producer_json','producer_bytes')
      and pg_catalog.jsonb_typeof(v_entry->'mediaType')='string' and pg_catalog.length(v_entry->>'mediaType')>0
      and pg_catalog.jsonb_typeof(v_entry->'byteLength')='number' and v_entry->>'byteLength' ~ '^[1-9][0-9]*$'
      and public.shadow_capture_raw_envelope_valid_v1(v_basis_envelope)
      and (v_entry->>'byteLength')::numeric=pg_catalog.octet_length(pg_catalog.convert_to(v_basis_envelope->>'canonicalPayload','UTF8'))
      and v_basis_envelope->>'digest'<>v_review->>'rowDigest' and v_basis_envelope->>'digest'<>p_envelope->>'digest'
      and (v_prior is null or v_basis_envelope->>'digest' collate "C">v_prior collate "C"),false) then raise exception 'invalid_shadow_manual_review'; end if;
    v_prior:=v_basis_envelope->>'digest';
  end loop;
  -- Positive manual-origin semantics come from independently admitted human review.
  return v_review;
end $$;
alter function public.shadow_manual_alias_review_v1(jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_manual_alias_review_v1(jsonb,jsonb) from public, anon, authenticated, service_role;
create or replace function public.shadow_profile_capture_v1(p_envelope jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_text text; v_profile jsonb; v_limits jsonb; v_key text; v_item jsonb; v_artifact jsonb;
  v_previous text; v_text_value text; v_bytes bytea; v_digest text;
begin
  if not coalesce(pg_catalog.jsonb_typeof(p_envelope)='object'
    and p_envelope ?& array['version','domain','encoding','canonicalPayload','digest']
    and p_envelope-array['version','domain','encoding','canonicalPayload','digest']='{}'::jsonb
    and p_envelope->'version'='1'::jsonb and p_envelope->>'domain'='u04-execution-profile-v1'
    and p_envelope->>'encoding'='node-json-v1'
    and pg_catalog.jsonb_typeof(p_envelope->'canonicalPayload')='string'
    and pg_catalog.jsonb_typeof(p_envelope->'digest')='string',false) then raise exception 'invalid_shadow_profile'; end if;
  v_text := p_envelope->>'canonicalPayload';
  if pg_catalog.octet_length(pg_catalog.convert_to(v_text,'UTF8')) > 268435456 then raise exception 'evidence_too_large'; end if;
  if public.shadow_node_json_text_v1(v_text::json) is distinct from v_text then raise exception 'invalid_shadow_profile'; end if;
  v_bytes := pg_catalog.convert_to(E'U04-SHADOW/1\nu04-execution-profile-v1\nnode-json-v1\n'
    || pg_catalog.octet_length(pg_catalog.convert_to(v_text,'UTF8'))::text || E'\n' || v_text,'UTF8');
  v_digest := 'sha256:' || pg_catalog.encode(extensions.digest(v_bytes,'sha256'),'hex');
  if p_envelope->>'digest' is distinct from v_digest then raise exception 'invalid_shadow_profile'; end if;
  v_profile := v_text::jsonb;
  if not coalesce(pg_catalog.jsonb_typeof(v_profile)='object' and v_profile ?& array[
    'kind','evidenceMode','target','access','documentIds','manualAliasIds','manualAliasReviews','sourcePolicyVersion','documentOwnedPolicies',
    'rolloutMode','rolloutVersion','providerMode','comparisonClock','configuration','cases','implementation','providerPolicy','sql','limits']
    and v_profile-array['kind','evidenceMode','target','access','documentIds','manualAliasIds','manualAliasReviews','sourcePolicyVersion','documentOwnedPolicies',
    'rolloutMode','rolloutVersion','providerMode','comparisonClock','configuration','cases','implementation','providerPolicy','sql','limits']='{}'::jsonb
    and v_profile->>'kind'='u04-execution-profile-v1' and v_profile->>'evidenceMode' in ('mocked','real')
    and v_profile->>'providerMode' in ('openai','offline') and v_profile->>'rolloutMode' in ('legacy','shadow','canary')
    and pg_catalog.jsonb_typeof(v_profile->'target')='object' and v_profile->'target' ? 'projectRef'
    and v_profile->'target'-'projectRef'='{}'::jsonb
    and pg_catalog.jsonb_typeof(v_profile->'access')='object' and v_profile->'access' ?& array['mode','ownerId','includePublic']
    and v_profile->'access'-array['mode','ownerId','includePublic']='{}'::jsonb
    and pg_catalog.jsonb_typeof(v_profile->'access'->'includePublic')='boolean'
    and pg_catalog.jsonb_typeof(v_profile->'documentOwnedPolicies')='array' and pg_catalog.jsonb_typeof(v_profile->'manualAliasReviews')='array',false) then raise exception 'invalid_shadow_profile'; end if;
  foreach v_key in array array['sourcePolicyVersion','rolloutVersion'] loop
    v_text_value := v_profile->>v_key;
    if not coalesce(pg_catalog.jsonb_typeof(v_profile->v_key)='string' and pg_catalog.length(v_text_value) between 1 and 100
      and v_text_value=pg_catalog.btrim(v_text_value),false) then raise exception 'invalid_shadow_profile'; end if;
  end loop;
  v_text_value := v_profile->'target'->>'projectRef';
  if not coalesce(pg_catalog.jsonb_typeof(v_profile->'target'->'projectRef')='string' and pg_catalog.length(v_text_value) between 1 and 100
    and v_text_value=pg_catalog.btrim(v_text_value)
    and v_text_value !~* '^([a-z][a-z0-9+.-]*:|//)'
    and v_text_value !~* '(^|[[:space:]])(host|hostaddr|port|dbname|database|user|password|service|sslmode)[[:space:]]*=',false)
    then raise exception 'invalid_shadow_profile'; end if;
  if not coalesce((v_profile->'access'->>'mode'='public' and v_profile->'access'->'ownerId'='null'::jsonb
    and v_profile->'access'->'includePublic'='true'::jsonb) or (v_profile->'access'->>'mode'='owner'
    and pg_catalog.jsonb_typeof(v_profile->'access'->'ownerId')='string'
    and pg_catalog.length(v_profile->'access'->>'ownerId')=36
    and v_profile->'access'->>'ownerId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),false)
    then raise exception 'invalid_shadow_profile'; end if;
  foreach v_key in array array['documentIds','manualAliasIds'] loop
    if pg_catalog.jsonb_typeof(v_profile->v_key) is distinct from 'array' then raise exception 'invalid_shadow_profile'; end if;
    v_previous := null;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_profile->v_key) loop
      v_text_value := v_item #>> '{}';
      if not coalesce(pg_catalog.jsonb_typeof(v_item)='string' and pg_catalog.length(v_text_value)=36
        and v_text_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and (v_previous is null or v_text_value collate "C" > v_previous collate "C"),false) then raise exception 'invalid_shadow_profile'; end if;
      v_previous := v_text_value;
    end loop;
  end loop;
  v_previous := null;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_profile->'documentOwnedPolicies') loop
    if not coalesce(pg_catalog.jsonb_typeof(v_item)='object' and v_item ?& array[
      'documentId','ownerId','contentHash','sourcePolicyVersion','policyArtifact','reviewArtifact']
      and v_item-array['documentId','ownerId','contentHash','sourcePolicyVersion','policyArtifact','reviewArtifact']='{}'::jsonb
      and pg_catalog.jsonb_typeof(v_item->'documentId')='string' and v_profile->'documentIds' @> pg_catalog.jsonb_build_array(v_item->'documentId')
      and (v_previous is null or v_item->>'documentId' collate "C" > v_previous collate "C")
      and (v_item->'ownerId'='null'::jsonb or (pg_catalog.jsonb_typeof(v_item->'ownerId')='string'
        and pg_catalog.length(v_item->>'ownerId')=36 and v_item->>'ownerId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      and pg_catalog.jsonb_typeof(v_item->'contentHash')='string' and pg_catalog.length(v_item->>'contentHash')=71
      and v_item->>'contentHash' ~ '^sha256:[0-9a-f]{64}$'
      and v_item->'sourcePolicyVersion'=v_profile->'sourcePolicyVersion',false) then raise exception 'invalid_shadow_profile'; end if;
    v_previous := v_item->>'documentId';
    foreach v_key in array array['policyArtifact','reviewArtifact'] loop
      v_artifact := v_item->v_key;
      if not coalesce(pg_catalog.jsonb_typeof(v_artifact)='object' and v_artifact ?& array['digest','retainedEnvelopeDigest']
        and v_artifact-array['digest','retainedEnvelopeDigest']='{}'::jsonb
        and pg_catalog.jsonb_typeof(v_artifact->'digest')='string' and pg_catalog.length(v_artifact->>'digest')=71
        and v_artifact->>'digest' ~ '^sha256:[0-9a-f]{64}$'
        and pg_catalog.jsonb_typeof(v_artifact->'retainedEnvelopeDigest')='string' and pg_catalog.length(v_artifact->>'retainedEnvelopeDigest')=71
        and v_artifact->>'retainedEnvelopeDigest' ~ '^sha256:[0-9a-f]{64}$',false) then raise exception 'invalid_shadow_profile'; end if;
    end loop;
  end loop;
  if pg_catalog.jsonb_array_length(v_profile->'manualAliasReviews')<>pg_catalog.jsonb_array_length(v_profile->'manualAliasIds') then raise exception 'invalid_shadow_manual_review'; end if;
  v_previous:=null;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_profile->'manualAliasReviews') loop
    v_artifact:=public.shadow_manual_alias_review_v1(v_item,v_profile);
    if v_previous is not null and v_artifact->>'aliasId' collate "C"<=v_previous collate "C" then raise exception 'invalid_shadow_manual_review'; end if;
    v_previous:=v_artifact->>'aliasId';
  end loop;
  v_limits := v_profile->'limits';
  if not coalesce(pg_catalog.jsonb_typeof(v_limits)='object'
    and v_limits ?& array['serverRequestDeadlineMs','lockTimeoutMs','clientTotalDeadlineMs','maxMembers','maxCapturedRows','maxOriginBundleBytes','maxAppendRows','maxAppendBytes']
    and v_limits-array['serverRequestDeadlineMs','lockTimeoutMs','clientTotalDeadlineMs','maxMembers','maxCapturedRows','maxOriginBundleBytes','maxAppendRows','maxAppendBytes']='{}'::jsonb,false)
    then raise exception 'invalid_shadow_profile'; end if;
  for v_key,v_item in select key,value from pg_catalog.jsonb_each(v_limits) loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'number' or v_item::text !~ '^[1-9][0-9]*$' then raise exception 'invalid_shadow_profile'; end if;
  end loop;
  if not coalesce((v_limits->>'serverRequestDeadlineMs')::numeric=15000 and (v_limits->>'clientTotalDeadlineMs')::numeric=20000
    and (v_limits->>'lockTimeoutMs')::numeric<=2000 and (v_limits->>'maxMembers')::numeric<=8
    and (v_limits->>'maxCapturedRows')::numeric<=250000 and (v_limits->>'maxOriginBundleBytes')::numeric<=268435456
    and (v_limits->>'maxAppendRows')::numeric<=2000 and (v_limits->>'maxAppendBytes')::numeric<=16777216
    and pg_catalog.jsonb_array_length(v_profile->'documentIds') between 1 and (v_limits->>'maxMembers')::integer,false)
    then raise exception 'invalid_shadow_profile'; end if;
  -- Other complete sections remain retained; the intrinsic local parser and separate
  -- controller admission validate their semantics before dispatch and consumption.
  return v_profile;
end $$;
alter function public.shadow_profile_capture_v1(jsonb) owner to postgres;
revoke all on function public.shadow_profile_capture_v1(jsonb) from public, anon, authenticated, service_role;

-- Same U03 authority predicates and digest projection, under the calling STABLE snapshot.
create or replace function public.read_shadow_document_authority_v1(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_key text; v_version_id uuid; v_document public.documents%rowtype;
  v_version public.public_source_versions%rowtype; v_event public.public_source_activation_events%rowtype;
  v_digest text; v_metadata jsonb;
begin
  select v.id, v.source_catalogue_key into v_version_id, v_key
  from public.public_source_versions v where v.staging_document_id = p_document_id;
  if v_key is null then
    select d.metadata->>'source_catalogue_key' into v_key from public.documents d where d.id = p_document_id;
  end if;
  if v_key is not null then
    select * into v_event from public.public_source_activation_events
      where source_catalogue_key = v_key order by source_sequence desc limit 1;
    select * into v_version from public.public_source_versions where id = v_version_id;
  end if;
  select * into v_document from public.documents where id = p_document_id;
  if not found then return null; end if;
  v_metadata := v_document.metadata;
  if jsonb_typeof(v_metadata) is distinct from 'object' then return null; end if;
  if v_metadata->>'source_catalogue_key' is distinct from v_key
    or exists (select 1 from public.public_source_versions v where v.staging_document_id = p_document_id and v.id is distinct from v_version_id)
    then return null; end if;
  if v_key is not null then
    if v_version.id is null or v_event.id is null or v_version.staging_document_id <> p_document_id
      or v_event.decision <> 'activate' or v_version.activation_event_id is distinct from v_event.id
      or v_version.lifecycle not in ('shadow', 'approved')
      or v_version.source_policy_version is distinct from v_event.source_policy_version
      or v_version.source_policy_digest is distinct from v_event.source_policy_digest
      or v_metadata->>'source_policy_version' is distinct from v_version.source_policy_version
      or v_metadata->>'source_policy_digest' is distinct from v_version.source_policy_digest
      or v_metadata->>'source_activation_event_id' is distinct from v_event.id::text
      or v_metadata->>'source_canonical_url' is distinct from v_version.exact_canonical_url
      or v_metadata->>'source_exact_url' is distinct from v_version.exact_version_url
      or v_metadata->>'source_exact_version' is distinct from v_version.exact_version
      or v_metadata->>'source_content_hash' is distinct from v_version.content_hash
      or v_metadata->>'content_hash' is distinct from v_version.staged_content_hash
      or v_metadata->>'licence_evidence_digest' is distinct from v_version.licence_evidence_digest
      or v_metadata->>'content_identity_verdict' is distinct from 'clear'
      or v_metadata->>'content_identity_hash' is distinct from v_version.staged_content_hash
      or v_metadata->>'content_identity_verdict_version' is distinct from 'public-source-content-identity-v1'
      or public.public_source_acquisition_identity_digest(v_version.id) is distinct from v_version.acquisition_identity_digest
      then return null; end if;
    v_digest := 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
      'acquisition', public.public_source_acquisition_identity_digest(v_version.id),
      'version', v_version.id, 'lifecycle', v_version.lifecycle, 'event', v_event.id,
      'sequence', v_event.source_sequence, 'decision', v_event.decision,
      'policy', v_event.source_policy_version, 'policy_digest', v_event.source_policy_digest
    )::text, 'UTF8'), 'sha256'), 'hex');
  else
    -- Any public-source marker forbids silently entering the non-catalogue branch.
    if v_metadata ?| array['source_catalogue_key','source_policy_version','source_policy_digest','source_activation_event_id',
      'source_canonical_url','source_exact_url','source_exact_version','source_content_hash',
      'licence_evidence_digest','public_source_lifecycle']
      or v_metadata->>'corpus_scope' = 'australian_public' then return null; end if;
    v_digest := 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
      'owner', v_document.owner_id, 'source', v_document.source_path, 'storage', v_document.storage_path,
      'file', v_document.file_name, 'file_type', v_document.file_type, 'file_size', v_document.file_size,
      'content_hash', v_document.content_hash, 'corpus_scope', v_metadata->'corpus_scope',
      'content_mode', v_metadata->'content_mode', 'licence_policy', v_metadata->'licence_policy',
      'source_policy_checked', v_metadata->'source_policy_checked', 'content_identity_verdict', v_metadata->'content_identity_verdict',
      'content_identity_hash', v_metadata->'content_identity_hash', 'content_identity_verdict_version', v_metadata->'content_identity_verdict_version',
      'canonical_storage_path', v_metadata->'canonical_storage_path', 'public_corpus', v_metadata->'public_corpus'
    )::text, 'UTF8'), 'sha256'), 'hex');
  end if;
  return jsonb_build_object('document', to_jsonb(v_document), 'authority_digest', v_digest);
end $$;

alter function public.read_shadow_document_authority_v1(uuid) owner to postgres;
revoke all on function public.read_shadow_document_authority_v1(uuid) from public, anon, authenticated, service_role;

-- Fixed relation and column closure; no dynamic SQL/table/column argument.
create or replace function public.shadow_capture_rows_v1(p_w uuid[], p_m uuid[])
returns table(table_name text,row_payload jsonb,row_order bytea[]) language sql stable set search_path = '' set timezone = 'UTC' as $$
with batches as (
  select d.import_batch_id as id from public.documents d where d.id=any(p_w) and d.import_batch_id is not null
  union select j.batch_id from public.ingestion_jobs j where j.document_id=any(p_w) and j.batch_id is not null
), jobs as (
  select j.id from public.ingestion_jobs j where j.document_id=any(p_w)
  union select j.id from public.indexing_v3_agent_jobs j where j.document_id=any(p_w)
), catalogue as (
  select d.metadata->>'source_catalogue_key' as key from public.documents d where d.id=any(p_w) and d.metadata ? 'source_catalogue_key'
  union select v.source_catalogue_key from public.public_source_versions v where v.staging_document_id=any(p_w)
), approvals as (
  select v.publication_approval_id as id from public.public_source_versions v where v.staging_document_id=any(p_w) and v.publication_approval_id is not null
  union select (d.metadata->>'publication_approval_id')::uuid from public.documents d
    where d.id=any(p_w) and d.metadata ? 'publication_approval_id' and d.metadata->'publication_approval_id'<>'null'::jsonb
), generations as (
  select g.index_generation_id as id from public.document_index_generations g where g.document_id=any(p_w)
)select 'documents'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'title', r.title,
    'description', r.description,
    'file_name', r.file_name,
    'file_type', r.file_type,
    'file_size', r.file_size,
    'storage_path', r.storage_path,
    'content_hash', r.content_hash,
    'source_path', r.source_path,
    'import_batch_id', r.import_batch_id,
    'status', r.status,
    'page_count', r.page_count,
    'chunk_count', r.chunk_count,
    'image_count', r.image_count,
    'error_message', r.error_message,
    'metadata', r.metadata,
    'search_tsv', r.search_tsv::text,
    'title_search_tsv', r.title_search_tsv::text,
    'index_generation_id', r.index_generation_id,
    'created_at', r.created_at,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.documents r where r.id=any(p_w)
union all
select 'document_pages'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'page_number', r.page_number,
    'text', r.text,
    'ocr_used', r.ocr_used,
    'metadata', r.metadata,
    'created_at', r.created_at,
    'index_generation_id', r.index_generation_id) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_pages r where r.document_id=any(p_w)
union all
select 'document_chunks'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'page_number', r.page_number,
    'chunk_index', r.chunk_index,
    'section_heading', r.section_heading,
    'section_path', r.section_path,
    'heading_level', r.heading_level,
    'parent_heading', r.parent_heading,
    'anchor_id', r.anchor_id,
    'content', r.content,
    'retrieval_synopsis', r.retrieval_synopsis,
    'content_hash', r.content_hash,
    'index_generation_id', r.index_generation_id,
    'token_estimate', r.token_estimate,
    'image_ids', r.image_ids,
    'metadata', r.metadata,
    'embedding', r.embedding::text,
    'search_tsv', r.search_tsv::text,
    'created_at', r.created_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_chunks r where r.document_id=any(p_w)
union all
select 'document_images'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'page_number', r.page_number,
    'storage_path', r.storage_path,
    'mime_type', r.mime_type,
    'caption', r.caption,
    'bbox', r.bbox,
    'image_type', r.image_type,
    'searchable', r.searchable,
    'clinical_relevance_score', r.clinical_relevance_score,
    'skip_reason', r.skip_reason,
    'source_kind', r.source_kind,
    'width', r.width,
    'height', r.height,
    'image_hash', r.image_hash,
    'perceptual_hash', r.perceptual_hash,
    'labels', r.labels,
    'index_generation_id', r.index_generation_id,
    'caption_confidence', r.caption_confidence,
    'clinical_priority_score', r.clinical_priority_score,
    'crop_completeness', r.crop_completeness,
    'image_quality_score', r.image_quality_score,
    'ocr_text_density', r.ocr_text_density,
    'structured_extraction_confidence', r.structured_extraction_confidence,
    'visual_duplicate_group', r.visual_duplicate_group,
    'metadata', r.metadata,
    'created_at', r.created_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_images r where r.document_id=any(p_w)
union all
select 'document_table_facts'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'document_id', r.document_id,
    'source_chunk_id', r.source_chunk_id,
    'source_image_id', r.source_image_id,
    'page_number', r.page_number,
    'table_title', r.table_title,
    'row_label', r.row_label,
    'clinical_parameter', r.clinical_parameter,
    'threshold_value', r.threshold_value,
    'action', r.action,
    'normalized_terms', r.normalized_terms,
    'index_generation_id', r.index_generation_id,
    'metadata', r.metadata,
    'search_tsv', r.search_tsv::text,
    'created_at', r.created_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_table_facts r where r.document_id=any(p_w)
union all
select 'document_embedding_fields'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'document_id', r.document_id,
    'source_chunk_id', r.source_chunk_id,
    'field_type', r.field_type,
    'content', r.content,
    'content_hash', r.content_hash,
    'embedding', r.embedding::text,
    'index_generation_id', r.index_generation_id,
    'metadata', r.metadata,
    'search_tsv', r.search_tsv::text,
    'created_at', r.created_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_embedding_fields r where r.document_id=any(p_w)
union all
select 'document_index_units'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'document_id', r.document_id,
    'unit_type', r.unit_type,
    'source_chunk_id', r.source_chunk_id,
    'source_image_id', r.source_image_id,
    'page_start', r.page_start,
    'page_end', r.page_end,
    'heading_path', r.heading_path,
    'title', r.title,
    'content', r.content,
    'normalized_terms', r.normalized_terms,
    'source_span', r.source_span,
    'quality_score', r.quality_score,
    'extraction_mode', r.extraction_mode,
    'index_generation_id', r.index_generation_id,
    'producer', r.producer,
    'artifact_generation_id', r.artifact_generation_id,
    'embedding', r.embedding::text,
    'metadata', r.metadata,
    'search_tsv', r.search_tsv::text,
    'created_at', r.created_at,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_index_units r where r.document_id=any(p_w)
union all
select 'document_sections'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'owner_id', r.owner_id,
    'section_index', r.section_index,
    'heading', r.heading,
    'heading_path', r.heading_path,
    'page_start', r.page_start,
    'page_end', r.page_end,
    'chunk_ids', r.chunk_ids,
    'summary', r.summary,
    'tags', r.tags,
    'extraction_quality', r.extraction_quality,
    'index_generation_id', r.index_generation_id,
    'producer', r.producer,
    'artifact_generation_id', r.artifact_generation_id,
    'metadata', r.metadata,
    'created_at', r.created_at,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_sections r where r.document_id=any(p_w)
union all
select 'document_memory_cards'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'owner_id', r.owner_id,
    'section_id', r.section_id,
    'card_type', r.card_type,
    'title', r.title,
    'content', r.content,
    'normalized_terms', r.normalized_terms,
    'page_number', r.page_number,
    'source_chunk_ids', r.source_chunk_ids,
    'source_image_ids', r.source_image_ids,
    'confidence', r.confidence,
    'index_generation_id', r.index_generation_id,
    'producer', r.producer,
    'artifact_generation_id', r.artifact_generation_id,
    'metadata', r.metadata,
    'embedding', r.embedding::text,
    'search_tsv', r.search_tsv::text,
    'created_at', r.created_at,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_memory_cards r where r.document_id=any(p_w)
union all
select 'document_summaries'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'owner_id', r.owner_id,
    'summary', r.summary,
    'clinical_specifics', r.clinical_specifics,
    'source_chunk_ids', r.source_chunk_ids,
    'source_image_ids', r.source_image_ids,
    'model', r.model,
    'metadata', r.metadata,
    'generated_at', r.generated_at,
    'created_at', r.created_at,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_summaries r where r.document_id=any(p_w)
union all
select 'document_labels'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'owner_id', r.owner_id,
    'label', r.label,
    'label_type', r.label_type,
    'source', r.source,
    'confidence', r.confidence,
    'metadata', r.metadata,
    'created_at', r.created_at,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_labels r where r.document_id=any(p_w)
union all
select 'document_index_quality'::text as table_name, pg_catalog.jsonb_build_object(
    'document_id', r.document_id,
    'owner_id', r.owner_id,
    'quality_score', r.quality_score,
    'extraction_quality', r.extraction_quality,
    'anchor_coverage', r.anchor_coverage,
    'model_fallback_rate', r.model_fallback_rate,
    'noisy_unit_rate', r.noisy_unit_rate,
    'retrievable_visual_hit', r.retrievable_visual_hit,
    'source_span_coverage', r.source_span_coverage,
    'typed_unit_coverage', r.typed_unit_coverage,
    'metrics', r.metrics,
    'issues', r.issues,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.document_id::text)] as row_order
from public.document_index_quality r where r.document_id=any(p_w)
union all
select 'ingestion_jobs'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'batch_id', r.batch_id,
    'status', r.status,
    'stage', r.stage,
    'progress', r.progress,
    'error_message', r.error_message,
    'attempt_count', r.attempt_count,
    'max_attempts', r.max_attempts,
    'locked_at', r.locked_at,
    'locked_by', r.locked_by,
    'next_run_at', r.next_run_at,
    'started_at', r.started_at,
    'completed_at', r.completed_at,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'lease_token', r.lease_token,
    'lease_expected_generation_id', r.lease_expected_generation_id,
    'lease_write_generation_id', r.lease_write_generation_id,
    'lease_authority_digest', r.lease_authority_digest,
    'lease_expires_at', r.lease_expires_at,
    'lease_duration_seconds', r.lease_duration_seconds,
    'operation', r.operation,
    'requested_generation_id', r.requested_generation_id,
    'shadow_plan_digest', r.shadow_plan_digest) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.ingestion_jobs r where r.document_id=any(p_w) or r.batch_id in (select id from batches)
union all
select 'indexing_v3_agent_jobs'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'status', r.status,
    'enrichment_status', r.enrichment_status,
    'attempt_count', r.attempt_count,
    'max_attempts', r.max_attempts,
    'locked_by', r.locked_by,
    'locked_at', r.locked_at,
    'next_run_at', r.next_run_at,
    'version', r.version,
    'last_error', r.last_error,
    'metadata', r.metadata,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'lease_token', r.lease_token,
    'lease_expected_generation_id', r.lease_expected_generation_id,
    'lease_write_generation_id', r.lease_write_generation_id,
    'lease_authority_digest', r.lease_authority_digest,
    'lease_expires_at', r.lease_expires_at,
    'lease_duration_seconds', r.lease_duration_seconds) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.indexing_v3_agent_jobs r where r.document_id=any(p_w)
union all
select 'ingestion_job_stages'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'job_id', r.job_id,
    'document_id', r.document_id,
    'stage_name', r.stage_name,
    'stage_status', r.stage_status,
    'error_class', r.error_class,
    'retry_count', r.retry_count,
    'metadata', r.metadata,
    'artifact_counts', r.artifact_counts,
    'error_message', r.error_message,
    'started_at', r.started_at,
    'finished_at', r.finished_at,
    'created_at', r.created_at,
    'job_kind', r.job_kind,
    'lease_token', r.lease_token,
    'index_generation_id', r.index_generation_id) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.ingestion_job_stages r where r.document_id=any(p_w) or r.job_id in (select id from jobs)
union all
select 'import_batches'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'name', r.name,
    'source_root', r.source_root,
    'include_glob', r.include_glob,
    'status', r.status,
    'total_files', r.total_files,
    'queued_files', r.queued_files,
    'skipped_files', r.skipped_files,
    'failed_files', r.failed_files,
    'total_bytes', r.total_bytes,
    'metadata', r.metadata,
    'completed_at', r.completed_at,
    'created_at', r.created_at,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.import_batches r where r.id in (select id from batches)
union all
select 'rag_aliases'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'alias', r.alias,
    'canonical', r.canonical,
    'alias_type', r.alias_type,
    'weight', r.weight,
    'enabled', r.enabled,
    'metadata', r.metadata,
    'created_at', r.created_at,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.rag_aliases r where r.metadata->>'document_id'=any(p_w::text[]) or r.id=any(p_m)
union all
select 'document_title_words'::text as table_name, pg_catalog.jsonb_build_object(
    'word', r.word,
    'document_id', r.document_id) as row_payload, array[public.shadow_utf16_order_v1(r.word::text), public.shadow_utf16_order_v1(r.document_id::text)] as row_order
from public.document_title_words r where r.document_id=any(p_w)
union all
select 'public_source_versions'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'source_catalogue_key', r.source_catalogue_key,
    'source_policy_version', r.source_policy_version,
    'source_policy_digest', r.source_policy_digest,
    'exact_canonical_url', r.exact_canonical_url,
    'exact_version_url', r.exact_version_url,
    'exact_version', r.exact_version,
    'content_hash', r.content_hash,
    'staged_content_hash', r.staged_content_hash,
    'retrieved_at', r.retrieved_at,
    'licence_evidence_digest', r.licence_evidence_digest,
    'staging_document_id', r.staging_document_id,
    'extraction_generation_id', r.extraction_generation_id,
    'index_generation_id', r.index_generation_id,
    'lifecycle', r.lifecycle,
    'acquisition_identity_digest', r.acquisition_identity_digest,
    'supersedes_version_id', r.supersedes_version_id,
    'activation_event_id', r.activation_event_id,
    'staging_owner_id', r.staging_owner_id,
    'publication_approval_id', r.publication_approval_id,
    'publication_manifest_digest', r.publication_manifest_digest,
    'publication_reviewed_state_digest', r.publication_reviewed_state_digest,
    'publication_reviewed_index_generation_id', r.publication_reviewed_index_generation_id,
    'created_at', r.created_at,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.public_source_versions r where r.staging_document_id=any(p_w)
union all
select 'public_source_activation_events'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'source_catalogue_key', r.source_catalogue_key,
    'source_policy_version', r.source_policy_version,
    'source_policy_digest', r.source_policy_digest,
    'decision', r.decision,
    'operator_id', r.operator_id,
    'reason', r.reason,
    'evidence_references', r.evidence_references,
    'source_sequence', r.source_sequence,
    'created_at', r.created_at) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.public_source_activation_events r where r.source_catalogue_key in (select key from catalogue)
union all
select 'public_source_serving_authority'::text as table_name, pg_catalog.jsonb_build_object(
    'singleton', r.singleton,
    'lifecycle_epoch', r.lifecycle_epoch,
    'updated_at', r.updated_at) as row_payload, array[public.shadow_utf16_order_v1(r.singleton::text)] as row_order
from public.public_source_serving_authority r where r.singleton=true
union all
select 'document_publication_approvals'::text as table_name, pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'expected_prior_owner_id', r.expected_prior_owner_id,
    'approving_operator_id', r.approving_operator_id,
    'decision', r.decision,
    'reason', r.reason,
    'evidence_references', r.evidence_references,
    'manifest_digest', r.manifest_digest,
    'reviewed_state_digest', r.reviewed_state_digest,
    'approved_at', r.approved_at,
    'source_catalogue_key', r.source_catalogue_key,
    'source_policy_version', r.source_policy_version,
    'reviewed_index_generation_id', r.reviewed_index_generation_id) as row_payload, array[public.shadow_utf16_order_v1(r.id::text)] as row_order
from public.document_publication_approvals r where r.document_id=any(p_w) or r.id in (select id from approvals)
union all
select 'shadow_reindex_waves'::text as table_name, pg_catalog.jsonb_build_object(
    'candidate_generation_id', r.candidate_generation_id,
    'plan_digest', r.plan_digest,
    'plan_version', r.plan_version,
    'project_ref', r.project_ref,
    'source_policy_version', r.source_policy_version,
    'audit_digest', r.audit_digest,
    'population_fingerprint', r.population_fingerprint,
    'recovery_evidence_digest', r.recovery_evidence_digest,
    'baseline_evaluation_digest', r.baseline_evaluation_digest,
    'operation_manifest_digest', r.operation_manifest_digest,
    'plan_payload', r.plan_payload,
    'created_at', r.created_at,
    'prepared_origin_digest', r.prepared_origin_digest,
    'execution_profile_digest', r.execution_profile_digest,
    'case_set_digest', r.case_set_digest,
    'baseline_report', r.baseline_report,
    'baseline_report_digest', r.baseline_report_digest) as row_payload, array[public.shadow_utf16_order_v1(r.candidate_generation_id::text)] as row_order
from public.shadow_reindex_waves r where r.candidate_generation_id in (select id from generations)
union all
select 'document_index_generations'::text as table_name, pg_catalog.jsonb_build_object(
    'document_id', r.document_id,
    'index_generation_id', r.index_generation_id,
    'owner_id', r.owner_id,
    'baseline_generation_id', r.baseline_generation_id,
    'expected_state_digest', r.expected_state_digest,
    'authority_digest', r.authority_digest,
    'source_binding', r.source_binding,
    'job_id', r.job_id,
    'first_lease_token', r.first_lease_token,
    'claimed_at', r.claimed_at,
    'state', r.state,
    'expected_inventory_digest', r.expected_inventory_digest,
    'inventory_digest', r.inventory_digest,
    'candidate_projection_digest', r.candidate_projection_digest,
    'baseline_bundle_digest', r.baseline_bundle_digest,
    'stage_receipt', r.stage_receipt,
    'stage_receipt_digest', r.stage_receipt_digest,
    'staged_at', r.staged_at,
    'control_revision', r.control_revision,
    'control_snapshot', r.control_snapshot,
    'original_origin_envelope', r.original_origin_envelope,
    'inventory_manifest', r.inventory_manifest) as row_payload, array[public.shadow_utf16_order_v1(r.document_id::text), public.shadow_utf16_order_v1(r.index_generation_id::text)] as row_order
from public.document_index_generations r where r.document_id=any(p_w)
union all
select 'document_generation_projections'::text as table_name, pg_catalog.jsonb_build_object(
    'document_id', r.document_id,
    'index_generation_id', r.index_generation_id,
    'lease_token', r.lease_token,
    'owner_id', r.owner_id,
    'summary', r.summary,
    'generated_labels', r.generated_labels,
    'summary_projection_complete', r.summary_projection_complete,
    'enrichment_metadata', r.enrichment_metadata,
    'quality', r.quality,
    'worker_metadata', r.worker_metadata,
    'document_counts', r.document_counts,
    'deep_memory_artifact_generation_id', r.deep_memory_artifact_generation_id,
    'deep_memory_receipt', r.deep_memory_receipt,
    'deep_memory_metadata', r.deep_memory_metadata,
    'producer_aliases', r.producer_aliases,
    'summary_digest', r.summary_digest,
    'quality_digest', r.quality_digest,
    'deep_memory_digest', r.deep_memory_digest,
    'worker_state_digest', r.worker_state_digest,
    'sealed_at', r.sealed_at) as row_payload, array[public.shadow_utf16_order_v1(r.document_id::text), public.shadow_utf16_order_v1(r.index_generation_id::text)] as row_order
from public.document_generation_projections r where r.document_id=any(p_w)
union all
select 'document_generation_inventory'::text as table_name, pg_catalog.jsonb_build_object(
    'document_id', r.document_id,
    'index_generation_id', r.index_generation_id,
    'family', r.family,
    'unit_key', r.unit_key,
    'lease_token', r.lease_token,
    'expected', r.expected,
    'required', r.required,
    'disposition', r.disposition,
    'reason_code', r.reason_code,
    'limitations', r.limitations,
    'producer', r.producer,
    'artifact_generation_id', r.artifact_generation_id,
    'artifact_ref', r.artifact_ref,
    'content_digest', r.content_digest,
    'source_binding', r.source_binding,
    'relationships', r.relationships,
    'retained_evidence_text', r.retained_evidence_text,
    'retained_native_payload', r.retained_native_payload,
    'representation_version', r.representation_version,
    'transform_version', r.transform_version) as row_payload, array[public.shadow_utf16_order_v1(r.document_id::text), public.shadow_utf16_order_v1(r.index_generation_id::text), public.shadow_utf16_order_v1(r.family::text), public.shadow_utf16_order_v1(r.unit_key::text)] as row_order
from public.document_generation_inventory r where r.document_id=any(p_w)
union all
select 'document_generation_baselines'::text as table_name, pg_catalog.jsonb_build_object(
    'document_id', r.document_id,
    'candidate_generation_id', r.candidate_generation_id,
    'baseline_generation_id', r.baseline_generation_id,
    'expected_state_digest', r.expected_state_digest,
    'bundle_version', r.bundle_version,
    'bundle_payload', r.bundle_payload,
    'bundle_digest', r.bundle_digest,
    'captured_at', r.captured_at) as row_payload, array[public.shadow_utf16_order_v1(r.document_id::text), public.shadow_utf16_order_v1(r.candidate_generation_id::text)] as row_order
from public.document_generation_baselines r where r.document_id=any(p_w);
$$;
alter function public.shadow_capture_rows_v1(uuid[],uuid[]) owner to postgres;
revoke all on function public.shadow_capture_rows_v1(uuid[],uuid[]) from public, anon, authenticated, service_role;

create or replace function public.shadow_capture_count_v1(p_w uuid[], p_m uuid[])
returns bigint language sql stable set search_path = '' as $$
with batches as (
  select d.import_batch_id as id from public.documents d where d.id=any(p_w) and d.import_batch_id is not null
  union select j.batch_id from public.ingestion_jobs j where j.document_id=any(p_w) and j.batch_id is not null
), jobs as (
  select j.id from public.ingestion_jobs j where j.document_id=any(p_w)
  union select j.id from public.indexing_v3_agent_jobs j where j.document_id=any(p_w)
), catalogue as (
  select d.metadata->>'source_catalogue_key' as key from public.documents d where d.id=any(p_w) and d.metadata ? 'source_catalogue_key'
  union select v.source_catalogue_key from public.public_source_versions v where v.staging_document_id=any(p_w)
), approvals as (
  select v.publication_approval_id as id from public.public_source_versions v where v.staging_document_id=any(p_w) and v.publication_approval_id is not null
  union select (d.metadata->>'publication_approval_id')::uuid from public.documents d
    where d.id=any(p_w) and d.metadata ? 'publication_approval_id' and d.metadata->'publication_approval_id'<>'null'::jsonb
), generations as (
  select g.index_generation_id as id from public.document_index_generations g where g.document_id=any(p_w)
)select pg_catalog.sum(n)::bigint from (
select pg_catalog.count(*) as n from public.documents r where r.id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_pages r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_chunks r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_images r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_table_facts r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_embedding_fields r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_index_units r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_sections r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_memory_cards r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_summaries r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_labels r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_index_quality r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.ingestion_jobs r where r.document_id=any(p_w) or r.batch_id in (select id from batches)
union all
select pg_catalog.count(*) as n from public.indexing_v3_agent_jobs r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.ingestion_job_stages r where r.document_id=any(p_w) or r.job_id in (select id from jobs)
union all
select pg_catalog.count(*) as n from public.import_batches r where r.id in (select id from batches)
union all
select pg_catalog.count(*) as n from public.rag_aliases r where r.metadata->>'document_id'=any(p_w::text[]) or r.id=any(p_m)
union all
select pg_catalog.count(*) as n from public.document_title_words r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.public_source_versions r where r.staging_document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.public_source_activation_events r where r.source_catalogue_key in (select key from catalogue)
union all
select pg_catalog.count(*) as n from public.public_source_serving_authority r where r.singleton=true
union all
select pg_catalog.count(*) as n from public.document_publication_approvals r where r.document_id=any(p_w) or r.id in (select id from approvals)
union all
select pg_catalog.count(*) as n from public.shadow_reindex_waves r where r.candidate_generation_id in (select id from generations)
union all
select pg_catalog.count(*) as n from public.document_index_generations r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_generation_projections r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_generation_inventory r where r.document_id=any(p_w)
union all
select pg_catalog.count(*) as n from public.document_generation_baselines r where r.document_id=any(p_w)
) counts;
$$;
alter function public.shadow_capture_count_v1(uuid[],uuid[]) owner to postgres;
revoke all on function public.shadow_capture_count_v1(uuid[],uuid[]) from public, anon, authenticated, service_role;

create or replace function public.shadow_capture_envelope_v1(p_value jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('version',1,'domain','baseline','encoding','pg-jsonb-text-v1',
    'canonicalPayload',p_value::text,'digest','sha256:' || pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(E'U04-SHADOW/1\nbaseline\npg-jsonb-text-v1\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(p_value::text,'UTF8'))::text || E'\n' || p_value::text,'UTF8'),'sha256'),'hex'));
$$;
alter function public.shadow_capture_envelope_v1(jsonb) owner to postgres;
revoke all on function public.shadow_capture_envelope_v1(jsonb) from public, anon, authenticated, service_role;

-- Streaming scalar aggregates measure every full encoded row BEFORE any array build.
create or replace function public.shadow_capture_bytes_v1(p_w uuid[], p_m uuid[])
returns numeric language sql stable set search_path = '' set timezone = 'UTC' as $$
with batches as (
  select d.import_batch_id as id from public.documents d where d.id=any(p_w) and d.import_batch_id is not null
  union select j.batch_id from public.ingestion_jobs j where j.document_id=any(p_w) and j.batch_id is not null
), jobs as (
  select j.id from public.ingestion_jobs j where j.document_id=any(p_w)
  union select j.id from public.indexing_v3_agent_jobs j where j.document_id=any(p_w)
), catalogue as (
  select d.metadata->>'source_catalogue_key' as key from public.documents d where d.id=any(p_w) and d.metadata ? 'source_catalogue_key'
  union select v.source_catalogue_key from public.public_source_versions v where v.staging_document_id=any(p_w)
), approvals as (
  select v.publication_approval_id as id from public.public_source_versions v where v.staging_document_id=any(p_w) and v.publication_approval_id is not null
  union select (d.metadata->>'publication_approval_id')::uuid from public.documents d
    where d.id=any(p_w) and d.metadata ? 'publication_approval_id' and d.metadata->'publication_approval_id'<>'null'::jsonb
), generations as (
  select g.index_generation_id as id from public.document_index_generations g where g.document_id=any(p_w)
)select pg_catalog.sum(n) from (
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'title', r.title,
    'description', r.description,
    'file_name', r.file_name,
    'file_type', r.file_type,
    'file_size', r.file_size,
    'storage_path', r.storage_path,
    'content_hash', r.content_hash,
    'source_path', r.source_path,
    'import_batch_id', r.import_batch_id,
    'status', r.status,
    'page_count', r.page_count,
    'chunk_count', r.chunk_count,
    'image_count', r.image_count,
    'error_message', r.error_message,
    'metadata', r.metadata,
    'search_tsv', r.search_tsv::text,
    'title_search_tsv', r.title_search_tsv::text,
    'index_generation_id', r.index_generation_id,
    'created_at', r.created_at,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.documents r where r.id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'page_number', r.page_number,
    'text', r.text,
    'ocr_used', r.ocr_used,
    'metadata', r.metadata,
    'created_at', r.created_at,
    'index_generation_id', r.index_generation_id))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_pages r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'page_number', r.page_number,
    'chunk_index', r.chunk_index,
    'section_heading', r.section_heading,
    'section_path', r.section_path,
    'heading_level', r.heading_level,
    'parent_heading', r.parent_heading,
    'anchor_id', r.anchor_id,
    'content', r.content,
    'retrieval_synopsis', r.retrieval_synopsis,
    'content_hash', r.content_hash,
    'index_generation_id', r.index_generation_id,
    'token_estimate', r.token_estimate,
    'image_ids', r.image_ids,
    'metadata', r.metadata,
    'embedding', r.embedding::text,
    'search_tsv', r.search_tsv::text,
    'created_at', r.created_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_chunks r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'page_number', r.page_number,
    'storage_path', r.storage_path,
    'mime_type', r.mime_type,
    'caption', r.caption,
    'bbox', r.bbox,
    'image_type', r.image_type,
    'searchable', r.searchable,
    'clinical_relevance_score', r.clinical_relevance_score,
    'skip_reason', r.skip_reason,
    'source_kind', r.source_kind,
    'width', r.width,
    'height', r.height,
    'image_hash', r.image_hash,
    'perceptual_hash', r.perceptual_hash,
    'labels', r.labels,
    'index_generation_id', r.index_generation_id,
    'caption_confidence', r.caption_confidence,
    'clinical_priority_score', r.clinical_priority_score,
    'crop_completeness', r.crop_completeness,
    'image_quality_score', r.image_quality_score,
    'ocr_text_density', r.ocr_text_density,
    'structured_extraction_confidence', r.structured_extraction_confidence,
    'visual_duplicate_group', r.visual_duplicate_group,
    'metadata', r.metadata,
    'created_at', r.created_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_images r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'document_id', r.document_id,
    'source_chunk_id', r.source_chunk_id,
    'source_image_id', r.source_image_id,
    'page_number', r.page_number,
    'table_title', r.table_title,
    'row_label', r.row_label,
    'clinical_parameter', r.clinical_parameter,
    'threshold_value', r.threshold_value,
    'action', r.action,
    'normalized_terms', r.normalized_terms,
    'index_generation_id', r.index_generation_id,
    'metadata', r.metadata,
    'search_tsv', r.search_tsv::text,
    'created_at', r.created_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_table_facts r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'document_id', r.document_id,
    'source_chunk_id', r.source_chunk_id,
    'field_type', r.field_type,
    'content', r.content,
    'content_hash', r.content_hash,
    'embedding', r.embedding::text,
    'index_generation_id', r.index_generation_id,
    'metadata', r.metadata,
    'search_tsv', r.search_tsv::text,
    'created_at', r.created_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_embedding_fields r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'document_id', r.document_id,
    'unit_type', r.unit_type,
    'source_chunk_id', r.source_chunk_id,
    'source_image_id', r.source_image_id,
    'page_start', r.page_start,
    'page_end', r.page_end,
    'heading_path', r.heading_path,
    'title', r.title,
    'content', r.content,
    'normalized_terms', r.normalized_terms,
    'source_span', r.source_span,
    'quality_score', r.quality_score,
    'extraction_mode', r.extraction_mode,
    'index_generation_id', r.index_generation_id,
    'producer', r.producer,
    'artifact_generation_id', r.artifact_generation_id,
    'embedding', r.embedding::text,
    'metadata', r.metadata,
    'search_tsv', r.search_tsv::text,
    'created_at', r.created_at,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_index_units r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'owner_id', r.owner_id,
    'section_index', r.section_index,
    'heading', r.heading,
    'heading_path', r.heading_path,
    'page_start', r.page_start,
    'page_end', r.page_end,
    'chunk_ids', r.chunk_ids,
    'summary', r.summary,
    'tags', r.tags,
    'extraction_quality', r.extraction_quality,
    'index_generation_id', r.index_generation_id,
    'producer', r.producer,
    'artifact_generation_id', r.artifact_generation_id,
    'metadata', r.metadata,
    'created_at', r.created_at,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_sections r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'owner_id', r.owner_id,
    'section_id', r.section_id,
    'card_type', r.card_type,
    'title', r.title,
    'content', r.content,
    'normalized_terms', r.normalized_terms,
    'page_number', r.page_number,
    'source_chunk_ids', r.source_chunk_ids,
    'source_image_ids', r.source_image_ids,
    'confidence', r.confidence,
    'index_generation_id', r.index_generation_id,
    'producer', r.producer,
    'artifact_generation_id', r.artifact_generation_id,
    'metadata', r.metadata,
    'embedding', r.embedding::text,
    'search_tsv', r.search_tsv::text,
    'created_at', r.created_at,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_memory_cards r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'owner_id', r.owner_id,
    'summary', r.summary,
    'clinical_specifics', r.clinical_specifics,
    'source_chunk_ids', r.source_chunk_ids,
    'source_image_ids', r.source_image_ids,
    'model', r.model,
    'metadata', r.metadata,
    'generated_at', r.generated_at,
    'created_at', r.created_at,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_summaries r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'owner_id', r.owner_id,
    'label', r.label,
    'label_type', r.label_type,
    'source', r.source,
    'confidence', r.confidence,
    'metadata', r.metadata,
    'created_at', r.created_at,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_labels r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'document_id', r.document_id,
    'owner_id', r.owner_id,
    'quality_score', r.quality_score,
    'extraction_quality', r.extraction_quality,
    'anchor_coverage', r.anchor_coverage,
    'model_fallback_rate', r.model_fallback_rate,
    'noisy_unit_rate', r.noisy_unit_rate,
    'retrievable_visual_hit', r.retrievable_visual_hit,
    'source_span_coverage', r.source_span_coverage,
    'typed_unit_coverage', r.typed_unit_coverage,
    'metrics', r.metrics,
    'issues', r.issues,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_index_quality r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'batch_id', r.batch_id,
    'status', r.status,
    'stage', r.stage,
    'progress', r.progress,
    'error_message', r.error_message,
    'attempt_count', r.attempt_count,
    'max_attempts', r.max_attempts,
    'locked_at', r.locked_at,
    'locked_by', r.locked_by,
    'next_run_at', r.next_run_at,
    'started_at', r.started_at,
    'completed_at', r.completed_at,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'lease_token', r.lease_token,
    'lease_expected_generation_id', r.lease_expected_generation_id,
    'lease_write_generation_id', r.lease_write_generation_id,
    'lease_authority_digest', r.lease_authority_digest,
    'lease_expires_at', r.lease_expires_at,
    'lease_duration_seconds', r.lease_duration_seconds,
    'operation', r.operation,
    'requested_generation_id', r.requested_generation_id,
    'shadow_plan_digest', r.shadow_plan_digest))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.ingestion_jobs r where r.document_id=any(p_w) or r.batch_id in (select id from batches)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'status', r.status,
    'enrichment_status', r.enrichment_status,
    'attempt_count', r.attempt_count,
    'max_attempts', r.max_attempts,
    'locked_by', r.locked_by,
    'locked_at', r.locked_at,
    'next_run_at', r.next_run_at,
    'version', r.version,
    'last_error', r.last_error,
    'metadata', r.metadata,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'lease_token', r.lease_token,
    'lease_expected_generation_id', r.lease_expected_generation_id,
    'lease_write_generation_id', r.lease_write_generation_id,
    'lease_authority_digest', r.lease_authority_digest,
    'lease_expires_at', r.lease_expires_at,
    'lease_duration_seconds', r.lease_duration_seconds))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.indexing_v3_agent_jobs r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'job_id', r.job_id,
    'document_id', r.document_id,
    'stage_name', r.stage_name,
    'stage_status', r.stage_status,
    'error_class', r.error_class,
    'retry_count', r.retry_count,
    'metadata', r.metadata,
    'artifact_counts', r.artifact_counts,
    'error_message', r.error_message,
    'started_at', r.started_at,
    'finished_at', r.finished_at,
    'created_at', r.created_at,
    'job_kind', r.job_kind,
    'lease_token', r.lease_token,
    'index_generation_id', r.index_generation_id))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.ingestion_job_stages r where r.document_id=any(p_w) or r.job_id in (select id from jobs)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'name', r.name,
    'source_root', r.source_root,
    'include_glob', r.include_glob,
    'status', r.status,
    'total_files', r.total_files,
    'queued_files', r.queued_files,
    'skipped_files', r.skipped_files,
    'failed_files', r.failed_files,
    'total_bytes', r.total_bytes,
    'metadata', r.metadata,
    'completed_at', r.completed_at,
    'created_at', r.created_at,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.import_batches r where r.id in (select id from batches)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'owner_id', r.owner_id,
    'alias', r.alias,
    'canonical', r.canonical,
    'alias_type', r.alias_type,
    'weight', r.weight,
    'enabled', r.enabled,
    'metadata', r.metadata,
    'created_at', r.created_at,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.rag_aliases r where r.metadata->>'document_id'=any(p_w::text[]) or r.id=any(p_m)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'word', r.word,
    'document_id', r.document_id))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_title_words r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'source_catalogue_key', r.source_catalogue_key,
    'source_policy_version', r.source_policy_version,
    'source_policy_digest', r.source_policy_digest,
    'exact_canonical_url', r.exact_canonical_url,
    'exact_version_url', r.exact_version_url,
    'exact_version', r.exact_version,
    'content_hash', r.content_hash,
    'staged_content_hash', r.staged_content_hash,
    'retrieved_at', r.retrieved_at,
    'licence_evidence_digest', r.licence_evidence_digest,
    'staging_document_id', r.staging_document_id,
    'extraction_generation_id', r.extraction_generation_id,
    'index_generation_id', r.index_generation_id,
    'lifecycle', r.lifecycle,
    'acquisition_identity_digest', r.acquisition_identity_digest,
    'supersedes_version_id', r.supersedes_version_id,
    'activation_event_id', r.activation_event_id,
    'staging_owner_id', r.staging_owner_id,
    'publication_approval_id', r.publication_approval_id,
    'publication_manifest_digest', r.publication_manifest_digest,
    'publication_reviewed_state_digest', r.publication_reviewed_state_digest,
    'publication_reviewed_index_generation_id', r.publication_reviewed_index_generation_id,
    'created_at', r.created_at,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.public_source_versions r where r.staging_document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'source_catalogue_key', r.source_catalogue_key,
    'source_policy_version', r.source_policy_version,
    'source_policy_digest', r.source_policy_digest,
    'decision', r.decision,
    'operator_id', r.operator_id,
    'reason', r.reason,
    'evidence_references', r.evidence_references,
    'source_sequence', r.source_sequence,
    'created_at', r.created_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.public_source_activation_events r where r.source_catalogue_key in (select key from catalogue)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'singleton', r.singleton,
    'lifecycle_epoch', r.lifecycle_epoch,
    'updated_at', r.updated_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.public_source_serving_authority r where r.singleton=true
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'id', r.id,
    'document_id', r.document_id,
    'expected_prior_owner_id', r.expected_prior_owner_id,
    'approving_operator_id', r.approving_operator_id,
    'decision', r.decision,
    'reason', r.reason,
    'evidence_references', r.evidence_references,
    'manifest_digest', r.manifest_digest,
    'reviewed_state_digest', r.reviewed_state_digest,
    'approved_at', r.approved_at,
    'source_catalogue_key', r.source_catalogue_key,
    'source_policy_version', r.source_policy_version,
    'reviewed_index_generation_id', r.reviewed_index_generation_id))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_publication_approvals r where r.document_id=any(p_w) or r.id in (select id from approvals)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'candidate_generation_id', r.candidate_generation_id,
    'plan_digest', r.plan_digest,
    'plan_version', r.plan_version,
    'project_ref', r.project_ref,
    'source_policy_version', r.source_policy_version,
    'audit_digest', r.audit_digest,
    'population_fingerprint', r.population_fingerprint,
    'recovery_evidence_digest', r.recovery_evidence_digest,
    'baseline_evaluation_digest', r.baseline_evaluation_digest,
    'operation_manifest_digest', r.operation_manifest_digest,
    'plan_payload', r.plan_payload,
    'created_at', r.created_at,
    'prepared_origin_digest', r.prepared_origin_digest,
    'execution_profile_digest', r.execution_profile_digest,
    'case_set_digest', r.case_set_digest,
    'baseline_report', r.baseline_report,
    'baseline_report_digest', r.baseline_report_digest))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.shadow_reindex_waves r where r.candidate_generation_id in (select id from generations)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'document_id', r.document_id,
    'index_generation_id', r.index_generation_id,
    'owner_id', r.owner_id,
    'baseline_generation_id', r.baseline_generation_id,
    'expected_state_digest', r.expected_state_digest,
    'authority_digest', r.authority_digest,
    'source_binding', r.source_binding,
    'job_id', r.job_id,
    'first_lease_token', r.first_lease_token,
    'claimed_at', r.claimed_at,
    'state', r.state,
    'expected_inventory_digest', r.expected_inventory_digest,
    'inventory_digest', r.inventory_digest,
    'candidate_projection_digest', r.candidate_projection_digest,
    'baseline_bundle_digest', r.baseline_bundle_digest,
    'stage_receipt', r.stage_receipt,
    'stage_receipt_digest', r.stage_receipt_digest,
    'staged_at', r.staged_at,
    'control_revision', r.control_revision,
    'control_snapshot', r.control_snapshot,
    'original_origin_envelope', r.original_origin_envelope,
    'inventory_manifest', r.inventory_manifest))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_index_generations r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'document_id', r.document_id,
    'index_generation_id', r.index_generation_id,
    'lease_token', r.lease_token,
    'owner_id', r.owner_id,
    'summary', r.summary,
    'generated_labels', r.generated_labels,
    'summary_projection_complete', r.summary_projection_complete,
    'enrichment_metadata', r.enrichment_metadata,
    'quality', r.quality,
    'worker_metadata', r.worker_metadata,
    'document_counts', r.document_counts,
    'deep_memory_artifact_generation_id', r.deep_memory_artifact_generation_id,
    'deep_memory_receipt', r.deep_memory_receipt,
    'deep_memory_metadata', r.deep_memory_metadata,
    'producer_aliases', r.producer_aliases,
    'summary_digest', r.summary_digest,
    'quality_digest', r.quality_digest,
    'deep_memory_digest', r.deep_memory_digest,
    'worker_state_digest', r.worker_state_digest,
    'sealed_at', r.sealed_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_generation_projections r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'document_id', r.document_id,
    'index_generation_id', r.index_generation_id,
    'family', r.family,
    'unit_key', r.unit_key,
    'lease_token', r.lease_token,
    'expected', r.expected,
    'required', r.required,
    'disposition', r.disposition,
    'reason_code', r.reason_code,
    'limitations', r.limitations,
    'producer', r.producer,
    'artifact_generation_id', r.artifact_generation_id,
    'artifact_ref', r.artifact_ref,
    'content_digest', r.content_digest,
    'source_binding', r.source_binding,
    'relationships', r.relationships,
    'retained_evidence_text', r.retained_evidence_text,
    'retained_native_payload', r.retained_native_payload,
    'representation_version', r.representation_version,
    'transform_version', r.transform_version))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_generation_inventory r where r.document_id=any(p_w)
union all
select coalesce(pg_catalog.sum(pg_catalog.octet_length(pg_catalog.convert_to(public.shadow_capture_envelope_v1(pg_catalog.jsonb_build_object(
    'document_id', r.document_id,
    'candidate_generation_id', r.candidate_generation_id,
    'baseline_generation_id', r.baseline_generation_id,
    'expected_state_digest', r.expected_state_digest,
    'bundle_version', r.bundle_version,
    'bundle_payload', r.bundle_payload,
    'bundle_digest', r.bundle_digest,
    'captured_at', r.captured_at))::text,'UTF8'))+2),0) - case when pg_catalog.count(*)>0 then 2 else 0 end as n
from public.document_generation_baselines r where r.document_id=any(p_w)
) sizes;
$$;
alter function public.shadow_capture_bytes_v1(uuid[],uuid[]) owner to postgres;
revoke all on function public.shadow_capture_bytes_v1(uuid[],uuid[]) from public, anon, authenticated, service_role;

create or replace function public.capture_shadow_reindex_origin_v1_impl(
  p_document_ids uuid[], p_source_policy_version text, p_manual_alias_ids uuid[], p_execution_profile_envelope jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare v_profile jsonb; v_document_id uuid; v_authority jsonb; v_document jsonb; v_metadata jsonb;
  v_policy jsonb; v_rows jsonb; v_origin jsonb; v_row record; v_envelope jsonb;
  v_count bigint; v_actual_count bigint := 0; v_base_bytes bigint; v_total_bytes numeric;
  v_max_bytes integer; v_max_rows integer; v_tables text[] := array[
    'documents','document_pages','document_chunks','document_images','document_table_facts','document_embedding_fields',
    'document_index_units','document_sections','document_memory_cards','document_summaries','document_labels','document_index_quality',
    'ingestion_jobs','indexing_v3_agent_jobs','ingestion_job_stages','import_batches','rag_aliases','document_title_words',
    'public_source_versions','public_source_activation_events','public_source_serving_authority','document_publication_approvals',
    'shadow_reindex_waves','document_index_generations','document_generation_projections','document_generation_inventory','document_generation_baselines'];
  v_table text;
begin
  v_profile := public.shadow_profile_capture_v1(p_execution_profile_envelope);
  if not coalesce(p_document_ids is not null and p_manual_alias_ids is not null
    and pg_catalog.array_ndims(p_document_ids)=1 and pg_catalog.array_lower(p_document_ids,1)=1
    and (pg_catalog.cardinality(p_manual_alias_ids)=0 or (pg_catalog.array_ndims(p_manual_alias_ids)=1 and pg_catalog.array_lower(p_manual_alias_ids,1)=1))
    and pg_catalog.array_position(p_document_ids,null) is null and pg_catalog.array_position(p_manual_alias_ids,null) is null
    and pg_catalog.to_jsonb(p_document_ids)=v_profile->'documentIds'
    and pg_catalog.to_jsonb(p_manual_alias_ids)=v_profile->'manualAliasIds'
    and pg_catalog.to_jsonb(p_source_policy_version)=v_profile->'sourcePolicyVersion',false) then raise exception 'invalid_shadow_profile'; end if;
  v_max_rows := (v_profile->'limits'->>'maxCapturedRows')::integer;
  v_max_bytes := (v_profile->'limits'->>'maxOriginBundleBytes')::integer;
  -- Match the independently reviewed complete original row in this statement snapshot.
  for v_policy in select value from pg_catalog.jsonb_array_elements(v_profile->'manualAliasReviews') loop
    v_policy:=public.shadow_manual_alias_review_v1(v_policy,v_profile);
    select pg_catalog.to_jsonb(a) into v_document from public.rag_aliases a where a.id=(v_policy->>'aliasId')::uuid;
    if v_document is null or v_document::text is distinct from v_policy->'rowEnvelope'->>'canonicalPayload' then raise exception 'shadow_manual_alias_changed'; end if;
  end loop;
  foreach v_document_id in array p_document_ids loop
    v_authority := public.read_shadow_document_authority_v1(v_document_id);
    if v_authority is null then raise exception 'shadow_source_authority_changed'; end if;
    v_document := v_authority->'document'; v_metadata := v_document->'metadata';
    if not coalesce((v_document->'owner_id'='null'::jsonb and v_profile->'access'->'includePublic'='true'::jsonb)
      or (v_profile->'access'->>'mode'='owner' and v_document->'owner_id'=v_profile->'access'->'ownerId'),false)
      then raise exception 'shadow_owner_scope_refused'; end if;
    if v_metadata ? 'index_generation_id' then
      if not coalesce(pg_catalog.jsonb_typeof(v_metadata->'index_generation_id')='string'
        and pg_catalog.length(v_metadata->>'index_generation_id')=36
        and v_metadata->>'index_generation_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and v_document->'index_generation_id'=v_metadata->'index_generation_id',false) then raise exception 'shadow_generation_identity_invalid'; end if;
    elsif v_document->'index_generation_id' is distinct from 'null'::jsonb then raise exception 'shadow_generation_identity_invalid'; end if;
    if v_metadata ? 'publication_approval_id' and v_metadata->'publication_approval_id'<>'null'::jsonb
      and not coalesce(pg_catalog.jsonb_typeof(v_metadata->'publication_approval_id')='string'
        and pg_catalog.length(v_metadata->>'publication_approval_id')=36
        and v_metadata->>'publication_approval_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
      then raise exception 'shadow_source_authority_changed'; end if;
    if v_metadata ? 'source_catalogue_key' then
      if v_metadata->>'source_policy_version' is distinct from p_source_policy_version then raise exception 'shadow_source_authority_changed'; end if;
    else
      select value into v_policy from pg_catalog.jsonb_array_elements(v_profile->'documentOwnedPolicies')
        where value->>'documentId'=v_document_id::text;
      if not coalesce(v_policy->'ownerId'=v_document->'owner_id' and v_policy->'contentHash'=v_document->'content_hash'
        and v_policy->>'sourcePolicyVersion'=p_source_policy_version,false) then raise exception 'shadow_document_policy_binding_missing'; end if;
    end if;
  end loop;
  if (select pg_catalog.count(*) from public.public_source_serving_authority where singleton=true)<>1 then raise exception 'shadow_snapshot_incomplete'; end if;
  v_count := public.shadow_capture_count_v1(p_document_ids,p_manual_alias_ids);
  if v_count>v_max_rows then raise exception 'evidence_too_large'; end if;
  v_rows := '{}'::jsonb;
  foreach v_table in array v_tables loop v_rows := v_rows || pg_catalog.jsonb_build_object(v_table,'[]'::jsonb); end loop;
  v_origin := pg_catalog.jsonb_build_object('kind','u04-origin-snapshot-v1','evidenceMode',v_profile->'evidenceMode',
    'capturedAt',pg_catalog.statement_timestamp(),'executionProfileEnvelope',p_execution_profile_envelope,
    'documentIds',p_document_ids,'manualAliasIds',p_manual_alias_ids,'sourcePolicyVersion',p_source_policy_version,'rows',v_rows);
  v_base_bytes := pg_catalog.octet_length(pg_catalog.convert_to(v_origin::text,'UTF8'));
  if v_base_bytes>v_max_bytes then raise exception 'evidence_too_large'; end if;
  -- Counts first, then streaming full-row byte aggregates, then bounded arrays.
  -- Exact separators: two bytes between rows, none for an empty population.
  v_total_bytes := public.shadow_capture_bytes_v1(p_document_ids,p_manual_alias_ids);
  if v_base_bytes+v_total_bytes>v_max_bytes then raise exception 'evidence_too_large'; end if;
  for v_row in select * from public.shadow_capture_rows_v1(p_document_ids,p_manual_alias_ids)
    order by table_name collate "C",row_order loop
    v_envelope := public.shadow_capture_envelope_v1(v_row.row_payload);
    v_actual_count := v_actual_count+1;
    if v_actual_count>v_max_rows then raise exception 'evidence_too_large'; end if;
    v_rows := pg_catalog.jsonb_set(v_rows,array[v_row.table_name],(v_rows->v_row.table_name)||pg_catalog.jsonb_build_array(v_envelope),false);
  end loop;
  if v_actual_count<>v_count then raise exception 'shadow_snapshot_incomplete'; end if;
  v_origin := pg_catalog.jsonb_set(v_origin,'{rows}',v_rows,false);
  if pg_catalog.octet_length(pg_catalog.convert_to(v_origin::text,'UTF8'))>v_max_bytes then raise exception 'evidence_too_large'; end if;
  return public.shadow_capture_envelope_v1(v_origin);
exception when others then
  if sqlerrm='evidence_too_large' then raise exception 'evidence_too_large' using errcode='22023'; end if;
  -- Never return raw private payload fragments from a JSON/UUID/numeric cast error.
  raise exception 'invalid_shadow_capture' using errcode='22023';
end $$;
alter function public.capture_shadow_reindex_origin_v1_impl(uuid[],text,uuid[],jsonb) owner to postgres;
revoke all on function public.capture_shadow_reindex_origin_v1_impl(uuid[],text,uuid[],jsonb) from public, anon, authenticated, service_role;

-- One fixed STABLE statement snapshot; supplied profile identity is not approval.
create or replace function public.capture_shadow_reindex_origin(
  p_document_ids uuid[], p_source_policy_version text, p_manual_alias_ids uuid[], p_execution_profile_envelope jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.capture_shadow_reindex_origin_v1_impl(p_document_ids,p_source_policy_version,p_manual_alias_ids,p_execution_profile_envelope);
$$;
alter function public.capture_shadow_reindex_origin(uuid[],text,uuid[],jsonb) owner to postgres;
revoke all on function public.capture_shadow_reindex_origin(uuid[],text,uuid[],jsonb) from public, anon, authenticated, service_role;
grant execute on function public.capture_shadow_reindex_origin(uuid[],text,uuid[],jsonb) to service_role;

-- U04 fixed retention-safe persistence. Mutation entrypoints remain ungranted.
create or replace function public.shadow_keys_v1(p_value jsonb,p_keys text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_value)='object' and p_value ?& p_keys and p_value-p_keys='{}'::jsonb,false)
$$;
alter function public.shadow_keys_v1(jsonb,text[]) owner to postgres;
revoke all on function public.shadow_keys_v1(jsonb,text[]) from public,anon,authenticated,service_role;

create or replace function public.shadow_strict_original_json_v1(p_value json)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_item record; v_keys text[] := array[]::text[]; v_n numeric;
begin
  if pg_catalog.json_typeof(p_value)='object' then
    for v_item in select key,value from pg_catalog.json_each(p_value) loop
      if v_item.key=any(v_keys) then raise exception 'invalid_shadow_original_json'; end if;
      v_keys:=pg_catalog.array_append(v_keys,v_item.key);
      perform public.shadow_strict_original_json_v1(v_item.value);
    end loop;
  elsif pg_catalog.json_typeof(p_value)='array' then
    for v_item in select value from pg_catalog.json_array_elements(p_value) loop
      perform public.shadow_strict_original_json_v1(v_item.value);
    end loop;
  elsif pg_catalog.json_typeof(p_value)='number' then
    v_n:=p_value::text::numeric;
    if v_n=pg_catalog.trunc(v_n) and pg_catalog.abs(v_n)>9007199254740991 then raise exception 'invalid_shadow_original_integer'; end if;
    if v_n<>0 and v_n::double precision=0 then raise exception 'invalid_shadow_original_number'; end if;
    if v_n::double precision::text in ('Infinity','-Infinity','NaN') then raise exception 'invalid_shadow_original_number'; end if;
    if (public.shadow_node_json_text_v1(p_value))::numeric<>v_n then raise exception 'invalid_shadow_original_number'; end if;
  end if;
  return p_value::jsonb;
end $$;
alter function public.shadow_strict_original_json_v1(json) owner to postgres;
revoke all on function public.shadow_strict_original_json_v1(json) from public,anon,authenticated,service_role;

create or replace function public.shadow_node_value_text_v1(p_value jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare v_item record; v_result text; v_first boolean:=true;
begin
  if pg_catalog.jsonb_typeof(p_value)='object' then
    v_result:='{';
    for v_item in select key,value from pg_catalog.jsonb_each(p_value) order by public.shadow_utf16_order_v1(key) loop
      v_result:=v_result||case when v_first then '' else ',' end||pg_catalog.to_json(v_item.key)::text||':'||public.shadow_node_value_text_v1(v_item.value); v_first:=false;
    end loop; return v_result||'}';
  elsif pg_catalog.jsonb_typeof(p_value)='array' then
    v_result:='[';
    for v_item in select value from pg_catalog.jsonb_array_elements(p_value) loop
      v_result:=v_result||case when v_first then '' else ',' end||public.shadow_node_value_text_v1(v_item.value); v_first:=false;
    end loop; return v_result||']';
  end if;
  return public.shadow_node_json_text_v1(p_value::text::json);
end $$;
alter function public.shadow_node_value_text_v1(jsonb) owner to postgres;
revoke all on function public.shadow_node_value_text_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_node_payload_v1(p_envelope jsonb,p_domain text)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if not coalesce(public.shadow_capture_raw_envelope_valid_v1(p_envelope) and p_envelope->>'domain'=p_domain and p_envelope->>'encoding'='node-json-v1',false)
    or public.shadow_node_json_text_v1((p_envelope->>'canonicalPayload')::json) is distinct from p_envelope->>'canonicalPayload' then raise exception 'invalid_shadow_envelope'; end if;
  return public.shadow_strict_original_json_v1((p_envelope->>'canonicalPayload')::json);
end $$;
alter function public.shadow_node_payload_v1(jsonb,text) owner to postgres;
revoke all on function public.shadow_node_payload_v1(jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.shadow_original_file_v1(p_envelope jsonb,p_kind text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_wrapper jsonb; v_bytes bytea; v_text text;
begin
  v_wrapper:=public.shadow_node_payload_v1(p_envelope,'u04-retained-evidence-v1');
  if not public.shadow_keys_v1(v_wrapper,array['kind','bytes']) or v_wrapper->>'kind' is distinct from p_kind
    or not public.shadow_keys_v1(v_wrapper->'bytes',array['encoding','content']) or v_wrapper->'bytes'->>'encoding' is distinct from 'base64'
    or pg_catalog.jsonb_typeof(v_wrapper->'bytes'->'content') is distinct from 'string' then raise exception 'invalid_shadow_original_file'; end if;
  v_bytes:=pg_catalog.decode(v_wrapper->'bytes'->>'content','base64');
  if pg_catalog.replace(pg_catalog.encode(v_bytes,'base64'),E'\n','') is distinct from v_wrapper->'bytes'->>'content' then raise exception 'invalid_shadow_original_file'; end if;
  v_text:=pg_catalog.convert_from(v_bytes,'UTF8');
  if pg_catalog.left(v_text,1)=pg_catalog.chr(65279) then v_text:=pg_catalog.substr(v_text,2); end if;
  return pg_catalog.jsonb_build_object('value',public.shadow_strict_original_json_v1(v_text::json),
    'rawDigest','sha256:'||pg_catalog.encode(extensions.digest(v_bytes,'sha256'),'hex'));
end $$;
alter function public.shadow_original_file_v1(jsonb,text) owner to postgres;
revoke all on function public.shadow_original_file_v1(jsonb,text) from public,anon,authenticated,service_role;

-- This is the existing recovery owner's parsed-view algorithm, not envelope
-- framing or jsonb::text. Its closed ASCII key vocabulary has localeCompare
-- order equal to lower-case C order; all numeric leaves are exact integers.
create or replace function public.shadow_recovery_native_text_v1(p_value jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare v_item record; v_result text; v_first boolean:=true;
begin
  if pg_catalog.jsonb_typeof(p_value)='object' then
    v_result:='{';
    for v_item in select key,value from pg_catalog.jsonb_each(p_value) order by pg_catalog.lower(key) collate "C" loop
      v_result:=v_result||case when v_first then '' else ',' end||pg_catalog.to_json(v_item.key)::text||':'||public.shadow_recovery_native_text_v1(v_item.value); v_first:=false;
    end loop; return v_result||'}';
  elsif pg_catalog.jsonb_typeof(p_value)='array' then
    v_result:='[';
    for v_item in select value from pg_catalog.jsonb_array_elements(p_value) loop
      v_result:=v_result||case when v_first then '' else ',' end||public.shadow_recovery_native_text_v1(v_item.value); v_first:=false;
    end loop; return v_result||']';
  end if;
  if pg_catalog.jsonb_typeof(p_value)='number' then
    if p_value::text::numeric<>pg_catalog.trunc(p_value::text::numeric) or pg_catalog.abs(p_value::text::numeric)>9007199254740991 then raise exception 'invalid_shadow_recovery_integer'; end if;
    return p_value::text::numeric::bigint::text;
  end if;
  return p_value::text;
end $$;
alter function public.shadow_recovery_native_text_v1(jsonb) owner to postgres;
revoke all on function public.shadow_recovery_native_text_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_ecmascript_trim_v1(p_text text)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.btrim(p_text,pg_catalog.chr(9)||pg_catalog.chr(10)||pg_catalog.chr(11)||pg_catalog.chr(12)||pg_catalog.chr(13)||pg_catalog.chr(32)
    ||pg_catalog.chr(160)||pg_catalog.chr(5760)||pg_catalog.chr(8192)||pg_catalog.chr(8193)||pg_catalog.chr(8194)||pg_catalog.chr(8195)
    ||pg_catalog.chr(8196)||pg_catalog.chr(8197)||pg_catalog.chr(8198)||pg_catalog.chr(8199)||pg_catalog.chr(8200)||pg_catalog.chr(8201)||pg_catalog.chr(8202)
    ||pg_catalog.chr(8232)||pg_catalog.chr(8233)||pg_catalog.chr(8239)||pg_catalog.chr(8287)||pg_catalog.chr(12288)||pg_catalog.chr(65279))
$$;
alter function public.shadow_ecmascript_trim_v1(text) owner to postgres;
revoke all on function public.shadow_ecmascript_trim_v1(text) from public,anon,authenticated,service_role;

-- Same accepted datetime grammar as installed Zod 4.4.3, then Date.parse
-- milliseconds. Fractions are truncated BEFORE any PostgreSQL timestamp cast.
-- Integer elapsed milliseconds avoid session-TimeZone and DST calendar math.
create or replace function public.shadow_recovery_timestamp_ms_v1(p_text text)
returns bigint language plpgsql immutable set search_path = '' as $$
declare v_match text[]; v_year integer; v_days bigint; v_offset bigint:=0;
begin
  if p_text is null or p_text !~ '^(([0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29|[0-9]{4}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-8])))T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then raise exception 'invalid_shadow_recovery_clock'; end if;
  v_match:=pg_catalog.regexp_match(p_text,'^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(:([0-9]{2})(\.([0-9]+))?)?(Z|([+-])([0-9]{2}):([0-9]{2}))$');
  if v_match is null then raise exception 'invalid_shadow_recovery_clock'; end if;
  v_year:=v_match[1]::integer;
  v_days:=(pg_catalog.make_date(case when v_year=0 then -1 else v_year end,v_match[2]::integer,v_match[3]::integer)-date '1970-01-01')::bigint;
  if v_match[10]<>'Z' then v_offset:=(v_match[12]::bigint*60+v_match[13]::bigint)*60000*case when v_match[11]='-' then -1 else 1 end; end if;
  return v_days*86400000+v_match[4]::bigint*3600000+v_match[5]::bigint*60000+coalesce(v_match[7],'0')::bigint*1000
    +pg_catalog.rpad(pg_catalog.left(coalesce(v_match[9],''),3),3,'0')::bigint-v_offset;
end $$;
alter function public.shadow_recovery_timestamp_ms_v1(text) owner to postgres;
revoke all on function public.shadow_recovery_timestamp_ms_v1(text) from public,anon,authenticated,service_role;

create or replace function public.shadow_validate_recovery_v1(p_envelope jsonb,p_project text,p_now timestamptz)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_file jsonb; v jsonb; v_layer text; v_field text; v_value text; v_ref jsonb; v_time bigint; v_verified bigint; v_now bigint; v_digest text;
begin
  if p_now is null or not pg_catalog.isfinite(p_now) then raise exception 'invalid_shadow_recovery_clock'; end if;
  if p_project is null or p_project !~ '^[a-z0-9_-]{3,100}$' then raise exception 'invalid_shadow_recovery_target'; end if;
  v_now:=pg_catalog.trunc(extract(epoch from p_now)*1000)::bigint;
  v_file:=public.shadow_original_file_v1(p_envelope,'u04-recovery-readiness-bytes-v1'); v:=v_file->'value';
  if not public.shadow_keys_v1(v,array['version','evidenceId','projectRef','operation','verifiedAt','validUntil','requiredRpoMinutes','databaseBackup','pitr','storageRecovery','restoreDrill','digest'])
    or v->'version' is distinct from '1'::jsonb or v->>'operation' is distinct from 'document-generation'
    or not public.shadow_keys_v1(v->'databaseBackup',array['projectRef','recoveryBasisId','reference','digest','verifiedAt'])
    or not public.shadow_keys_v1(v->'pitr',array['projectRef','recoveryBasisId','enabled','rpoMinutes','reference','digest','verifiedAt'])
    or not public.shadow_keys_v1(v->'storageRecovery',array['projectRef','recoveryBasisId','inventoryReference','inventoryDigest','recoveryReference','recoveryDigest','verifiedAt'])
    or not public.shadow_keys_v1(v->'restoreDrill',array['projectRef','recoveryBasisId','targetProjectRef','reportReference','reportDigest','databaseBackupDigest','pitrDigest','storageInventoryDigest','storageRecoveryDigest','completedAt','outcome','target']) then raise exception 'invalid_shadow_recovery'; end if;
  -- Match the existing parser's projectRef trim before its internal digest.
  foreach v_layer in array array['','databaseBackup','pitr','storageRecovery','restoreDrill'] loop
    if v_layer='' then
      if pg_catalog.jsonb_typeof(v->'projectRef') is distinct from 'string' then raise exception 'invalid_shadow_recovery'; end if; v_value:=v->>'projectRef';
    else
      if pg_catalog.jsonb_typeof(v->v_layer->'projectRef') is distinct from 'string' then raise exception 'invalid_shadow_recovery'; end if; v_value:=v->v_layer->>'projectRef';
    end if;
    if v_value is null or public.shadow_ecmascript_trim_v1(v_value) !~ '^[a-z0-9_-]{3,100}$' then raise exception 'invalid_shadow_recovery'; end if;
    if v_layer='' then v:=pg_catalog.jsonb_set(v,array['projectRef'],pg_catalog.to_jsonb(public.shadow_ecmascript_trim_v1(v_value)));
    else v:=pg_catalog.jsonb_set(v,array[v_layer,'projectRef'],pg_catalog.to_jsonb(public.shadow_ecmascript_trim_v1(v_value))); end if;
    if public.shadow_ecmascript_trim_v1(v_value) is distinct from p_project then raise exception 'invalid_shadow_recovery_target'; end if;
  end loop;
  if pg_catalog.jsonb_typeof(v->'restoreDrill'->'targetProjectRef') is distinct from 'string' then raise exception 'invalid_shadow_recovery_target'; end if;
  v_value:=v->'restoreDrill'->>'targetProjectRef';
  if v_value is null or public.shadow_ecmascript_trim_v1(v_value) !~ '^[a-z0-9_-]{3,100}$' or public.shadow_ecmascript_trim_v1(v_value) is not distinct from p_project then raise exception 'invalid_shadow_recovery_target'; end if;
  v:=pg_catalog.jsonb_set(v,array['restoreDrill','targetProjectRef'],pg_catalog.to_jsonb(public.shadow_ecmascript_trim_v1(v_value)));
  if coalesce(v->>'evidenceId','') !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' then raise exception 'invalid_shadow_recovery'; end if;
  foreach v_layer in array array['databaseBackup','pitr','storageRecovery','restoreDrill'] loop
    if coalesce(v->v_layer->>'recoveryBasisId','') !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
      or v->v_layer->'recoveryBasisId' is distinct from v->'restoreDrill'->'recoveryBasisId' then raise exception 'invalid_shadow_recovery_basis'; end if;
  end loop;
  for v_ref in select value from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(v->'databaseBackup'->'reference',v->'pitr'->'reference',v->'storageRecovery'->'inventoryReference',v->'storageRecovery'->'recoveryReference',v->'restoreDrill'->'reportReference')) loop
    if not public.shadow_keys_v1(v_ref,array['kind','id']) or pg_catalog.jsonb_typeof(v_ref->'id') is distinct from 'string'
      or coalesce(v_ref->>'id','') !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
      or pg_catalog.regexp_replace(v_ref->>'id','[._-]','','g') ~ '(apikey|bearer|credential|password|secret|signature|signed|token)' then raise exception 'invalid_shadow_recovery_reference'; end if;
  end loop;
  if v->'databaseBackup'->'reference'->>'kind' is distinct from 'database-backup' or v->'pitr'->'reference'->>'kind' is distinct from 'pitr-status'
    or v->'storageRecovery'->'inventoryReference'->>'kind' is distinct from 'storage-inventory' or v->'storageRecovery'->'recoveryReference'->>'kind' is distinct from 'storage-recovery'
    or v->'restoreDrill'->'reportReference'->>'kind' is distinct from 'restore-drill' then raise exception 'invalid_shadow_recovery_reference'; end if;
  for v_value in select value #>> '{}' from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(v->'digest',v->'databaseBackup'->'digest',v->'pitr'->'digest',v->'storageRecovery'->'inventoryDigest',v->'storageRecovery'->'recoveryDigest',v->'restoreDrill'->'reportDigest',v->'restoreDrill'->'databaseBackupDigest',v->'restoreDrill'->'pitrDigest',v->'restoreDrill'->'storageInventoryDigest',v->'restoreDrill'->'storageRecoveryDigest')) loop
    if v_value is null or pg_catalog.length(v_value)<>71 or v_value !~ '^sha256:[0-9a-f]{64}$' then raise exception 'invalid_shadow_recovery_digest'; end if;
  end loop;
  v_digest:='sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(public.shadow_recovery_native_text_v1(v-'digest'),'UTF8'),'sha256'),'hex');
  if v_digest is distinct from v->>'digest' then raise exception 'invalid_shadow_recovery_digest'; end if;
  for v_value in select value #>> '{}' from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(v->'verifiedAt',v->'validUntil',v->'databaseBackup'->'verifiedAt',v->'pitr'->'verifiedAt',v->'storageRecovery'->'verifiedAt',v->'restoreDrill'->'completedAt')) loop
    perform public.shadow_recovery_timestamp_ms_v1(v_value);
  end loop;
  v_verified:=public.shadow_recovery_timestamp_ms_v1(v->>'verifiedAt');
  if v_verified-v_now>300000 or v_now-v_verified>86400000
    or public.shadow_recovery_timestamp_ms_v1(v->>'validUntil')<=v_now or public.shadow_recovery_timestamp_ms_v1(v->>'validUntil')<=v_verified
    or v->'pitr'->'enabled' is distinct from 'true'::jsonb or pg_catalog.jsonb_typeof(v->'requiredRpoMinutes') is distinct from 'number'
    or pg_catalog.jsonb_typeof(v->'pitr'->'rpoMinutes') is distinct from 'number'
    or (v->>'requiredRpoMinutes')::numeric not between 1 and 1440 or (v->'pitr'->>'rpoMinutes')::numeric not between 1 and 1440
    or (v->'pitr'->>'rpoMinutes')::numeric>(v->>'requiredRpoMinutes')::numeric then raise exception 'invalid_shadow_recovery_freshness'; end if;
  foreach v_layer in array array['databaseBackup','pitr','storageRecovery','restoreDrill'] loop
    v_field:=case when v_layer='restoreDrill' then 'completedAt' else 'verifiedAt' end; v_time:=public.shadow_recovery_timestamp_ms_v1(v->v_layer->>v_field);
    if v_time-v_now>300000 or v_time-v_verified>300000
      or v_now-v_time>(case when v_layer='restoreDrill' then 7776000000 when v_layer='storageRecovery' then 604800000 else 86400000 end) then raise exception 'invalid_shadow_recovery_freshness'; end if;
  end loop;
  if v->'restoreDrill'->>'outcome' is distinct from 'passed' or v->'restoreDrill'->>'target' is distinct from 'isolated-project'
    or v->'restoreDrill'->'databaseBackupDigest' is distinct from v->'databaseBackup'->'digest'
    or v->'restoreDrill'->'pitrDigest' is distinct from v->'pitr'->'digest'
    or v->'restoreDrill'->'storageInventoryDigest' is distinct from v->'storageRecovery'->'inventoryDigest'
    or v->'restoreDrill'->'storageRecoveryDigest' is distinct from v->'storageRecovery'->'recoveryDigest' then raise exception 'invalid_shadow_recovery_drill'; end if;
  return pg_catalog.jsonb_build_object('rawDigest',v_file->'rawDigest','evidence',v);
end $$;
alter function public.shadow_validate_recovery_v1(jsonb,text,timestamptz) owner to postgres;
revoke all on function public.shadow_validate_recovery_v1(jsonb,text,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.shadow_pg_bundle_v1(p_payload jsonb,p_domain text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_text text:=p_payload::text; v_digest text;
begin
  if p_domain is null or p_domain not in ('baseline','inventory','control','projection','member_receipt','wave_receipt','evaluation_report') or p_payload is null then raise exception 'invalid_shadow_bundle'; end if;
  v_digest:='sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(E'U04-SHADOW/1\n'||p_domain||E'\npg-jsonb-text-v1\n'||pg_catalog.octet_length(pg_catalog.convert_to(v_text,'UTF8'))::text||E'\n'||v_text,'UTF8'),'sha256'),'hex');
  return pg_catalog.jsonb_build_object('version',1,'domain',p_domain,'encoding','pg-jsonb-text-v1','canonicalPayload',v_text,'digest',v_digest);
end $$;
alter function public.shadow_pg_bundle_v1(jsonb,text) owner to postgres;
revoke all on function public.shadow_pg_bundle_v1(jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.shadow_validate_original_objects_v1(p_input jsonb,p_origin jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare v_entry jsonb; v_ref jsonb; v_bytes bytea; v_row jsonb; v_match jsonb; v_count integer; v_seen text[]:=array[]::text[]; v_identity text;
begin
  if pg_catalog.jsonb_typeof(p_input->'retainedEvidence') is distinct from 'array' then raise exception 'invalid_shadow_retained_evidence'; end if;
  for v_entry in select value from pg_catalog.jsonb_array_elements(p_input->'retainedEvidence') loop
    if v_entry->>'tag'='private_object' then
      if not public.shadow_keys_v1(v_entry,array['tag','ref','bytes']) or not public.shadow_keys_v1(v_entry->'bytes',array['encoding','content'])
        or v_entry->'bytes'->>'encoding' is distinct from 'base64' or pg_catalog.jsonb_typeof(v_entry->'bytes'->'content') is distinct from 'string'
        or not public.shadow_keys_v1(v_entry->'ref',array['tag','bucket','objectPath','objectVersion','sha256','byteLength','mediaType']) then raise exception 'invalid_shadow_retained_object'; end if;
      v_ref:=v_entry->'ref';
      if v_ref->>'tag' is distinct from 'private_object' or pg_catalog.jsonb_typeof(v_ref->'bucket') is distinct from 'string' or pg_catalog.length(v_ref->>'bucket')=0
        or pg_catalog.jsonb_typeof(v_ref->'objectPath') is distinct from 'string' or pg_catalog.length(v_ref->>'objectPath')=0
        or pg_catalog.jsonb_typeof(v_ref->'mediaType') is distinct from 'string' or pg_catalog.length(v_ref->>'mediaType')=0
        or not (v_ref->'objectVersion'='null'::jsonb or (pg_catalog.jsonb_typeof(v_ref->'objectVersion')='string' and pg_catalog.length(v_ref->>'objectVersion')>0))
        or pg_catalog.jsonb_typeof(v_ref->'byteLength') is distinct from 'number' or (v_ref->>'byteLength')::numeric<0
        or (v_ref->>'byteLength')::numeric<>pg_catalog.trunc((v_ref->>'byteLength')::numeric) then raise exception 'invalid_shadow_retained_object'; end if;
      v_bytes:=pg_catalog.decode(v_entry->'bytes'->>'content','base64');
      if pg_catalog.replace(pg_catalog.encode(v_bytes,'base64'),E'\n','') is distinct from v_entry->'bytes'->>'content'
        or pg_catalog.octet_length(v_bytes)::numeric<>(v_ref->>'byteLength')::numeric
        or 'sha256:'||pg_catalog.encode(extensions.digest(v_bytes,'sha256'),'hex') is distinct from v_ref->>'sha256' then raise exception 'invalid_shadow_retained_object'; end if;
      v_identity:='private_object/'||public.shadow_node_value_text_v1(v_ref);
    elsif v_entry->>'tag'='payload' then
      if not public.shadow_keys_v1(v_entry,array['tag','envelope','representation','mediaType','byteLength'])
        or not coalesce(public.shadow_capture_raw_envelope_valid_v1(v_entry->'envelope'),false)
        or pg_catalog.jsonb_typeof(v_entry->'representation') is distinct from 'string'
        or (v_entry->>'representation' in ('producer_text','producer_json','producer_bytes','cache_input','repair_audit_input','control_checkpoint')) is not true
        or pg_catalog.jsonb_typeof(v_entry->'mediaType') is distinct from 'string' or pg_catalog.length(v_entry->>'mediaType')=0
        or pg_catalog.jsonb_typeof(v_entry->'byteLength') is distinct from 'number'
        or (v_entry->>'byteLength')::numeric<>pg_catalog.octet_length(pg_catalog.convert_to(v_entry->'envelope'->>'canonicalPayload','UTF8')) then raise exception 'invalid_shadow_retained_payload'; end if;
      v_identity:='payload/'||(v_entry->'envelope'->>'digest');
    else raise exception 'invalid_shadow_retained_evidence'; end if;
    if v_identity=any(v_seen) then raise exception 'duplicate_shadow_retained_evidence'; end if;
    v_seen:=pg_catalog.array_append(v_seen,v_identity);
  end loop;
  for v_entry in select value from pg_catalog.jsonb_array_elements((p_origin->'rows'->'documents')||(p_origin->'rows'->'document_images')) loop
    if not coalesce(public.shadow_capture_raw_envelope_valid_v1(v_entry),false) then raise exception 'invalid_shadow_origin_row'; end if;
    v_row:=(v_entry->>'canonicalPayload')::jsonb;
    select count(*),pg_catalog.jsonb_agg(value)->0 into v_count,v_match from pg_catalog.jsonb_array_elements(p_input->'retainedEvidence')
      where value->>'tag'='private_object' and value->'ref'->'objectPath'=v_row->'storage_path';
    if v_count<>1 then raise exception 'unrecoverable_shadow_object'; end if;
    if v_row ? 'file_size' then
      if v_match->'ref'->'byteLength' is distinct from v_row->'file_size' or v_match->'ref'->'sha256' is distinct from v_row->'content_hash' then raise exception 'unrecoverable_shadow_object'; end if;
    else
      if pg_catalog.jsonb_typeof(v_row->'image_hash') is distinct from 'string' or pg_catalog.length(v_row->>'image_hash')<>64
        or v_row->>'image_hash' !~ '^[0-9a-f]{64}$' or v_row->'metadata'->>'extractor' is distinct from 'local-worker'
        or v_row->'metadata'->'image_hash' is distinct from v_row->'image_hash' or v_match->'ref'->'mediaType' is distinct from v_row->'mime_type'
        or v_match->'ref'->>'sha256' is distinct from 'sha256:'||(v_row->>'image_hash') then raise exception 'unrecoverable_shadow_object'; end if;
    end if;
  end loop;
end $$;
alter function public.shadow_validate_original_objects_v1(jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_validate_original_objects_v1(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_pending_manifest_v1(p_document uuid,p_generation uuid,p_job uuid)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('version',1,'documentId',p_document,'candidateGenerationId',p_generation,'jobId',p_job,'families',
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('family',family,'groups',groups) order by family collate "C") from (values
      ('attempt_control','[{"groupKey":"control","state":"pending","declaration":null}]'::jsonb),
      ('cache_inputs','[{"groupKey":"cache","state":"pending","declaration":null}]'::jsonb),
      ('chunks','[{"groupKey":"worker_core","state":"pending","declaration":null}]'::jsonb),
      ('document_metadata','[{"groupKey":"projection_aggregate","state":"pending","declaration":null}]'::jsonb),
      ('embedding_fields','[{"groupKey":"worker_core","state":"pending","declaration":null}]'::jsonb),
      ('generated_labels','[{"groupKey":"enrichment","state":"pending","declaration":null}]'::jsonb),
      ('images','[{"groupKey":"worker_core","state":"pending","declaration":null}]'::jsonb),
      ('index_units','[{"groupKey":"worker_core","state":"pending","declaration":null},{"groupKey":"deep_memory","state":"pending","declaration":null}]'::jsonb),
      ('memory_cards','[{"groupKey":"deep_memory","state":"pending","declaration":null}]'::jsonb),
      ('native_structure','[{"groupKey":"worker_native","state":"pending","declaration":null}]'::jsonb),
      ('pages','[{"groupKey":"worker_core","state":"pending","declaration":null}]'::jsonb),
      ('private_objects','[{"groupKey":"private_objects","state":"pending","declaration":null}]'::jsonb),
      ('producer_aliases','[{"groupKey":"deep_memory","state":"pending","declaration":null}]'::jsonb),
      ('quality','[{"groupKey":"worker_core","state":"pending","declaration":null}]'::jsonb),
      ('repair_audit_inputs','[{"groupKey":"repair","state":"pending","declaration":null}]'::jsonb),
      ('sections','[{"groupKey":"deep_memory","state":"pending","declaration":null}]'::jsonb),
      ('summary','[{"groupKey":"enrichment","state":"pending","declaration":null}]'::jsonb),
      ('table_facts','[{"groupKey":"worker_core","state":"pending","declaration":null}]'::jsonb)) slots(family,groups)))
$$;
alter function public.shadow_pending_manifest_v1(uuid,uuid,uuid) owner to postgres;
revoke all on function public.shadow_pending_manifest_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.shadow_control_snapshot_v1(p_job uuid,p_revision bigint)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('controlRevision',p_revision,
    'ownNodeJobs',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) order by j.id) from public.ingestion_jobs j where j.id=p_job),'[]'::jsonb),
    'ownStages',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.id) from public.ingestion_job_stages s where s.job_id=p_job and s.job_kind='node'),'[]'::jsonb))
$$;
alter function public.shadow_control_snapshot_v1(uuid,bigint) owner to postgres;
revoke all on function public.shadow_control_snapshot_v1(uuid,bigint) from public,anon,authenticated,service_role;

create or replace function public.shadow_assert_attempt_v1(p_fence jsonb,p_generation uuid,p_revision bigint default null)
returns public.document_index_generations language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_member public.document_index_generations%rowtype; v_job jsonb;
begin
  if p_fence->>'job_kind' is distinct from 'node' or p_generation is null then raise exception 'shadow_attempt_required'; end if;
  v_locked:=public.assert_current_ingestion_attempt(p_fence,p_generation);
  if v_locked is null then raise exception 'shadow_lease_lost'; end if;
  v_job:=v_locked->'job';
  select * into v_member from public.document_index_generations where document_id=(p_fence->>'document_id')::uuid and index_generation_id=p_generation for update;
  if not found or v_member.state<>'building' or v_member.job_id::text is distinct from v_job->>'id'
    or v_job->>'operation' is distinct from 'shadow_reindex' or v_job->>'requested_generation_id' is distinct from p_generation::text
    or v_job->'batch_id' is distinct from 'null'::jsonb or v_job->'max_attempts' is distinct from '1'::jsonb or v_job->'attempt_count' is distinct from '1'::jsonb
    or v_member.first_lease_token::text is distinct from p_fence->>'lease_token' or v_member.baseline_generation_id is distinct from (p_fence->>'expected_generation_id')::uuid
    or v_member.authority_digest is distinct from p_fence->>'authority_digest'
    or v_member.owner_id is distinct from (v_locked->'document'->>'owner_id')::uuid
    or not exists(select 1 from public.shadow_reindex_waves w where w.candidate_generation_id=p_generation and w.plan_digest=v_job->>'shadow_plan_digest')
    or (p_revision is not null and v_member.control_revision<>p_revision)
    or v_member.control_snapshot is distinct from public.shadow_control_snapshot_v1(v_member.job_id,v_member.control_revision) then raise exception 'shadow_attempt_mismatch'; end if;
  perform public.shadow_assert_origin_unchanged_v1(v_member);
  return v_member;
end $$;
alter function public.shadow_assert_attempt_v1(jsonb,uuid,bigint) owner to postgres;
revoke all on function public.shadow_assert_attempt_v1(jsonb,uuid,bigint) from public,anon,authenticated,service_role;

create or replace function public.shadow_checkpoint_advance_v1(p_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member public.document_index_generations%rowtype;
begin
  select * into v_member from public.document_index_generations where job_id=p_job for update;
  if not found then raise exception 'shadow_member_required'; end if;
  if v_member.control_revision>=9007199254740991 then raise exception 'shadow_revision_exhausted'; end if;
  update public.document_index_generations set control_revision=v_member.control_revision+1,
    control_snapshot=public.shadow_control_snapshot_v1(p_job,v_member.control_revision+1)
    where document_id=v_member.document_id and index_generation_id=v_member.index_generation_id;
end $$;
alter function public.shadow_checkpoint_advance_v1(uuid) owner to postgres;
revoke all on function public.shadow_checkpoint_advance_v1(uuid) from public,anon,authenticated,service_role;


-- A failed deep-producer stage reserves D only when the complete fixed stage,
-- member, Fence binding and retained capture envelopes agree. Malformed or
-- generic stage metadata returns NULL and confers no retention authority.
create or replace function public.shadow_failed_artifact_generation_v1(
  p_stage public.ingestion_job_stages,p_member public.document_index_generations,p_revision_offset integer)
returns uuid language plpgsql immutable set search_path = '' as $$
declare v_failure jsonb;v_payload jsonb;v_input jsonb;v_partial jsonb;v_artifact uuid;v_revision numeric;
begin
  if p_revision_offset is null or p_revision_offset not in (0,1)
    or (p_revision_offset=0 and p_member.state is distinct from 'building') or p_member.first_lease_token is null
    or p_stage.job_kind is distinct from 'node' or p_stage.job_id is distinct from p_member.job_id
    or p_stage.document_id is distinct from p_member.document_id or p_stage.lease_token is distinct from p_member.first_lease_token
    or p_stage.index_generation_id is distinct from p_member.baseline_generation_id or p_stage.stage_status is distinct from 'failed'
    or p_stage.error_class is not null or p_stage.retry_count is distinct from 0 or p_stage.artifact_counts is distinct from '{}'::jsonb
    or p_stage.finished_at is null or p_stage.started_at is distinct from p_stage.finished_at
    or not public.shadow_keys_v1(p_stage.metadata,array['u04_producer_failure_v1']) then return null; end if;
  v_failure:=p_stage.metadata->'u04_producer_failure_v1';
  v_payload:=public.shadow_node_payload_v1(v_failure,'u04-retained-evidence-v1');
  if not public.shadow_keys_v1(v_payload,array['kind','version','binding','expectedControlRevision','artifactGenerationId','phase','code','inputEnvelope','partialEnvelope'])
    or v_payload->>'kind' is distinct from 'u04-producer-failure-v1' or v_payload->'version' is distinct from '1'::jsonb
    or v_payload->>'phase' not in ('deep_sections','deep_model_profile','deep_cards','deep_card_embeddings','deep_index_units','deep_index_embeddings','deep_persistence')
    or v_payload->>'code' is distinct from 'producer_failed' or p_stage.stage_name is distinct from 'shadow_producer_failure:'||(v_payload->>'phase')
    or p_stage.error_message is distinct from v_payload->>'code'
    or pg_catalog.jsonb_typeof(v_payload->'expectedControlRevision') is distinct from 'number'
    or (v_payload->>'expectedControlRevision')::numeric<>pg_catalog.trunc((v_payload->>'expectedControlRevision')::numeric)
    or (v_payload->>'expectedControlRevision')::numeric not between 1 and 9007199254740990
    or pg_catalog.jsonb_typeof(v_payload->'artifactGenerationId') is distinct from 'string'
    or v_payload->>'artifactGenerationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or v_payload->'binding' is distinct from pg_catalog.jsonb_build_object('tag','candidate','source',p_member.source_binding,
      'candidateGenerationId',p_member.index_generation_id,'jobId',p_member.job_id,
      'firstLeaseToken',p_member.first_lease_token,'artifactGenerationId',null)
    then return null; end if;
  v_revision:=(v_payload->>'expectedControlRevision')::numeric;
  -- Insertions require the current building revision; stored evidence survives later checkpoints and states.
  if p_member.control_revision is null
    or (p_revision_offset=0 and v_revision<>p_member.control_revision)
    or (p_revision_offset=1 and v_revision+1>p_member.control_revision) then return null; end if;
  v_artifact:=(v_payload->>'artifactGenerationId')::uuid;
  if v_artifact=p_member.index_generation_id or v_artifact is not distinct from p_member.baseline_generation_id then return null; end if;
  v_input:=public.shadow_node_payload_v1(v_payload->'inputEnvelope','u04-retained-evidence-v1');
  v_partial:=public.shadow_node_payload_v1(v_payload->'partialEnvelope','u04-retained-evidence-v1');
  if not public.shadow_keys_v1(v_input,array['input','ownUndefinedPaths'])
    or not public.shadow_keys_v1(v_partial,array['input','ownUndefinedPaths'])
    or pg_catalog.jsonb_typeof(v_input->'ownUndefinedPaths') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_partial->'ownUndefinedPaths') is distinct from 'array'
    or (select count(*) from pg_catalog.jsonb_array_elements(v_input->'ownUndefinedPaths'))
      <>(select count(distinct value) from pg_catalog.jsonb_array_elements(v_input->'ownUndefinedPaths'))
    or (select count(*) from pg_catalog.jsonb_array_elements(v_partial->'ownUndefinedPaths'))
      <>(select count(distinct value) from pg_catalog.jsonb_array_elements(v_partial->'ownUndefinedPaths'))
    then return null; end if;
  return v_artifact;
exception when others then return null;
end $$;
alter function public.shadow_failed_artifact_generation_v1(public.ingestion_job_stages,public.document_index_generations,integer) owner to postgres;
revoke all on function public.shadow_failed_artifact_generation_v1(public.ingestion_job_stages,public.document_index_generations,integer) from public,anon,authenticated,service_role;

-- Retention lasts through every member/job state. No status grants deletion.
create or replace function public.shadow_generation_retained_v1(p_document uuid,p_generation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.document_index_generations g where g.document_id=p_document
    and (g.index_generation_id=p_generation or g.baseline_generation_id is not distinct from p_generation))
    or exists(select 1 from public.document_generation_inventory i where i.document_id=p_document and i.artifact_generation_id=p_generation)
    or exists(select 1 from public.document_generation_projections p where p.document_id=p_document and p.deep_memory_artifact_generation_id=p_generation)
    or exists(select 1 from public.document_index_generations g cross join lateral pg_catalog.jsonb_array_elements(g.inventory_manifest->'families') f
      cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where g.document_id=p_document and s->>'state'='declared'
      and s->'declaration'->>'artifactGenerationId'=p_generation::text)
    or exists(select 1 from public.ingestion_job_stages s join public.document_index_generations g
      on g.job_id=s.job_id and g.document_id=s.document_id where g.document_id=p_document
      and public.shadow_failed_artifact_generation_v1(s,g,1)=p_generation)
$$;
alter function public.shadow_generation_retained_v1(uuid,uuid) owner to postgres;
revoke all on function public.shadow_generation_retained_v1(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.shadow_artifact_retention_guard_v1()
returns trigger language plpgsql set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_document uuid; v_generation uuid; v_member public.document_index_generations%rowtype;
  v_unit public.document_generation_inventory%rowtype; v_family text; v_row_id text; v_metadata jsonb; v_fence jsonb; v_lock text; v_d_owner public.document_index_generations%rowtype; v_deep_finalization boolean:=false;
begin
  if tg_table_schema<>'public' or tg_table_name not in ('document_pages','document_chunks','document_images','document_table_facts','document_embedding_fields','document_index_units','document_sections','document_memory_cards') then raise exception 'shadow_guard_owner_mismatch'; end if;
  if tg_op='TRUNCATE' then
    if exists(select 1 from public.document_index_generations) then raise exception 'shadow_retained_evidence'; end if;
    return null;
  end if;
  if tg_op<>'INSERT' then v_old:=pg_catalog.to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_new:=pg_catalog.to_jsonb(new); end if;
  -- Lock OLD/NEW typed generation identities before any unowned-row return.
  -- The matching declaration lock prevents a racing ordinary writer from using
  -- a D that was just reserved by another document/wave. No helper privilege is
  -- added to this invoker trigger or to service_role.
  for v_lock in select distinct value from pg_catalog.jsonb_array_elements_text(pg_catalog.jsonb_build_array(
    v_old->'index_generation_id',v_old->'artifact_generation_id',v_new->'index_generation_id',v_new->'artifact_generation_id'))
    where value is not null order by value loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('u04-artifact-generation:'||v_lock,0)) then raise exception 'shadow_producer_generation_busy'; end if;
    for v_d_owner in select g.* from public.document_index_generations g where exists(select 1 from pg_catalog.jsonb_array_elements(g.inventory_manifest->'families') f
      cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where s->'declaration'->>'artifactGenerationId'=v_lock)
      or exists(select 1 from public.ingestion_job_stages st where st.job_id=g.job_id and st.document_id=g.document_id
        and public.shadow_failed_artifact_generation_v1(st,g,1)=v_lock::uuid) loop
      if tg_op='DELETE' or exists(select 1 from public.ingestion_job_stages st where st.job_id=v_d_owner.job_id and st.document_id=v_d_owner.document_id
        and public.shadow_failed_artifact_generation_v1(st,v_d_owner,1)=v_lock::uuid)
        then raise exception 'shadow_retained_evidence'; end if;
      if current_user<>'postgres' or v_new->>'document_id' is distinct from v_d_owner.document_id::text
        or v_new->>'producer' is distinct from 'local-worker' or v_new->>'artifact_generation_id' is distinct from v_lock
        or v_new->'metadata'->>'artifact_generation_id' is distinct from v_lock
        or v_new->'metadata'->>'ingestion_lease_token' is distinct from v_d_owner.first_lease_token::text then raise exception 'shadow_producer_generation_owned'; end if;
    end loop;
  end loop;
  if tg_op<>'INSERT' then
    v_document:=(v_old->>'document_id')::uuid;
    -- Exact captured identities include genuine legacy-null artifacts and full
    -- historical rows. No global NULL-generation predicate is used.
    if exists(select 1 from public.document_index_generations g
      cross join lateral pg_catalog.jsonb_array_elements((g.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->tg_table_name) e
      where g.document_id=v_document and (e->>'canonicalPayload')::jsonb->'id'=v_old->'id') then raise exception 'shadow_retained_evidence'; end if;
    if tg_op='DELETE' and exists(select 1 from public.document_index_generations g where g.document_id=v_document and
      (g.index_generation_id::text=v_old->>'index_generation_id' or g.baseline_generation_id is not distinct from (v_old->>'index_generation_id')::uuid
       or exists(select 1 from public.document_generation_inventory i where i.document_id=g.document_id and i.index_generation_id=g.index_generation_id and
         (i.artifact_generation_id::text=v_old->>'index_generation_id' or i.artifact_generation_id::text=v_old->>'artifact_generation_id')))) then raise exception 'shadow_retained_evidence'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  v_new:=pg_catalog.to_jsonb(new); v_document:=(v_new->>'document_id')::uuid; v_generation:=(v_new->>'index_generation_id')::uuid;
  if tg_op='UPDATE' and exists(select 1 from public.document_index_generations g
    cross join lateral pg_catalog.jsonb_array_elements((g.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->tg_table_name) e
    where g.document_id=v_document and (e->>'canonicalPayload')::jsonb->'id'=v_new->'id') then raise exception 'shadow_retained_evidence'; end if;
  select g.* into v_member from public.document_index_generations g where g.document_id=v_document and
    (g.index_generation_id=v_generation or exists(select 1 from public.document_generation_inventory i where i.document_id=g.document_id and i.index_generation_id=g.index_generation_id
      and (i.artifact_generation_id=v_generation or i.artifact_generation_id::text=v_new->>'artifact_generation_id')));
  if not found then
    -- Moving an OLD candidate identity to an unowned NEW tuple is not an escape.
    if tg_op='UPDATE' and exists(select 1 from public.document_index_generations g where g.document_id=(v_old->>'document_id')::uuid and
      (g.index_generation_id::text=v_old->>'index_generation_id' or exists(select 1 from public.document_generation_inventory i where i.document_id=g.document_id and i.index_generation_id=g.index_generation_id and
       (i.artifact_generation_id::text=v_old->>'index_generation_id' or i.artifact_generation_id::text=v_old->>'artifact_generation_id')))) then raise exception 'shadow_retained_evidence'; end if;
    return new;
  end if;
  if current_user<>'postgres' then raise exception 'shadow_fixed_writer_required'; end if;
  select * into strict v_member from public.document_index_generations where document_id=v_member.document_id and index_generation_id=v_member.index_generation_id for update nowait;
  if tg_op='UPDATE' then
    v_deep_finalization:=tg_table_name in ('document_sections','document_memory_cards','document_index_units')
      and v_old->'index_generation_id'=v_old->'artifact_generation_id' and v_generation=v_member.index_generation_id
      and v_old-array['index_generation_id','metadata'] is not distinct from v_new-array['index_generation_id','metadata']
      and v_new->'metadata'=pg_catalog.jsonb_set(v_old->'metadata','{index_generation_id}',v_new->'index_generation_id');
    if v_deep_finalization is not true and not(tg_table_name='document_chunks' and public.shadow_candidate_anchor_update_v1(v_member,v_old,v_new))
      then raise exception 'shadow_candidate_update_requires_finalizer'; end if;
  end if;
  v_metadata:=v_new->'metadata';
  v_fence:=pg_catalog.jsonb_build_object('job_kind','node','job_id',v_member.job_id,'document_id',v_member.document_id,
    'worker_id',(select locked_by from public.ingestion_jobs where id=v_member.job_id),'lease_token',v_metadata->'ingestion_lease_token',
    'expected_generation_id',v_member.baseline_generation_id,'authority_digest',v_member.authority_digest);
  perform public.shadow_assert_attempt_v1(v_fence,v_member.index_generation_id,null);
  if v_metadata->>'ingestion_job_kind' is distinct from 'node' or v_metadata->>'ingestion_job_id' is distinct from v_member.job_id::text
    or v_metadata->>'ingestion_lease_token' is distinct from v_member.first_lease_token::text
    or v_metadata->>'index_generation_id' is distinct from v_generation::text
    or (v_new ? 'owner_id' and v_new->'owner_id' is distinct from pg_catalog.to_jsonb(v_member)->'owner_id') then raise exception 'shadow_artifact_identity'; end if;
  v_family:=case tg_table_name when 'document_pages' then 'pages' when 'document_chunks' then 'chunks' when 'document_images' then 'images'
    when 'document_table_facts' then 'table_facts' when 'document_embedding_fields' then 'embedding_fields' when 'document_index_units' then 'index_units'
    when 'document_sections' then 'sections' when 'document_memory_cards' then 'memory_cards' end;
  v_row_id:=case when tg_table_name='document_pages' then v_new->>'page_number'
    when tg_table_name in ('document_sections','document_memory_cards','document_index_units') and v_new->'artifact_generation_id'<>'null'::jsonb
      then public.shadow_deep_row_key_v1(v_member,v_family,v_new) else v_new->>'id' end;
  select * into v_unit from public.document_generation_inventory where document_id=v_member.document_id and index_generation_id=v_member.index_generation_id and family=v_family and unit_key=v_row_id;
  if not found or v_unit.disposition<>'pending' or v_unit.lease_token<>v_member.first_lease_token
    or v_unit.source_binding->'source' is distinct from v_member.source_binding
    or v_unit.source_binding->>'candidateGenerationId' is distinct from v_member.index_generation_id::text
    or v_unit.source_binding->>'jobId' is distinct from v_member.job_id::text
    or v_unit.source_binding->>'firstLeaseToken' is distinct from v_member.first_lease_token::text then raise exception 'shadow_declaration_required'; end if;
  if v_unit.artifact_generation_id is null then
    if v_generation<>v_member.index_generation_id or (v_new ? 'artifact_generation_id' and v_new->'artifact_generation_id'<>'null'::jsonb) then raise exception 'shadow_artifact_identity'; end if;
  elsif v_unit.artifact_generation_id=v_member.baseline_generation_id or v_unit.artifact_generation_id=v_member.index_generation_id
    or (v_generation<>v_unit.artifact_generation_id and not(v_deep_finalization and v_generation=v_member.index_generation_id)) or v_new->>'artifact_generation_id' is distinct from v_unit.artifact_generation_id::text
    or v_new->>'producer' is distinct from 'local-worker' or v_unit.producer<>'local-worker' then raise exception 'shadow_artifact_identity'; end if;
  return new;
end $$;
alter function public.shadow_artifact_retention_guard_v1() owner to postgres;
revoke all on function public.shadow_artifact_retention_guard_v1() from public,anon,authenticated,service_role;

create trigger document_pages_shadow_retention before insert or update or delete on public.document_pages for each row execute function public.shadow_artifact_retention_guard_v1();
create trigger document_chunks_shadow_retention before insert or update or delete on public.document_chunks for each row execute function public.shadow_artifact_retention_guard_v1();
create trigger document_images_shadow_retention before insert or update or delete on public.document_images for each row execute function public.shadow_artifact_retention_guard_v1();
create trigger document_table_facts_shadow_retention before insert or update or delete on public.document_table_facts for each row execute function public.shadow_artifact_retention_guard_v1();
create trigger document_embedding_fields_shadow_retention before insert or update or delete on public.document_embedding_fields for each row execute function public.shadow_artifact_retention_guard_v1();
create trigger document_index_units_shadow_retention before insert or update or delete on public.document_index_units for each row execute function public.shadow_artifact_retention_guard_v1();
create trigger document_sections_shadow_retention before insert or update or delete on public.document_sections for each row execute function public.shadow_artifact_retention_guard_v1();
create trigger document_memory_cards_shadow_retention before insert or update or delete on public.document_memory_cards for each row execute function public.shadow_artifact_retention_guard_v1();
create trigger document_pages_shadow_truncate before truncate on public.document_pages for each statement execute function public.shadow_artifact_retention_guard_v1();
create trigger document_chunks_shadow_truncate before truncate on public.document_chunks for each statement execute function public.shadow_artifact_retention_guard_v1();
create trigger document_images_shadow_truncate before truncate on public.document_images for each statement execute function public.shadow_artifact_retention_guard_v1();
create trigger document_table_facts_shadow_truncate before truncate on public.document_table_facts for each statement execute function public.shadow_artifact_retention_guard_v1();
create trigger document_embedding_fields_shadow_truncate before truncate on public.document_embedding_fields for each statement execute function public.shadow_artifact_retention_guard_v1();
create trigger document_index_units_shadow_truncate before truncate on public.document_index_units for each statement execute function public.shadow_artifact_retention_guard_v1();
create trigger document_sections_shadow_truncate before truncate on public.document_sections for each statement execute function public.shadow_artifact_retention_guard_v1();
create trigger document_memory_cards_shadow_truncate before truncate on public.document_memory_cards for each statement execute function public.shadow_artifact_retention_guard_v1();

create or replace function public.shadow_parent_retention_guard_v1()
returns trigger language plpgsql set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_member public.document_index_generations%rowtype; v_old_generation uuid; v_new_generation uuid; v_failed_artifact uuid; v_lock text; v_row jsonb;
begin
  if tg_table_schema<>'public' or tg_table_name not in ('documents','ingestion_jobs','ingestion_job_stages') then raise exception 'shadow_guard_owner_mismatch'; end if;
  if tg_op='TRUNCATE' then
    if exists(select 1 from public.document_index_generations) then raise exception 'shadow_retained_evidence'; end if; return null;
  end if;
  if tg_op<>'INSERT' then v_old:=pg_catalog.to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_new:=pg_catalog.to_jsonb(new); end if;
  if tg_table_name='documents' then
    -- GENERATED ALWAYS is evaluated after BEFORE triggers. Derive exactly the
    -- existing metadata projection, without changing malformed/legacy values.
    v_new_generation:=case when v_new->'metadata'->>'index_generation_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (v_new->'metadata'->>'index_generation_id')::uuid else null end;
    v_old_generation:=case when v_old->'metadata'->>'index_generation_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (v_old->'metadata'->>'index_generation_id')::uuid else null end;
    if tg_op='INSERT' or (tg_op='UPDATE' and v_old_generation is distinct from v_new_generation) then
      for v_lock in select distinct id::text from pg_catalog.unnest(array[v_old_generation,v_new_generation]) id where id is not null order by id::text loop
        if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('u04-artifact-generation:'||v_lock,0)) then raise exception 'shadow_producer_generation_busy'; end if;
      end loop;
      if v_new_generation is not null and (exists(select 1 from public.document_index_generations g
        cross join lateral pg_catalog.jsonb_array_elements(g.inventory_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
        where s->'declaration'->>'artifactGenerationId'=v_new_generation::text)
        or exists(select 1 from public.ingestion_job_stages st join public.document_index_generations g
          on g.job_id=st.job_id and g.document_id=st.document_id
          where public.shadow_failed_artifact_generation_v1(st,g,1)=v_new_generation))
        then raise exception 'shadow_document_generation_reserved'; end if;
    end if;
    if tg_op='DELETE' and exists(select 1 from public.document_index_generations where document_id=old.id) then raise exception 'shadow_retained_document'; end if;
    if tg_op='UPDATE' and old.id is distinct from new.id and exists(select 1 from public.document_index_generations where document_id in (old.id,new.id)) then raise exception 'shadow_retained_document'; end if;
    -- Source/owner/review drift is observable and invalidates C; it is not frozen.
  elsif tg_table_name='ingestion_jobs' then
    select * into v_member from public.document_index_generations where job_id=coalesce((v_old->>'id')::uuid,(v_new->>'id')::uuid);
    if found then
      if tg_op='DELETE' then raise exception 'shadow_retained_job'; end if;
      if current_user<>'postgres' then raise exception 'shadow_fixed_control_required'; end if;
      select * into strict v_member from public.document_index_generations where job_id=v_member.job_id for update nowait;
      if tg_op='UPDATE' and v_old->>'status'='processing' and v_new->>'status'='completed' then
        if v_member.state is distinct from 'building' or v_old->>'stage' is distinct from v_member.control_snapshot->'ownNodeJobs'->0->>'stage'
          or v_old->'progress' is distinct from v_member.control_snapshot->'ownNodeJobs'->0->'progress'
          or v_old->>'locked_by' is null or pg_catalog.btrim(v_old->>'locked_by')='' or v_old->>'locked_at' is null
          or not pg_catalog.isfinite((v_old->>'locked_at')::timestamptz) or v_old->>'completed_at' is not null
          or v_old->>'lease_expires_at' is null or not pg_catalog.isfinite((v_old->>'lease_expires_at')::timestamptz)
          or v_new->>'stage' is distinct from 'shadow_staged' or v_new->'progress' is distinct from '100'::jsonb
          or v_new->'locked_by'<>'null'::jsonb or v_new->'locked_at'<>'null'::jsonb or v_new->>'completed_at' is null
          or not pg_catalog.isfinite((v_new->>'completed_at')::timestamptz)
          or (v_new->>'completed_at')::timestamptz>(pg_catalog.clock_timestamp())
          or (v_old->>'lease_expires_at')::timestamptz<=(v_new->>'completed_at')::timestamptz
          or v_old-array['status','stage','progress','locked_at','locked_by','completed_at','updated_at'] is distinct from
            v_new-array['status','stage','progress','locked_at','locked_by','completed_at','updated_at']
          then raise exception 'shadow_terminal_control_required'; end if;
      else
        if v_old->>'status' in ('failed','completed') or (v_old->>'lease_expires_at' is not null and (v_old->>'lease_expires_at')::timestamptz<=pg_catalog.clock_timestamp()) then raise exception 'shadow_wave_restart_required'; end if;
        if v_new->>'status' not in ('pending','processing','failed') or v_new->'batch_id'<>'null'::jsonb or v_new->'max_attempts'<>'1'::jsonb
          or (v_member.first_lease_token is not null and (v_new->>'lease_token' is distinct from v_member.first_lease_token::text or v_new->'attempt_count'<>'1'::jsonb
            or v_new->>'lease_write_generation_id' is distinct from v_member.index_generation_id::text)) then raise exception 'shadow_control_identity'; end if;
      end if;
    end if;
  else
    select * into v_member from public.document_index_generations where
      (v_old->>'job_kind'='node' and job_id=(v_old->>'job_id')::uuid) or (v_new->>'job_kind'='node' and job_id=(v_new->>'job_id')::uuid);
    if found then
      if tg_op='DELETE' then raise exception 'shadow_retained_stage'; end if;
      if tg_op='UPDATE' and (v_old->'job_id' is distinct from v_new->'job_id' or v_old->'job_kind' is distinct from v_new->'job_kind' or v_old->'document_id' is distinct from v_new->'document_id') then raise exception 'shadow_stage_reassignment'; end if;
      if current_user<>'postgres' then raise exception 'shadow_fixed_control_required'; end if;
      select * into strict v_member from public.document_index_generations where job_id=v_member.job_id for update nowait;
      if current_user<>'postgres' or v_new->>'job_kind' is distinct from 'node' or v_new->>'document_id' is distinct from v_member.document_id::text
        or v_new->>'lease_token' is distinct from v_member.first_lease_token::text or v_new->>'index_generation_id' is distinct from v_member.baseline_generation_id::text then raise exception 'shadow_control_identity'; end if;
      if tg_op='INSERT' and v_new->>'stage_name' ~ '^shadow_producer_failure:deep_' then
        v_failed_artifact:=public.shadow_failed_artifact_generation_v1(new,v_member,0);
        if v_failed_artifact is null then raise exception 'shadow_failure_artifact_invalid'; end if;
        if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('u04-artifact-generation:'||v_failed_artifact::text,0))
          then raise exception 'shadow_producer_generation_busy'; end if;
        if exists(select 1 from public.document_index_generations g where g.index_generation_id=v_failed_artifact or g.baseline_generation_id=v_failed_artifact)
          or exists(select 1 from public.documents d where d.index_generation_id=v_failed_artifact)
          or exists(select 1 from public.document_generation_projections p where p.deep_memory_artifact_generation_id=v_failed_artifact
            and (p.document_id<>v_member.document_id or p.index_generation_id<>v_member.index_generation_id or p.lease_token<>v_member.first_lease_token))
          or exists(select 1 from public.document_index_generations g cross join lateral pg_catalog.jsonb_array_elements(g.inventory_manifest->'families') f
            cross join lateral pg_catalog.jsonb_array_elements(f->'groups') grp where grp->'declaration'->>'artifactGenerationId'=v_failed_artifact::text
              and (g.document_id<>v_member.document_id or g.index_generation_id<>v_member.index_generation_id))
          or exists(select 1 from public.ingestion_job_stages st join public.document_index_generations g
            on g.job_id=st.job_id and g.document_id=st.document_id
            where public.shadow_failed_artifact_generation_v1(st,g,1)=v_failed_artifact)
          then raise exception 'shadow_producer_generation_owned'; end if;
        for v_row in
          select pg_catalog.to_jsonb(r) from public.document_index_units r where r.index_generation_id=v_failed_artifact or r.artifact_generation_id=v_failed_artifact
          union all select pg_catalog.to_jsonb(r) from public.document_sections r where r.index_generation_id=v_failed_artifact or r.artifact_generation_id=v_failed_artifact
          union all select pg_catalog.to_jsonb(r) from public.document_memory_cards r where r.index_generation_id=v_failed_artifact or r.artifact_generation_id=v_failed_artifact loop
          if v_row->>'document_id' is distinct from v_member.document_id::text
            or v_row->'owner_id' is distinct from coalesce(pg_catalog.to_jsonb(v_member.owner_id),'null'::jsonb)
            or v_row->>'producer' is distinct from 'local-worker'
            or v_row->>'index_generation_id' is distinct from v_failed_artifact::text
            or v_row->>'artifact_generation_id' is distinct from v_failed_artifact::text
            or v_row->'metadata'->>'generated_by' is distinct from 'local-worker'
            or v_row->'metadata'->>'artifact_generation_id' is distinct from v_failed_artifact::text
            or v_row->'metadata'->>'index_generation_id' is distinct from v_failed_artifact::text
            or v_row->'metadata'->>'ingestion_lease_token' is distinct from v_member.first_lease_token::text
            then raise exception 'shadow_producer_generation_occupied'; end if;
        end loop;
      end if;
      if tg_op='UPDATE' and (v_old->>'stage_status'<>'started' or v_new->>'stage_status' not in ('completed','failed') or
        v_old-array['stage_status','finished_at','error_class','retry_count','metadata','artifact_counts','error_message'] is distinct from
        v_new-array['stage_status','finished_at','error_class','retry_count','metadata','artifact_counts','error_message']) then raise exception 'shadow_stage_identity'; end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
alter function public.shadow_parent_retention_guard_v1() owner to postgres;
revoke all on function public.shadow_parent_retention_guard_v1() from public,anon,authenticated,service_role;
create trigger documents_shadow_retention before insert or update or delete on public.documents for each row execute function public.shadow_parent_retention_guard_v1();
create trigger ingestion_jobs_shadow_retention before update or delete on public.ingestion_jobs for each row execute function public.shadow_parent_retention_guard_v1();
create trigger ingestion_job_stages_shadow_retention before insert or update or delete on public.ingestion_job_stages for each row execute function public.shadow_parent_retention_guard_v1();
create trigger documents_shadow_truncate before truncate on public.documents for each statement execute function public.shadow_parent_retention_guard_v1();
create trigger ingestion_jobs_shadow_truncate before truncate on public.ingestion_jobs for each statement execute function public.shadow_parent_retention_guard_v1();
create trigger ingestion_job_stages_shadow_truncate before truncate on public.ingestion_job_stages for each statement execute function public.shadow_parent_retention_guard_v1();
create or replace function public.validate_shadow_plan_v1(p_plan jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_payload jsonb; v_plan jsonb; v_audit jsonb; v_input jsonb; v_origin jsonb; v_profile jsonb; v_member jsonb; v_source jsonb;
  v_expected jsonb; v_measured jsonb; v_approval jsonb; v_historical jsonb; v_history_bytes bytea; v_report jsonb; v_prior text;
begin
  v_payload:=public.shadow_node_payload_v1(p_plan,'plan');
  if not public.shadow_keys_v1(v_payload,array['kind','plan','audit']) or v_payload->>'kind' is distinct from 'u04-enqueue-plan-v1' then raise exception 'invalid_shadow_plan'; end if;
  v_plan:=v_payload->'plan'; v_audit:=v_payload->'audit';
  if not public.shadow_keys_v1(v_plan,array['version','targetProjectRef','sourcePolicyVersion','auditDigest','populationFingerprint','candidateGenerationId','documents','chunkingExperiment'])
    or v_plan->'version' is distinct from '1'::jsonb or pg_catalog.jsonb_typeof(v_plan->'chunkingExperiment') is distinct from 'boolean'
    or v_plan->>'targetProjectRef' is distinct from 'sjrfecxgysukkwxsowpy'
    or pg_catalog.jsonb_typeof(v_plan->'sourcePolicyVersion') is distinct from 'string' or pg_catalog.length(v_plan->>'sourcePolicyVersion')=0
    or pg_catalog.jsonb_typeof(v_plan->'documents') is distinct from 'array' or pg_catalog.jsonb_array_length(v_plan->'documents') not between 1 and 8
    or pg_catalog.jsonb_typeof(v_plan->'candidateGenerationId') is distinct from 'string' or pg_catalog.length(v_plan->>'candidateGenerationId')<>36
    or v_plan->>'candidateGenerationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not public.shadow_keys_v1(v_audit,array['input','coverageEnvelope','p04ReportEnvelope','validation'])
    or not public.shadow_keys_v1(v_audit->'validation',array['auditPreparedAt','baselineCompletedAt','recoveryCheckedAt']) then raise exception 'invalid_shadow_plan'; end if;
  v_input:=v_audit->'input';
  if not public.shadow_keys_v1(v_input,array['originEnvelope','caseResultsEnvelope','documents','retainedEvidence'])
    or not coalesce(public.shadow_generation_envelope_valid(v_input->'originEnvelope','baseline','pg-jsonb-text-v1'),false) then raise exception 'invalid_shadow_plan'; end if;
  v_origin:=(v_input->'originEnvelope'->>'canonicalPayload')::jsonb;
  if v_origin::text is distinct from v_input->'originEnvelope'->>'canonicalPayload'
    or not public.shadow_keys_v1(v_origin,array['kind','evidenceMode','capturedAt','executionProfileEnvelope','documentIds','manualAliasIds','sourcePolicyVersion','rows'])
    or v_origin->>'kind' is distinct from 'u04-origin-snapshot-v1' then raise exception 'invalid_shadow_origin'; end if;
  v_profile:=public.shadow_profile_capture_v1(v_origin->'executionProfileEnvelope');
  if v_profile->'target'->'projectRef' is distinct from v_plan->'targetProjectRef' or v_profile->'sourcePolicyVersion' is distinct from v_plan->'sourcePolicyVersion'
    or v_profile->'documentIds' is distinct from v_origin->'documentIds' or v_profile->'manualAliasIds' is distinct from v_origin->'manualAliasIds'
    or pg_catalog.jsonb_array_length(v_plan->'documents')>(v_profile->'limits'->>'maxMembers')::integer then raise exception 'invalid_shadow_population'; end if;
  v_report:=public.shadow_node_payload_v1(v_input->'caseResultsEnvelope','evaluation_report');
  if not public.shadow_keys_v1(v_report,array['kind','evidenceMode','originDigest','executionProfileDigest','caseSetDigest','configurationDigest','providerMode','comparisonClock','documentIds','manualAliasIds','sourceBindings','report','executions'])
    or v_report->>'kind' is distinct from 'u04-audit-case-results-v1' or v_report->'originDigest' is distinct from v_input->'originEnvelope'->'digest'
    or v_report->'executionProfileDigest' is distinct from v_origin->'executionProfileEnvelope'->'digest'
    or v_report->'caseSetDigest' is distinct from v_profile->'cases'->'digest' or v_report->'configurationDigest' is distinct from v_profile->'configuration'->'digest'
    or v_report->'providerMode' is distinct from v_profile->'providerMode' or v_report->'comparisonClock' is distinct from v_profile->'comparisonClock'
    or v_report->'documentIds' is distinct from v_profile->'documentIds' or v_report->'manualAliasIds' is distinct from v_profile->'manualAliasIds'
    or v_report->'evidenceMode' is distinct from v_profile->'evidenceMode' then raise exception 'invalid_shadow_baseline_report'; end if;
  if (select pg_catalog.jsonb_agg(value->'documentId' order by ord) from pg_catalog.jsonb_array_elements(v_plan->'documents') with ordinality a(value,ord)) is distinct from v_profile->'documentIds'
    or (select pg_catalog.jsonb_agg(value->'documentId' order by ord) from pg_catalog.jsonb_array_elements(v_input->'documents') with ordinality a(value,ord)) is distinct from v_profile->'documentIds'
    or (select pg_catalog.jsonb_agg(value->'documentId' order by ord) from pg_catalog.jsonb_array_elements(v_report->'sourceBindings') with ordinality a(value,ord)) is distinct from v_profile->'documentIds' then raise exception 'invalid_shadow_population'; end if;
  for v_member in select value from pg_catalog.jsonb_array_elements(v_plan->'documents') loop
    if not public.shadow_keys_v1(v_member,array['documentId','expectedStateDigest','baselineGenerationId'])
      or v_member->>'expectedStateDigest' is distinct from pg_catalog.substr(v_input->'originEnvelope'->>'digest',8)
      or v_member->'baselineGenerationId'=v_plan->'candidateGenerationId' then raise exception 'invalid_shadow_member'; end if;
    select value into v_source from pg_catalog.jsonb_array_elements(v_report->'sourceBindings') where value->'documentId'=v_member->'documentId';
    if not public.shadow_keys_v1(v_source,array['version','originDigest','executionProfileDigest','documentId','ownerId','contentHash','authorityDigest','sourcePolicyVersion','manualAliasIds','baselineGenerationId','source'])
      or v_source->'version' is distinct from '1'::jsonb or v_source->'originDigest' is distinct from v_input->'originEnvelope'->'digest'
      or v_source->'executionProfileDigest' is distinct from v_origin->'executionProfileEnvelope'->'digest'
      or v_source->'baselineGenerationId' is distinct from v_member->'baselineGenerationId' or v_source->'manualAliasIds' is distinct from v_profile->'manualAliasIds'
      or v_source->'sourcePolicyVersion' is distinct from v_profile->'sourcePolicyVersion' then raise exception 'invalid_shadow_source_binding'; end if;
  end loop;
  for v_member in select value from pg_catalog.jsonb_array_elements(v_input->'documents') loop
    if not public.shadow_keys_v1(v_member,array['documentId','reviewedExpectationsEnvelope','measurementsEnvelope','approvalEnvelope','historicalArtifact']) then raise exception 'invalid_shadow_member'; end if;
    v_expected:=public.shadow_node_payload_v1(v_member->'reviewedExpectationsEnvelope','u04-evidence-expectations-v1');
    v_measured:=public.shadow_node_payload_v1(v_member->'measurementsEnvelope','u04-reviewed-measurements-v1');
    v_approval:=public.shadow_node_payload_v1(v_member->'approvalEnvelope','u04-reviewed-evidence-approval-v1');
    select value into v_source from pg_catalog.jsonb_array_elements(v_report->'sourceBindings') where value->'documentId'=v_member->'documentId';
    if v_expected->'source' is distinct from v_source or v_measured->'source' is distinct from v_source or v_approval->'source' is distinct from v_source
      or v_expected->>'kind' is distinct from 'u04-evidence-expectations-v1' or v_measured->>'kind' is distinct from 'reviewed-origin-measurements-v1'
      or v_approval->>'kind' is distinct from 'u04-reviewed-evidence-approval-v1'
      or v_expected->>'policyId' is distinct from 'u04-reviewed-manual-p04-v1' or v_measured->'policyId' is distinct from v_expected->'policyId'
      or v_approval->'policyId' is distinct from v_expected->'policyId'
      or v_measured->'expectationsDigest' is distinct from v_member->'reviewedExpectationsEnvelope'->'digest'
      or v_approval->'expectationsDigest' is distinct from v_member->'reviewedExpectationsEnvelope'->'digest'
      or v_approval->'measurementsDigest' is distinct from v_member->'measurementsEnvelope'->'digest' then raise exception 'invalid_shadow_evidence_binding'; end if;
    if not public.shadow_keys_v1(v_member->'historicalArtifact',array['artifactDigest','expectedStateDigest','envelope']) then raise exception 'invalid_shadow_historical_artifact'; end if;
    v_historical:=public.shadow_node_payload_v1(v_member->'historicalArtifact'->'envelope','u04-retained-evidence-v1');
    if not public.shadow_keys_v1(v_historical,array['kind','documentId','expectedStateDigest','bytes']) or v_historical->>'kind' is distinct from 'u04-historical-audit-bytes-v1'
      or v_historical->'documentId' is distinct from v_member->'documentId' or v_historical->'expectedStateDigest' is distinct from v_member->'historicalArtifact'->'expectedStateDigest'
      or not public.shadow_keys_v1(v_historical->'bytes',array['encoding','content']) or v_historical->'bytes'->>'encoding' is distinct from 'base64' then raise exception 'invalid_shadow_historical_artifact'; end if;
    v_history_bytes:=pg_catalog.decode(v_historical->'bytes'->>'content','base64');
    if pg_catalog.replace(pg_catalog.encode(v_history_bytes,'base64'),E'\n','') is distinct from v_historical->'bytes'->>'content'
      or 'sha256:'||pg_catalog.encode(extensions.digest(v_history_bytes,'sha256'),'hex') is distinct from v_member->'historicalArtifact'->>'artifactDigest' then raise exception 'invalid_shadow_historical_artifact'; end if;
  end loop;
  perform public.shadow_validate_original_objects_v1(v_input,v_origin);
  return v_payload;
end $$;
alter function public.validate_shadow_plan_v1(jsonb) owner to postgres;
revoke all on function public.validate_shadow_plan_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.enqueue_shadow_reindex_generation(p_plan jsonb,p_baseline_evaluation jsonb,p_recovery_evidence jsonb,p_operation_manifest jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payload jsonb; v_plan jsonb; v_input jsonb; v_origin jsonb; v_current jsonb; v_profile jsonb; v_op jsonb; v_manifest jsonb;
  v_recovery jsonb; v_coverage jsonb; v_p04 jsonb; v_bundle jsonb; v_source jsonb; v_member jsonb; v_locked jsonb;
  v_w uuid[]; v_m uuid[]; v_document uuid; v_c uuid; v_job public.ingestion_jobs%rowtype; v_existing public.shadow_reindex_waves%rowtype;
  v_now timestamptz; v_confirmation text; v_jobs jsonb:='[]'::jsonb; v_observations jsonb; v_profile_envelope jsonb;
begin
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'shadow_read_committed_required'; end if;
  -- Pre-dispatch deadlines must already be effective; setting them here is late.
  if extract(epoch from pg_catalog.current_setting('statement_timeout')::interval)*1000 not between 1 and 15000
    or extract(epoch from pg_catalog.current_setting('lock_timeout')::interval)*1000 not between 1 and 2000 then raise exception 'shadow_deadline_not_effective'; end if;
  -- All 27 literal relation barriers precede any database read/effect. No dynamic
  -- relation identifier, partial wave, SKIP LOCKED snapshot or retry is admitted.
  lock table public.document_chunks, public.document_embedding_fields, public.document_generation_baselines,
    public.document_generation_inventory, public.document_generation_projections, public.document_images,
    public.document_index_generations, public.document_index_quality, public.document_index_units, public.document_labels,
    public.document_memory_cards, public.document_pages, public.document_publication_approvals, public.document_sections,
    public.document_summaries, public.document_table_facts, public.document_title_words, public.documents,
    public.import_batches, public.indexing_v3_agent_jobs, public.ingestion_job_stages, public.ingestion_jobs,
    public.public_source_activation_events, public.public_source_serving_authority, public.public_source_versions,
    public.rag_aliases, public.shadow_reindex_waves in share row exclusive mode nowait;
  v_payload:=public.validate_shadow_plan_v1(p_plan); v_plan:=v_payload->'plan'; v_input:=v_payload->'audit'->'input';
  v_origin:=(v_input->'originEnvelope'->>'canonicalPayload')::jsonb; v_profile_envelope:=v_origin->'executionProfileEnvelope';
  v_profile:=public.shadow_profile_capture_v1(v_profile_envelope); v_c:=(v_plan->>'candidateGenerationId')::uuid;
  if extract(epoch from pg_catalog.current_setting('lock_timeout')::interval)*1000>(v_profile->'limits'->>'lockTimeoutMs')::numeric then raise exception 'shadow_profile_lock_timeout_exceeded'; end if;
  -- New C joins the same global namespace as D before any member is reserved.
  -- A bounded try-lock refuses lock-order inversion rather than retrying it.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('u04-artifact-generation:'||v_c::text,0)) then raise exception 'shadow_candidate_generation_busy'; end if;
  if exists(select 1 from public.document_index_generations g cross join lateral pg_catalog.jsonb_array_elements(g.inventory_manifest->'families') f
    cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where s->'declaration'->>'artifactGenerationId'=v_c::text)
    or exists(select 1 from public.ingestion_job_stages st join public.document_index_generations g
      on g.job_id=st.job_id and g.document_id=st.document_id
      where public.shadow_failed_artifact_generation_v1(st,g,1)=v_c)
    then raise exception 'shadow_candidate_generation_reserved'; end if;
  select pg_catalog.array_agg(value::uuid order by ord) into v_w from pg_catalog.jsonb_array_elements_text(v_profile->'documentIds') with ordinality a(value,ord);
  select coalesce(pg_catalog.array_agg(value::uuid order by ord),array[]::uuid[]) into v_m from pg_catalog.jsonb_array_elements_text(v_profile->'manualAliasIds') with ordinality a(value,ord);
  foreach v_document in array v_w loop
    v_locked:=public.lock_ingestion_document_authority(v_document,false); if v_locked is null then raise exception 'shadow_source_changed'; end if;
    select value into v_source from pg_catalog.jsonb_array_elements((public.shadow_node_payload_v1(p_baseline_evaluation,'evaluation_report'))->'sourceBindings') where value->>'documentId'=v_document::text;
    if v_locked->>'authority_digest' is distinct from v_source->>'authorityDigest' or v_locked->'document'->'owner_id' is distinct from v_source->'ownerId'
      or v_locked->'document'->'content_hash' is distinct from v_source->'contentHash' or v_locked->'document'->'index_generation_id' is distinct from v_source->'baselineGenerationId' then raise exception 'shadow_source_changed'; end if;
    -- The document/source lock is held continuously through member insertion.
    -- Its non-null G0 also participates explicitly in the D namespace protocol.
    if v_source->'baselineGenerationId'<>'null'::jsonb then
      if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('u04-artifact-generation:'||((v_source->>'baselineGenerationId')::uuid)::text,0)) then raise exception 'shadow_baseline_generation_busy'; end if;
      if exists(select 1 from public.document_index_generations g cross join lateral pg_catalog.jsonb_array_elements(g.inventory_manifest->'families') f
        cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where s->'declaration'->>'artifactGenerationId'=((v_source->>'baselineGenerationId')::uuid)::text)
        or exists(select 1 from public.ingestion_job_stages st join public.document_index_generations g
          on g.job_id=st.job_id and g.document_id=st.document_id
          where public.shadow_failed_artifact_generation_v1(st,g,1)=(v_source->>'baselineGenerationId')::uuid)
        then raise exception 'shadow_baseline_generation_reserved'; end if;
    end if;
  end loop;
  perform 1 from public.ingestion_jobs where document_id=any(v_w) order by id for update;
  perform 1 from public.indexing_v3_agent_jobs where document_id=any(v_w) order by id for update;
  perform 1 from public.document_pages where document_id=any(v_w) order by id for update;
  perform 1 from public.document_chunks where document_id=any(v_w) order by id for update;
  perform 1 from public.document_images where document_id=any(v_w) order by id for update;
  perform 1 from public.document_table_facts where document_id=any(v_w) order by id for update;
  perform 1 from public.document_embedding_fields where document_id=any(v_w) order by id for update;
  perform 1 from public.document_index_units where document_id=any(v_w) order by id for update;
  perform 1 from public.document_sections where document_id=any(v_w) order by id for update;
  perform 1 from public.document_memory_cards where document_id=any(v_w) order by id for update;
  perform 1 from public.document_index_generations where document_id=any(v_w) order by document_id,index_generation_id for update;
  perform 1 from public.ingestion_job_stages where document_id=any(v_w) order by id for update;
  perform 1 from public.import_batches where id in (select import_batch_id from public.documents where id=any(v_w) union select batch_id from public.ingestion_jobs where document_id=any(v_w)) order by id for update;
  v_now:=pg_catalog.clock_timestamp();
  v_op:=public.shadow_node_payload_v1(p_operation_manifest,'plan');
  if not public.shadow_keys_v1(v_op,array['kind','manifest','planDigest','baselineEvaluationDigest','recoveryEnvelopeDigest']) or v_op->>'kind' is distinct from 'u04-enqueue-operation-v1'
    or v_op->'planDigest' is distinct from p_plan->'digest' or v_op->'baselineEvaluationDigest' is distinct from p_baseline_evaluation->'digest'
    or v_op->'recoveryEnvelopeDigest' is distinct from p_recovery_evidence->'digest' or p_baseline_evaluation is distinct from v_input->'caseResultsEnvelope' then raise exception 'invalid_shadow_operation'; end if;
  v_manifest:=v_op->'manifest';
  if not public.shadow_keys_v1(v_manifest,array['version','operation','targetProjectRef','planPath','reportOrReceiptPath','recoveryEvidencePath','recoveryEvidenceSha256','expectedDocumentIds','expectedDocumentCount','confirmationSha256','authorizedAt','expiresAt'])
    or v_manifest->'version' is distinct from '1'::jsonb or v_manifest->>'operation' is distinct from 'stage' or v_manifest->'targetProjectRef' is distinct from v_plan->'targetProjectRef'
    or v_manifest->'expectedDocumentIds' is distinct from v_profile->'documentIds' or v_manifest->'expectedDocumentCount' is distinct from pg_catalog.to_jsonb(pg_catalog.cardinality(v_w))
    or pg_catalog.jsonb_typeof(v_manifest->'planPath') is distinct from 'string' or pg_catalog.length(v_manifest->>'planPath')=0
    or pg_catalog.jsonb_typeof(v_manifest->'recoveryEvidencePath') is distinct from 'string' or pg_catalog.length(v_manifest->>'recoveryEvidencePath')=0
    or not coalesce(v_manifest->'reportOrReceiptPath'='null'::jsonb or (pg_catalog.jsonb_typeof(v_manifest->'reportOrReceiptPath')='string' and pg_catalog.length(v_manifest->>'reportOrReceiptPath')>0),false)
    or public.shadow_audit_timestamp_v1(v_manifest->'authorizedAt')>v_now or public.shadow_audit_timestamp_v1(v_manifest->'expiresAt')<=v_now
    or public.shadow_audit_timestamp_v1(v_manifest->'expiresAt')<=public.shadow_audit_timestamp_v1(v_manifest->'authorizedAt') then raise exception 'invalid_shadow_operation'; end if;
  v_confirmation:='sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(public.shadow_node_value_text_v1(pg_catalog.jsonb_set(v_op,'{manifest}',v_manifest-'confirmationSha256')),'UTF8'),'sha256'),'hex');
  if v_confirmation is distinct from v_manifest->>'confirmationSha256' then raise exception 'invalid_shadow_confirmation'; end if;
  v_observations:=v_payload->'audit'->'validation';
  if public.shadow_audit_timestamp_v1(v_origin->'capturedAt')>public.shadow_audit_timestamp_v1((public.shadow_node_payload_v1(p_baseline_evaluation,'evaluation_report'))->'report'->'generated_at')
    or public.shadow_audit_timestamp_v1((public.shadow_node_payload_v1(p_baseline_evaluation,'evaluation_report'))->'report'->'generated_at')>public.shadow_audit_timestamp_v1(v_observations->'baselineCompletedAt')
    or public.shadow_audit_timestamp_v1(v_observations->'baselineCompletedAt')>public.shadow_audit_timestamp_v1(v_observations->'auditPreparedAt')
    or public.shadow_audit_timestamp_v1(v_observations->'auditPreparedAt')>public.shadow_audit_timestamp_v1(v_manifest->'authorizedAt')
    or public.shadow_audit_timestamp_v1(v_observations->'recoveryCheckedAt')>public.shadow_audit_timestamp_v1(v_manifest->'authorizedAt') then raise exception 'invalid_shadow_observations'; end if;
  v_recovery:=public.shadow_validate_recovery_v1(p_recovery_evidence,v_plan->>'targetProjectRef',v_now);
  perform public.shadow_validate_recovery_v1(p_recovery_evidence,v_plan->>'targetProjectRef',public.shadow_audit_timestamp_v1(v_observations->'recoveryCheckedAt'));
  if v_recovery->'rawDigest' is distinct from v_manifest->'recoveryEvidenceSha256' then raise exception 'invalid_shadow_recovery_binding'; end if;
  v_coverage:=public.shadow_original_file_v1(v_payload->'audit'->'coverageEnvelope','u04-source-coverage-bytes-v1')->'value';
  v_p04:=public.shadow_original_file_v1(v_payload->'audit'->'p04ReportEnvelope','u04-p04-report-bytes-v1')->'value';
  if not public.shadow_keys_v1(v_coverage,array['schemaVersion','coverageVersion','records']) or v_coverage->'schemaVersion'<>'1'::jsonb
    or not public.shadow_keys_v1(v_p04,array['schemaVersion','inventoryVersion','coverageVersion','populationFingerprint','documents','sourceCoverage','summary'])
    or v_p04->'schemaVersion'<>'1'::jsonb or v_p04->'populationFingerprint' is distinct from v_plan->'populationFingerprint'
    or v_p04->>'coverageVersion' is distinct from public.shadow_ecmascript_trim_v1(v_coverage->>'coverageVersion')
    or v_payload->'audit'->'p04ReportEnvelope'->'digest' is distinct from v_plan->'auditDigest'
    or (select pg_catalog.jsonb_agg(value->'documentId' order by ord) from pg_catalog.jsonb_array_elements(v_p04->'documents') with ordinality a(value,ord)) is distinct from v_profile->'documentIds'
    or exists(select 1 from pg_catalog.jsonb_array_elements(v_p04->'documents') d where d->'eligibleForShadowPlan' is distinct from 'true'::jsonb or d->'blockingDisposition' is distinct from 'null'::jsonb
      or d->>'expectedStateDigest' is distinct from pg_catalog.substr(v_input->'originEnvelope'->>'digest',8)) then raise exception 'invalid_shadow_p04_binding'; end if;
  v_bundle:=public.shadow_pg_bundle_v1(pg_catalog.jsonb_build_object('kind','u04-original-recovery-bundle-v1','parameters',pg_catalog.jsonb_build_object(
    'p_plan',p_plan,'p_baseline_evaluation',p_baseline_evaluation,'p_recovery_evidence',p_recovery_evidence,'p_operation_manifest',p_operation_manifest)),'baseline');
  if pg_catalog.octet_length(pg_catalog.convert_to(v_bundle->>'canonicalPayload','UTF8'))>(v_profile->'limits'->>'maxOriginBundleBytes')::bigint then raise exception 'evidence_too_large'; end if;
  select * into v_existing from public.shadow_reindex_waves where plan_digest=p_plan->>'digest' for update;
  if found then
    if v_existing.candidate_generation_id<>v_c or v_existing.plan_payload is distinct from p_plan or v_existing.baseline_report is distinct from p_baseline_evaluation
      or v_existing.operation_manifest_digest is distinct from p_operation_manifest->>'digest' or v_existing.recovery_evidence_digest is distinct from v_recovery->'evidence'->>'digest'
      or (select count(*) from public.document_generation_baselines where candidate_generation_id=v_c and bundle_payload=v_bundle)<>pg_catalog.cardinality(v_w)
      or (select pg_catalog.jsonb_agg(document_id order by document_id) from public.document_index_generations where index_generation_id=v_c) is distinct from pg_catalog.to_jsonb(v_w) then raise exception 'shadow_reservation_replay_mismatch'; end if;
    return pg_catalog.jsonb_build_object('ok',true,'kind','existing_reservation','candidate_generation_id',v_c,'plan_digest',p_plan->'digest','terminal_acceptance','unavailable');
  end if;
  if exists(select 1 from public.shadow_reindex_waves where candidate_generation_id=v_c)
    or exists(select 1 from public.indexing_v3_agent_jobs where document_id=any(v_w) and status in ('pending','processing')) then raise exception 'shadow_reservation_conflict'; end if;
  foreach v_document in array v_w loop
    perform public.shadow_queue_history_v1(v_document,null,v_origin);
  end loop;
  v_current:=(public.capture_shadow_reindex_origin(v_w,v_plan->>'sourcePolicyVersion',v_m,v_profile_envelope)->>'canonicalPayload')::jsonb;
  if v_current-'capturedAt' is distinct from v_origin-'capturedAt' then raise exception 'shadow_baseline_changed'; end if;
  insert into public.shadow_reindex_waves(candidate_generation_id,plan_digest,plan_version,project_ref,source_policy_version,audit_digest,population_fingerprint,recovery_evidence_digest,
    baseline_evaluation_digest,operation_manifest_digest,plan_payload,prepared_origin_digest,execution_profile_digest,case_set_digest,baseline_report,baseline_report_digest)
  values(v_c,p_plan->>'digest',1,v_plan->>'targetProjectRef',v_plan->>'sourcePolicyVersion',v_plan->>'auditDigest',v_plan->>'populationFingerprint',v_recovery->'evidence'->>'digest',
    p_baseline_evaluation->>'digest',p_operation_manifest->>'digest',p_plan,v_input->'originEnvelope'->>'digest',v_profile_envelope->>'digest',v_profile->'cases'->>'digest',p_baseline_evaluation,p_baseline_evaluation->>'digest');
  for v_member in select value from pg_catalog.jsonb_array_elements(v_plan->'documents') loop
    v_document:=(v_member->>'documentId')::uuid;
    select value into v_source from pg_catalog.jsonb_array_elements((public.shadow_node_payload_v1(p_baseline_evaluation,'evaluation_report'))->'sourceBindings') where value->>'documentId'=v_document::text;
    insert into public.ingestion_jobs(document_id,batch_id,status,stage,progress,attempt_count,max_attempts,next_run_at,operation,requested_generation_id,shadow_plan_digest)
      values(v_document,null,'pending','queued',0,0,1,v_now,'shadow_reindex',v_c,p_plan->>'digest') returning * into v_job;
    insert into public.document_index_generations(document_id,index_generation_id,owner_id,baseline_generation_id,expected_state_digest,authority_digest,source_binding,job_id,state,
      baseline_bundle_digest,control_revision,control_snapshot,original_origin_envelope,inventory_manifest)
      values(v_document,v_c,(v_source->>'ownerId')::uuid,(v_member->>'baselineGenerationId')::uuid,v_member->>'expectedStateDigest',v_source->>'authorityDigest',v_source,v_job.id,'reserved',
      v_bundle->>'digest',0,public.shadow_control_snapshot_v1(v_job.id,0),v_input->'originEnvelope',public.shadow_pending_manifest_v1(v_document,v_c,v_job.id));
    insert into public.document_generation_baselines(document_id,candidate_generation_id,baseline_generation_id,expected_state_digest,bundle_version,bundle_payload,bundle_digest)
      values(v_document,v_c,(v_member->>'baselineGenerationId')::uuid,v_member->>'expectedStateDigest',1,v_bundle,v_bundle->>'digest');
    v_jobs:=v_jobs||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('document_id',v_document,'job_id',v_job.id));
  end loop;
  return pg_catalog.jsonb_build_object('ok',true,'kind','reserved','candidate_generation_id',v_c,'plan_digest',p_plan->'digest','jobs',v_jobs,'terminal_acceptance','unavailable');
exception when others then raise exception 'invalid_shadow_reservation' using errcode='22023';
end $$;
alter function public.enqueue_shadow_reindex_generation(jsonb,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.enqueue_shadow_reindex_generation(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
-- Ordinary live-pointer RPCs keep U03 behavior only for an ordinary persisted job.
-- Caller labels cannot turn a reserved shadow job into a standard operation.
create or replace function public.shadow_assert_standard_job_v1(p_fence jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_job public.ingestion_jobs%rowtype;
begin
  select * into v_job from public.ingestion_jobs where id=(p_fence->>'job_id')::uuid and document_id=(p_fence->>'document_id')::uuid;
  if found and (v_job.operation is distinct from 'standard' or v_job.requested_generation_id is not null or v_job.shadow_plan_digest is not null
    or exists(select 1 from public.document_index_generations where job_id=v_job.id)) then raise exception 'shadow_standard_operation_forbidden'; end if;
end $$;
alter function public.shadow_assert_standard_job_v1(jsonb) owner to postgres;
revoke all on function public.shadow_assert_standard_job_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.persist_ingestion_summary_projection(p_fence jsonb, p_summary jsonb, p_labels jsonb, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_owner uuid; v_summary public.document_summaries%rowtype; v_payload jsonb; v_label jsonb;
begin
  perform public.shadow_assert_standard_job_v1(p_fence);
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  v_owner := (v_locked->'document'->>'owner_id')::uuid;
  v_payload := p_summary->'metadata'->'source_anchored_summary_v1';
  if jsonb_typeof(p_summary) is distinct from 'object' or jsonb_typeof(p_labels) is distinct from 'array'
    or jsonb_typeof(p_metadata) is distinct from 'object' or jsonb_typeof(p_summary->'metadata') is distinct from 'object'
    or jsonb_typeof(v_payload) is distinct from 'object'
    or jsonb_typeof(p_summary->'source_chunk_ids') is distinct from 'array' or jsonb_typeof(p_summary->'source_image_ids') is distinct from 'array'
    or jsonb_array_length(p_labels) > 100 or v_payload->>'document_id' is distinct from v_document_id::text
    or v_payload->>'index_generation_id' is distinct from p_fence->>'expected_generation_id'
    or coalesce(v_payload->>'summary_kind','') not in ('structured','heuristic_fallback')
    or p_summary->>'summary' is distinct from v_payload->>'summary'
    or p_summary->'clinical_specifics' is distinct from v_payload->'clinical_specifics'
    or p_summary->'source_chunk_ids' is distinct from v_payload->'source_chunk_ids'
    or p_summary->'source_image_ids' is distinct from v_payload->'source_image_ids'
    or (v_payload->>'summary_kind' <> 'structured' and jsonb_array_length(p_labels) <> 0)
    or p_summary->>'model' is distinct from v_payload->>'model'
    or p_summary->>'generated_at' is distinct from v_payload->>'generated_at'
    or jsonb_typeof(v_payload->'labels') is distinct from 'array' or jsonb_array_length(v_payload->'labels') <> jsonb_array_length(p_labels)
    or exists(select 1 from jsonb_object_keys(p_summary->'metadata') k where k <> all(array[
      'generated_by','index_generation_id','rag_enrichment_version','rag_indexing_version','rag_memory_version','clinical_profile_version',
      'coverage_profile','enrichment_prompt_strategy','enrichment_prompt_chunk_ids','label_count','source_anchored_summary_v1','source_anchored_summary_projection_complete_v1']))
    or exists (select 1 from jsonb_object_keys(p_metadata) k where k <> all(array[
      'rag_enrichment_version','rag_indexing_version','rag_memory_version','rag_enrichment_updated_at','generated_label_count']))
    then raise exception 'invalid_ingestion_summary_projection'; end if;
  perform public.assert_ingestion_artifact_sources(p_summary,v_document_id,(p_fence->>'expected_generation_id')::uuid,null);
  select * into v_summary from public.document_summaries where document_id = v_document_id for update;
  if v_payload->>'summary_kind' <> 'structured'
    and v_summary.metadata->'source_anchored_summary_v1'->>'summary_kind' = 'structured'
    -- Kind is not evidence of validity. Refuse under the current row lock; a
    -- rejected/concurrently replaced structured row needs governed structured repair.
    then raise exception 'ingestion_summary_requires_structured_repair'; end if;
  perform 1 from public.document_labels where document_id = v_document_id order by id for update;
  insert into public.document_summaries(document_id,owner_id,summary,clinical_specifics,source_chunk_ids,source_image_ids,model,metadata,generated_at,updated_at)
  values(v_document_id,v_owner,p_summary->>'summary',p_summary->'clinical_specifics',
    array(select jsonb_array_elements_text(p_summary->'source_chunk_ids'))::uuid[],
    array(select jsonb_array_elements_text(p_summary->'source_image_ids'))::uuid[], p_summary->>'model',
    coalesce(v_summary.metadata,'{}'::jsonb) || p_summary->'metadata' || jsonb_build_object('source_anchored_summary_projection_complete_v1', v_payload->>'summary_kind' = 'structured','index_generation_id',p_fence->>'expected_generation_id','ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'),
    (p_summary->>'generated_at')::timestamptz, pg_catalog.clock_timestamp())
  on conflict(document_id) do update set summary=excluded.summary, clinical_specifics=excluded.clinical_specifics,
    source_chunk_ids=excluded.source_chunk_ids, source_image_ids=excluded.source_image_ids, model=excluded.model,
    metadata=excluded.metadata, generated_at=excluded.generated_at, updated_at=excluded.updated_at
  returning * into v_summary;
  delete from public.document_labels where document_id = v_document_id and source = 'generated';
  for v_label in select value from jsonb_array_elements(p_labels) loop
    if v_label->>'document_id' is distinct from v_document_id::text or v_label->>'source' is distinct from 'generated'
      or v_label->'metadata'->>'index_generation_id' is distinct from p_fence->>'expected_generation_id'
      or not exists(select 1 from jsonb_array_elements(v_payload->'labels') label
        where label->>'label'=v_label->>'label' and label->>'label_type'=v_label->>'label_type'
          and label->'confidence'=v_label->'confidence')
      then raise exception 'invalid_ingestion_summary_label'; end if;
    perform public.assert_ingestion_artifact_sources(v_label->'metadata',v_document_id,(p_fence->>'expected_generation_id')::uuid,null);
    insert into public.document_labels(document_id,owner_id,label,label_type,confidence,source,metadata)
    values(v_document_id,v_owner,v_label->>'label',v_label->>'label_type',(v_label->>'confidence')::real,'generated',v_label->'metadata');
  end loop;
  update public.documents set metadata = public.jsonb_merge_deep(metadata,p_metadata), updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  return jsonb_build_object('ok',true,'summary',to_jsonb(v_summary));
end $$;
revoke all on function public.persist_ingestion_summary_projection(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.persist_ingestion_summary_projection(jsonb,jsonb,jsonb,jsonb) to service_role;

create or replace function public.patch_ingestion_document_state(p_fence jsonb, p_state jsonb, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  perform public.shadow_assert_standard_job_v1(p_fence);
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if jsonb_typeof(p_state) is distinct from 'object' or jsonb_typeof(p_metadata) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_state) k where k <> all(array['status','error_message']))
    or exists(select 1 from jsonb_object_keys(p_metadata) k where k <> all(array['indexed_at','cover_image_id','rag_enrichment_version','rag_indexing_version','rag_memory_version','rag_memory_updated_at','rag_enrichment_updated_at','enrichment_status','enrichment_error','section_count','memory_card_count','extraction_quality','index_quality_score','index_quality_issues','index_quality_metrics','optional_index_write_issues','indexing_v3_agent_status','indexing_v3_agent_last_error','indexing_v3_agent_repair_reason','indexing_v3_agent_updated_at','completion_gate_missing','embedding_model','page_count','ocr_page_count','needs_ocr_page_count','text_character_count','extracted_image_count','searchable_image_count','skipped_image_count','skipped_image_reasons','image_type_counts','extraction_warnings','document_embedding_field_types','shadow_extraction','index_generation_id']))
    or (p_metadata ? 'index_generation_id' and p_metadata->>'index_generation_id' is distinct from p_fence->>'expected_generation_id')
    or (p_state ? 'status' and coalesce(p_state->>'status','') not in ('queued','processing','indexed','failed')) then raise exception 'invalid_ingestion_document_patch'; end if;
  update public.documents set status=case when p_state ? 'status' then p_state->>'status' else status end,
    error_message=case when p_state ? 'error_message' then p_state->>'error_message' else error_message end,
    metadata=public.jsonb_merge_deep(metadata,p_metadata),updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  return jsonb_build_object('ok',true);
end $$;
alter function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) to service_role;

create or replace function public.reset_ingestion_attempt_artifacts(p_fence jsonb, p_generation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  perform public.shadow_assert_standard_job_v1(p_fence);
  if p_generation is null or p_fence->>'job_kind' is distinct from 'node' then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_generation is not distinct from (v_locked->'document'->>'index_generation_id')::uuid then raise exception 'cannot_reset_committed_ingestion_generation'; end if;
  delete from public.document_index_units where document_id=v_document_id and index_generation_id=p_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_embedding_fields where document_id=v_document_id and index_generation_id=p_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_table_facts where document_id=v_document_id and index_generation_id=p_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_chunks where document_id=v_document_id and index_generation_id=p_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_images where document_id=v_document_id and index_generation_id=p_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  return jsonb_build_object('ok',true);
end $$;
alter function public.reset_ingestion_attempt_artifacts(jsonb, uuid) owner to postgres;
revoke all on function public.reset_ingestion_attempt_artifacts(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.reset_ingestion_attempt_artifacts(jsonb, uuid) to service_role;

create or replace function public.persist_ingestion_index_quality(p_fence jsonb, p_quality jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  perform public.shadow_assert_standard_job_v1(p_fence);
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  insert into public.document_index_quality(document_id,owner_id,quality_score,extraction_quality,metrics,issues,updated_at)
  values(v_document_id,(v_locked->'document'->>'owner_id')::uuid,(p_quality->>'quality_score')::real,p_quality->>'extraction_quality',
    p_quality->'metrics',array(select jsonb_array_elements_text(p_quality->'issues')),pg_catalog.clock_timestamp())
  on conflict(document_id) do update set
    quality_score=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.quality_score else excluded.quality_score end,
    extraction_quality=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.extraction_quality else excluded.extraction_quality end,
    metrics=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.metrics || excluded.metrics else excluded.metrics end,
    issues=case when p_fence->>'job_kind'='indexing_v3' then array(select distinct x from unnest(public.document_index_quality.issues || excluded.issues) x) else excluded.issues end,
    updated_at=excluded.updated_at;
  return jsonb_build_object('ok',true);
end $$;
alter function public.persist_ingestion_index_quality(jsonb, jsonb) owner to postgres;
revoke all on function public.persist_ingestion_index_quality(jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.persist_ingestion_index_quality(jsonb, jsonb) to service_role;

create or replace function public.commit_document_index_generation(p_fence jsonb, p_generation uuid, p_page_count integer, p_chunk_count integer, p_image_count integer, p_metadata jsonb, p_pages jsonb, p_quality jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_next jsonb; v_result jsonb;
begin
  perform public.shadow_assert_standard_job_v1(p_fence);
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_fence->>'job_kind' <> 'node' or p_generation is null or p_chunk_count is null or p_image_count is null or p_page_count is null
    or jsonb_typeof(p_pages) is distinct from 'array' or jsonb_typeof(p_quality) is distinct from 'object'
    or p_page_count < 0 or p_page_count > 100000 or p_chunk_count < 0 or p_image_count < 0 or p_chunk_count+p_image_count = 0
    or p_chunk_count <> (select count(*) from public.document_chunks where document_id=v_document_id and index_generation_id=p_generation)
    or p_image_count <> (select count(*) from public.document_images where document_id=v_document_id and index_generation_id=p_generation and searchable)
    or p_page_count <> jsonb_array_length(p_pages) then raise exception 'invalid_ingestion_core_counts'; end if;
  -- Only the reserved generation becomes visible. Earlier committed evidence is retained for later lifecycle work.
  delete from public.document_pages where document_id=v_document_id and index_generation_id=p_generation;
  insert into public.document_pages(document_id,index_generation_id,page_number,text,ocr_used,metadata)
  select v_document_id,p_generation,r.page_number,r.text,r.ocr_used,coalesce(r.metadata,'{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_job_kind','node','ingestion_job_id',p_fence->>'job_id','ingestion_lease_token',p_fence->>'lease_token')
    from jsonb_to_recordset(p_pages) r(page_number integer,text text,ocr_used boolean,metadata jsonb);
  insert into public.document_index_quality(document_id,owner_id,quality_score,extraction_quality,metrics,issues,updated_at)
  values(v_document_id,(v_locked->'document'->>'owner_id')::uuid,(p_quality->>'quality_score')::real,p_quality->>'extraction_quality',
    p_quality->'metrics',array(select jsonb_array_elements_text(p_quality->'issues')),pg_catalog.clock_timestamp())
  on conflict(document_id) do update set
    quality_score=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.quality_score else excluded.quality_score end,
    extraction_quality=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.extraction_quality else excluded.extraction_quality end,
    metrics=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.metrics || excluded.metrics else excluded.metrics end,
    issues=case when p_fence->>'job_kind'='indexing_v3' then array(select distinct x from unnest(public.document_index_quality.issues || excluded.issues) x) else excluded.issues end,
    updated_at=excluded.updated_at;

  update public.ingestion_jobs set lease_expected_generation_id=p_generation where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='node'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  update public.documents set status='indexed',page_count=p_page_count,chunk_count=p_chunk_count,image_count=p_image_count,error_message=null,
    metadata=metadata || jsonb_build_object('index_generation_id',p_generation), updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  v_next := p_fence || jsonb_build_object('expected_generation_id',p_generation);
  v_result := public.patch_ingestion_document_state(v_next,'{}'::jsonb,p_metadata);
  if v_result->'ok' is distinct from 'true'::jsonb then raise exception 'ingestion_mutation_row_count'; end if;
  return jsonb_build_object('ok',true,'fence',v_next,'index_generation_id',p_generation);
end $$;
alter function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) to service_role;

create or replace function public.persist_ingestion_image_caption_cache(p_fence jsonb, p_cache jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  perform public.shadow_assert_standard_job_v1(p_fence);
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if v_locked->'document'->>'owner_id' is null then return jsonb_build_object('ok',true,'skipped',true); end if;
  if coalesce(p_cache->>'caption','')='' or coalesce(p_cache->>'image_hash','')='' or coalesce(p_cache->>'model','')='' then raise exception 'invalid_ingestion_caption_cache'; end if;
  insert into public.image_caption_cache(owner_id,image_hash,model,mime_type,caption,metadata)
  values((v_locked->'document'->>'owner_id')::uuid,p_cache->>'image_hash',p_cache->>'model',p_cache->>'mime_type',p_cache->>'caption',p_cache->'metadata')
  on conflict(owner_id,image_hash,model) do update set caption=excluded.caption,mime_type=excluded.mime_type,metadata=excluded.metadata,updated_at=pg_catalog.clock_timestamp();
  return jsonb_build_object('ok',true);
end $$;
alter function public.persist_ingestion_image_caption_cache(jsonb, jsonb) owner to postgres;
revoke all on function public.persist_ingestion_image_caption_cache(jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.persist_ingestion_image_caption_cache(jsonb, jsonb) to service_role;

create or replace function public.complete_ingestion_job(p_fence jsonb, p_batch_id uuid, p_stage text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_batch uuid; v_pending integer; v_processing integer; v_failed integer;
begin
  perform public.shadow_assert_standard_job_v1(p_fence);
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  v_batch := (v_locked->'job'->>'batch_id')::uuid;
  if p_batch_id is not null and p_batch_id is distinct from v_batch then raise exception 'ingestion_batch_identity_mismatch'; end if;
  if v_batch is not null then perform 1 from public.import_batches where id=v_batch for update; end if;
  update public.ingestion_jobs set status='completed',stage=p_stage,progress=100,locked_by=null,locked_at=null,completed_at=pg_catalog.clock_timestamp()
  where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='node'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  if v_batch is not null then
    select count(*) filter(where status='pending'),count(*) filter(where status='processing'),count(*) filter(where status='failed')
      into v_pending,v_processing,v_failed from public.ingestion_jobs where batch_id=v_batch;
    update public.import_batches set status=case when v_pending+v_processing>0 then 'processing' when v_failed>0 then 'completed_with_errors' else 'completed' end,
      failed_files=v_failed, completed_at=case when v_pending+v_processing>0 then null else pg_catalog.clock_timestamp() end where id=v_batch;
  end if;
  return jsonb_build_object('ok',true);
end $$;
alter function public.complete_ingestion_job(jsonb, uuid, text) owner to postgres;
revoke all on function public.complete_ingestion_job(jsonb, uuid, text) from public,anon,authenticated;
grant execute on function public.complete_ingestion_job(jsonb, uuid, text) to service_role;

create or replace function public.complete_strict_enrichment_job(p_fence jsonb, p_stage text, p_agent_version text, p_visual_indexing_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_gate record; v_result jsonb;
begin
  perform public.shadow_assert_standard_job_v1(p_fence);
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  select * into v_gate from public.document_strict_gate_status where document_id=v_document_id;
  if not found or not v_gate.gate_passed then return jsonb_build_object('ok',false,'reason','completion_gate_blocked','missing',coalesce(to_jsonb(v_gate.missing),'[]'::jsonb)); end if;
  update public.documents set metadata=public.jsonb_merge_deep(metadata,jsonb_build_object(
    'enrichment_status','completed','indexing_v3_agent_status','completed','indexing_v3_agent_version',p_agent_version,
    'visual_indexing_version',p_visual_indexing_version,'completion_gate',jsonb_build_object('result','complete','missing',v_gate.missing,'counts',v_gate.counts,'presence',v_gate.presence))),updated_at=pg_catalog.clock_timestamp()
    where id=v_document_id;
  update public.document_index_quality set metrics=public.jsonb_merge_deep(metrics,jsonb_build_object('strict_enrichment_gate',jsonb_build_object('result','complete','counts',v_gate.counts,'presence',v_gate.presence)))
    where document_id=v_document_id;
  if p_fence->>'job_kind'='node' then
    v_result := public.complete_ingestion_job(p_fence,(v_locked->'job'->>'batch_id')::uuid,p_stage);
  else
    v_result := public.update_indexing_v3_agent_job_status(p_fence,'completed',null,null,'{}'::jsonb);
  end if;
  if v_result->'ok' is distinct from 'true'::jsonb then raise exception 'ingestion_mutation_row_count'; end if;
  return v_result;
end $$;
alter function public.complete_strict_enrichment_job(jsonb, text, text, text) owner to postgres;
revoke all on function public.complete_strict_enrichment_job(jsonb, text, text, text) from public,anon,authenticated;
grant execute on function public.complete_strict_enrichment_job(jsonb, text, text, text) to service_role;

create or replace function public.cleanup_ingestion_deep_memory_staging(p_fence jsonb, p_artifact_generation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  perform public.shadow_assert_standard_job_v1(p_fence);
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if v_locked->'document'->'metadata'->'deep_memory_generations'->>'local-worker'=p_artifact_generation::text then raise exception 'cannot_cleanup_committed_deep_memory'; end if;
  if exists(select 1 from public.document_sections where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if exists(select 1 from public.document_memory_cards where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if exists(select 1 from public.document_index_units where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  delete from public.document_memory_cards where document_id=v_document_id and producer='local-worker' and artifact_generation_id=p_artifact_generation and index_generation_id=p_artifact_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_index_units where document_id=v_document_id and producer='local-worker' and artifact_generation_id=p_artifact_generation and index_generation_id=p_artifact_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_sections where document_id=v_document_id and producer='local-worker' and artifact_generation_id=p_artifact_generation and index_generation_id=p_artifact_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  return jsonb_build_object('ok',true);
end $$;
alter function public.cleanup_ingestion_deep_memory_staging(jsonb, uuid) owner to postgres;
revoke all on function public.cleanup_ingestion_deep_memory_staging(jsonb, uuid) from public,anon,authenticated;
grant execute on function public.cleanup_ingestion_deep_memory_staging(jsonb, uuid) to service_role;

create or replace function public.commit_document_deep_memory_generation(p_fence jsonb, p_artifact_generation uuid, p_rag_memory_version text, p_document_intelligence_version text, p_section_count integer, p_memory_card_count integer, p_index_unit_counts_by_type jsonb, p_anchors jsonb, p_aliases jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_anchor jsonb; v_alias jsonb; v_repaired integer:=0; v_result jsonb; v_request jsonb; v_receipt jsonb;
begin
  perform public.shadow_assert_standard_job_v1(p_fence);
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if exists(select 1 from public.document_sections where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if exists(select 1 from public.document_memory_cards where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if exists(select 1 from public.document_index_units where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  v_request := jsonb_build_object('fence',p_fence,'artifact_generation',p_artifact_generation,
    'rag_memory_version',p_rag_memory_version,'document_intelligence_version',p_document_intelligence_version,
    'section_count',p_section_count,'memory_card_count',p_memory_card_count,'index_unit_counts_by_type',p_index_unit_counts_by_type,
    'anchors',p_anchors,'aliases',p_aliases);
  v_receipt := v_locked->'document'->'metadata'->'deep_memory_commit_receipts'->'local-worker';
  if v_receipt->'request'->>'artifact_generation'=p_artifact_generation::text then
    if v_receipt->'request' is distinct from v_request then raise exception 'deep_memory_commit_identity_mismatch'; end if;
    return (v_receipt->'result') || jsonb_build_object('ok',true);
  end if;
  if jsonb_typeof(p_aliases) is distinct from 'array' or jsonb_array_length(p_aliases)>500 or jsonb_typeof(p_anchors) is distinct from 'array' or jsonb_array_length(p_anchors)>100000 then raise exception 'invalid_deep_memory_commit_payload'; end if;
  for v_anchor in select value from jsonb_array_elements(p_anchors) loop
    if coalesce(v_anchor->>'anchor_id','')='' or not exists(select 1 from public.document_chunks where id=(v_anchor->>'id')::uuid and document_id=v_document_id and index_generation_id=(p_fence->>'expected_generation_id')::uuid) then raise exception 'deep_memory_anchor_membership_mismatch'; end if;
    update public.document_chunks set anchor_id=v_anchor->>'anchor_id',metadata=metadata || jsonb_build_object('anchor_id',v_anchor->>'anchor_id','anchor_repaired_by',p_document_intelligence_version)
    where id=(v_anchor->>'id')::uuid and document_id=v_document_id and index_generation_id=(p_fence->>'expected_generation_id')::uuid and anchor_id is null;
    if found then v_repaired:=v_repaired+1; end if;
  end loop;
  update public.document_chunks set metadata=metadata || jsonb_build_object('rag_indexing_version',p_rag_memory_version,'rag_memory_version',p_rag_memory_version,'rag_memory_updated_at',pg_catalog.clock_timestamp(),'document_intelligence_version',p_document_intelligence_version)
    where document_id=v_document_id and index_generation_id=(p_fence->>'expected_generation_id')::uuid;
  v_result := public.commit_document_deep_memory_generation(v_document_id,'local-worker',p_artifact_generation,p_rag_memory_version,p_document_intelligence_version,p_section_count,p_memory_card_count,p_index_unit_counts_by_type,v_repaired);
  if jsonb_typeof(v_result) is distinct from 'object' or v_result->'ok'='false'::jsonb
    or v_result->>'document_id' is distinct from v_document_id::text
    or v_result->>'producer' is distinct from 'local-worker'
    or v_result->>'artifact_generation_id' is distinct from p_artifact_generation::text
    or v_result->>'index_generation_id' is distinct from p_fence->>'expected_generation_id'
    then raise exception 'invalid_deep_memory_commit_result'; end if;
  -- Alias writes and generation commit share this rollback boundary. Foreign/manual aliases remain untouched.
  perform 1 from public.rag_aliases where metadata->>'document_id'=v_document_id::text order by id for update;
  delete from public.rag_aliases where metadata->>'document_id'=v_document_id::text and metadata->>'generated_by'='local-worker';
  for v_alias in select value from jsonb_array_elements(p_aliases) loop
    perform public.assert_ingestion_artifact_sources(v_alias->'metadata',v_document_id,(p_fence->>'expected_generation_id')::uuid,null);
    if exists(select 1 from public.rag_aliases where owner_id is not distinct from (v_locked->'document'->>'owner_id')::uuid and alias=v_alias->>'alias' and alias_type=v_alias->>'alias_type') then raise exception 'deep_memory_alias_owner_collision'; end if;
    insert into public.rag_aliases(owner_id,alias,canonical,alias_type,weight,enabled,metadata)
      values((v_locked->'document'->>'owner_id')::uuid,v_alias->>'alias',v_alias->>'canonical',v_alias->>'alias_type',(v_alias->>'weight')::real,true,
        v_alias->'metadata' || jsonb_build_object('document_id',v_document_id,'generated_by','local-worker','artifact_generation_id',p_artifact_generation,'ingestion_lease_token',p_fence->>'lease_token'));
  end loop;
  update public.documents set metadata=public.jsonb_merge_deep(metadata,jsonb_build_object('deep_memory_commit_receipts',jsonb_build_object('local-worker',jsonb_build_object('request',v_request,'result',v_result)))) where id=v_document_id;
  return v_result || jsonb_build_object('ok',true);

end $$;
alter function public.commit_document_deep_memory_generation(jsonb, uuid, text, text, integer, integer, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.commit_document_deep_memory_generation(jsonb, uuid, text, text, integer, integer, jsonb, jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.commit_document_deep_memory_generation(jsonb, uuid, text, text, integer, integer, jsonb, jsonb, jsonb) to service_role;

-- Fixed cleanup/deletion preserve retained recovery evidence.
create or replace function public.cleanup_abandoned_document_index_generations(
  p_document_id uuid default null,
  p_limit integer default 100,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_document_ids uuid[] := '{}'::uuid[];
  chunk_count integer := 0;
  image_count integer := 0;
  table_fact_count integer := 0;
  embedding_field_count integer := 0;
  index_unit_count integer := 0;
  memory_card_count integer := 0;
  section_count integer := 0;
  v_document uuid;
begin
  perform set_config('statement_timeout', '180000', true);

  with candidate_documents as (
    select distinct document_id
    from (
      select c.document_id
      from public.document_chunks c
      join public.documents d on d.id = c.document_id
      where (p_document_id is null or c.document_id = p_document_id)
        and c.index_generation_id is not null
    and not public.shadow_generation_retained_v1(c.document_id,c.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_chunks') retained_row
      where retained_member.document_id=c.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=c.id::text)
        and c.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '')
        and not exists (
          select 1 from public.ingestion_jobs j
          where j.document_id = c.document_id
            and j.status in ('pending', 'processing')
        )
      union all
      select a.document_id
      from public.document_images a
      join public.documents d on d.id = a.document_id
      where (p_document_id is null or a.document_id = p_document_id)
        and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_images') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
        and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '')
        and not exists (
          select 1 from public.ingestion_jobs j
          where j.document_id = a.document_id
            and j.status in ('pending', 'processing')
        )
      union all
      select a.document_id
      from public.document_table_facts a
      join public.documents d on d.id = a.document_id
      where (p_document_id is null or a.document_id = p_document_id)
        and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_table_facts') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
        and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '')
        and not exists (
          select 1 from public.ingestion_jobs j
          where j.document_id = a.document_id
            and j.status in ('pending', 'processing')
        )
      union all
      select a.document_id
      from public.document_embedding_fields a
      join public.documents d on d.id = a.document_id
      where (p_document_id is null or a.document_id = p_document_id)
        and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_embedding_fields') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
        and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '')
        and not exists (
          select 1 from public.ingestion_jobs j
          where j.document_id = a.document_id
            and j.status in ('pending', 'processing')
        )
      union all
      select a.document_id
      from public.document_index_units a
      join public.documents d on d.id = a.document_id
      where (p_document_id is null or a.document_id = p_document_id)
        and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_index_units') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
        and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '')
        and not exists (
          select 1 from public.ingestion_jobs j
          where j.document_id = a.document_id
            and j.status in ('pending', 'processing')
        )
      union all
      select a.document_id
      from public.document_memory_cards a
      join public.documents d on d.id = a.document_id
      where (p_document_id is null or a.document_id = p_document_id)
        and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_memory_cards') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
        and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '')
        and not exists (
          select 1 from public.ingestion_jobs j
          where j.document_id = a.document_id
            and j.status in ('pending', 'processing')
        )
      union all
      select a.document_id
      from public.document_sections a
      join public.documents d on d.id = a.document_id
      where (p_document_id is null or a.document_id = p_document_id)
        and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_sections') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
        and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '')
        and not exists (
          select 1 from public.ingestion_jobs j
          where j.document_id = a.document_id
            and j.status in ('pending', 'processing')
        )
    ) candidates
    limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  )
  select coalesce(array_agg(document_id), '{}'::uuid[])
  into target_document_ids
  from candidate_documents;

  -- Source/document -> Node -> Edge -> member; repeat retention after locking.
  for v_document in select id from pg_catalog.unnest(target_document_ids) id order by id loop
    perform public.lock_ingestion_document_authority(v_document,false);
  end loop;
  perform 1 from public.ingestion_jobs where document_id=any(target_document_ids) order by id for update;
  perform 1 from public.indexing_v3_agent_jobs where document_id=any(target_document_ids) order by id for update;
  perform 1 from public.document_index_generations where document_id=any(target_document_ids) order by document_id,index_generation_id for update;
  select count(*) into chunk_count
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.document_id = any(target_document_ids)
    and c.index_generation_id is not null
    and not public.shadow_generation_retained_v1(c.document_id,c.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_chunks') retained_row
      where retained_member.document_id=c.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=c.id::text)
    and c.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

  select count(*) into image_count
  from public.document_images a
  join public.documents d on d.id = a.document_id
  where a.document_id = any(target_document_ids)
    and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_images') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
    and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

  select count(*) into table_fact_count
  from public.document_table_facts a
  join public.documents d on d.id = a.document_id
  where a.document_id = any(target_document_ids)
    and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_table_facts') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
    and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

  select count(*) into embedding_field_count
  from public.document_embedding_fields a
  join public.documents d on d.id = a.document_id
  where a.document_id = any(target_document_ids)
    and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_embedding_fields') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
    and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

  select count(*) into index_unit_count
  from public.document_index_units a
  join public.documents d on d.id = a.document_id
  where a.document_id = any(target_document_ids)
    and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_index_units') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
    and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

  select count(*) into memory_card_count
  from public.document_memory_cards a
  join public.documents d on d.id = a.document_id
  where a.document_id = any(target_document_ids)
    and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_memory_cards') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
    and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

  select count(*) into section_count
  from public.document_sections a
  join public.documents d on d.id = a.document_id
  where a.document_id = any(target_document_ids)
    and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_sections') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
    and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

  if not coalesce(p_dry_run, true) then
    select coalesce(array_agg(doc_id), '{}'::uuid[])
    into target_document_ids
    from unnest(target_document_ids) as doc_id
    where not exists (
      select 1 from public.ingestion_jobs j
      where j.document_id = doc_id
        and j.status in ('pending', 'processing')
    );

    delete from public.document_chunks c
    using public.documents d
    where d.id = c.document_id
      and c.document_id = any(target_document_ids)
      and c.index_generation_id is not null
    and not public.shadow_generation_retained_v1(c.document_id,c.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_chunks') retained_row
      where retained_member.document_id=c.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=c.id::text)
      and c.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

    delete from public.document_images a
    using public.documents d
    where d.id = a.document_id
      and a.document_id = any(target_document_ids)
      and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_images') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
      and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

    delete from public.document_table_facts a
    using public.documents d
    where d.id = a.document_id
      and a.document_id = any(target_document_ids)
      and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_table_facts') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
      and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

    delete from public.document_embedding_fields a
    using public.documents d
    where d.id = a.document_id
      and a.document_id = any(target_document_ids)
      and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_embedding_fields') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
      and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

    delete from public.document_index_units a
    using public.documents d
    where d.id = a.document_id
      and a.document_id = any(target_document_ids)
      and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_index_units') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
      and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

    delete from public.document_memory_cards a
    using public.documents d
    where d.id = a.document_id
      and a.document_id = any(target_document_ids)
      and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_memory_cards') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
      and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');

    delete from public.document_sections a
    using public.documents d
    where d.id = a.document_id
      and a.document_id = any(target_document_ids)
      and a.index_generation_id is not null
    and not public.shadow_generation_retained_v1(a.document_id,a.index_generation_id)
    and not exists(select 1 from public.document_index_generations retained_member
      cross join lateral pg_catalog.jsonb_array_elements((retained_member.original_origin_envelope->>'canonicalPayload')::jsonb->'rows'->'document_sections') retained_row
      where retained_member.document_id=a.document_id and (retained_row->>'canonicalPayload')::jsonb->>'id'=a.id::text)
      and a.index_generation_id::text is distinct from nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '');
  end if;

  return jsonb_build_object(
    'ok', true,
    'dry_run', coalesce(p_dry_run, true),
    'document_count', coalesce(array_length(target_document_ids, 1), 0),
    'document_ids', to_jsonb(target_document_ids),
    'counts', jsonb_build_object(
      'document_chunks', chunk_count,
      'document_images', image_count,
      'document_table_facts', table_fact_count,
      'document_embedding_fields', embedding_field_count,
      'document_index_units', index_unit_count,
      'document_memory_cards', memory_card_count,
      'document_sections', section_count
    )
  );
end;
$$;

alter function public.cleanup_abandoned_document_index_generations(uuid,integer,boolean) owner to postgres;
revoke execute on function public.cleanup_abandoned_document_index_generations(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.cleanup_abandoned_document_index_generations(uuid, integer, boolean) to service_role;

create or replace function public.delete_document_if_idle(
  p_document_id uuid,
  p_owner_id uuid,
  p_document_bucket text,
  p_image_bucket text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_active_job public.ingestion_jobs%rowtype;
  v_cleanup_job_id uuid;
  v_image_paths text[] := '{}'::text[];
  v_chunk_ids uuid[] := '{}'::uuid[];
begin
  if p_document_id is null or p_owner_id is null then
    raise exception 'Document and owner identifiers are required.' using errcode = '22023';
  end if;
  if nullif(btrim(p_document_bucket), '') is null or nullif(btrim(p_image_bucket), '') is null then
    raise exception 'Storage bucket names are required.' using errcode = '22023';
  end if;

  select d.*
    into v_document
    from public.documents d
   where d.id = p_document_id
     and d.owner_id = p_owner_id
   for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if exists(select 1 from public.document_index_generations where document_id=p_document_id) then
    return jsonb_build_object('outcome','retained_shadow_generation');
  end if;

  select j.*
    into v_active_job
    from public.ingestion_jobs j
   where j.document_id = p_document_id
     and j.status in ('pending', 'processing')
   order by j.created_at asc, j.id asc
   limit 1;

  if found then
    return jsonb_build_object(
      'outcome', 'active_job',
      'job_id', v_active_job.id,
      'job_status', v_active_job.status
    );
  end if;

  select coalesce(array_agg(distinct i.storage_path order by i.storage_path)
                          filter (where i.storage_path is not null and btrim(i.storage_path) <> ''), '{}'::text[])
    into v_image_paths
    from public.document_images i
   where i.document_id = p_document_id;

  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[])
    into v_chunk_ids
    from public.document_chunks c
   where c.document_id = p_document_id;

  insert into public.storage_cleanup_jobs (
    owner_id,
    document_id,
    document_title,
    document_bucket,
    document_paths,
    image_bucket,
    image_paths,
    status,
    metadata
  ) values (
    p_owner_id,
    p_document_id,
    v_document.title,
    p_document_bucket,
    case
      when v_document.storage_path is null or btrim(v_document.storage_path) = '' then '{}'::text[]
      else array[v_document.storage_path]
    end,
    p_image_bucket,
    v_image_paths,
    'pending',
    jsonb_build_object(
      'operation', 'permanent_document_delete',
      'created_by', 'delete_document_if_idle'
    )
  )
  returning id into v_cleanup_job_id;

  if cardinality(v_chunk_ids) > 0 then
    delete from public.rag_queries
     where source_chunk_ids && v_chunk_ids;
    delete from public.rag_query_misses
     where top_chunk_ids && v_chunk_ids
        or cited_chunk_ids && v_chunk_ids;
  end if;

  delete from public.rag_query_misses
   where clicked_document_id = p_document_id
      or expected_document_id = p_document_id;

  delete from public.rag_response_cache
   where owner_id = p_owner_id
     and cache_kind in ('search', 'answer');

  delete from public.documents where id = p_document_id;

  return jsonb_build_object(
    'outcome', 'deleted',
    'cleanup_job_id', v_cleanup_job_id,
    'document_title', v_document.title,
    'source_path', v_document.storage_path,
    'image_paths', to_jsonb(v_image_paths)
  );
end;
$$;

alter function public.delete_document_if_idle(uuid,uuid,text,text) owner to postgres;
revoke all on function public.delete_document_if_idle(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.delete_document_if_idle(uuid, uuid, text, text)
  to service_role;

create or replace function public.shadow_control_before_v1(p_fence jsonb,p_locked jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_fence->>'job_kind'='node' and p_locked->'job'->>'operation'='shadow_reindex' then
    perform public.shadow_assert_attempt_v1(p_fence,(p_locked->'job'->>'requested_generation_id')::uuid,null);
    return true;
  end if;
  perform public.shadow_assert_standard_job_v1(p_fence);
  return false;
end $$;
alter function public.shadow_control_before_v1(jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_control_before_v1(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.heartbeat_ingestion_job(p_fence jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_shadow boolean; v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_shadow:=public.shadow_control_before_v1(p_fence,v_locked);
  v_document_id := (p_fence->>'document_id')::uuid;
  update public.ingestion_jobs set locked_at = pg_catalog.clock_timestamp(),
    lease_expires_at = pg_catalog.clock_timestamp() + make_interval(secs => lease_duration_seconds)
  where id = (p_fence->>'job_id')::uuid and document_id = v_document_id
    and p_fence->>'job_kind' = 'node' and locked_by = p_fence->>'worker_id'
    and lease_token = (p_fence->>'lease_token')::uuid and status = 'processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest = p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  if v_shadow then perform public.shadow_checkpoint_advance_v1((p_fence->>'job_id')::uuid); end if;
  return jsonb_build_object('ok',true);
end $$;
alter function public.heartbeat_ingestion_job(jsonb) owner to postgres;
revoke all on function public.heartbeat_ingestion_job(jsonb) from public, anon, authenticated;
grant execute on function public.heartbeat_ingestion_job(jsonb) to service_role;

create or replace function public.update_ingestion_job_progress(p_fence jsonb, p_stage text, p_progress integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_shadow boolean; v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_shadow:=public.shadow_control_before_v1(p_fence,v_locked);
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_progress is null or p_progress not between 0 and 100 or p_stage is null or length(p_stage) > 500 then raise exception 'invalid_ingestion_progress'; end if;
  update public.ingestion_jobs set stage=p_stage, progress=p_progress, locked_at=pg_catalog.clock_timestamp(),
    lease_expires_at=pg_catalog.clock_timestamp()+make_interval(secs=>lease_duration_seconds)
  where id = (p_fence->>'job_id')::uuid and document_id = v_document_id
    and p_fence->>'job_kind' = 'node' and locked_by = p_fence->>'worker_id'
    and lease_token = (p_fence->>'lease_token')::uuid and status = 'processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest = p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  if v_shadow then perform public.shadow_checkpoint_advance_v1((p_fence->>'job_id')::uuid); end if;
  return jsonb_build_object('ok',true);
end $$;
alter function public.update_ingestion_job_progress(jsonb, text, integer) owner to postgres;
revoke all on function public.update_ingestion_job_progress(jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.update_ingestion_job_progress(jsonb, text, integer) to service_role;

create or replace function public.start_ingestion_job_stage(p_fence jsonb, p_stage text, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_shadow boolean; v_locked jsonb; v_document_id uuid; v_stage uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_shadow:=public.shadow_control_before_v1(p_fence,v_locked);
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_stage is null or length(p_stage) not between 1 and 240 or jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text)>65536 then raise exception 'invalid_ingestion_stage'; end if;
  insert into public.ingestion_job_stages(job_id,document_id,job_kind,lease_token,index_generation_id,stage_name,metadata)
  values((p_fence->>'job_id')::uuid,v_document_id,p_fence->>'job_kind',(p_fence->>'lease_token')::uuid,
    (p_fence->>'expected_generation_id')::uuid,p_stage,p_metadata) returning id into v_stage;
  if v_shadow then perform public.shadow_checkpoint_advance_v1((p_fence->>'job_id')::uuid); end if;
  return jsonb_build_object('ok',true,'stage_id',v_stage);
end $$;
alter function public.start_ingestion_job_stage(jsonb, text, jsonb) owner to postgres;
revoke all on function public.start_ingestion_job_stage(jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.start_ingestion_job_stage(jsonb, text, jsonb) to service_role;

create or replace function public.finish_ingestion_job_stage(p_fence jsonb, p_stage_id uuid, p_ok boolean, p_counts jsonb, p_error text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_shadow boolean; v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_shadow:=public.shadow_control_before_v1(p_fence,v_locked);
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_stage_id is null or p_ok is null or jsonb_typeof(p_counts) is distinct from 'object' or octet_length(p_counts::text)>65536 then raise exception 'invalid_ingestion_stage'; end if;
  update public.ingestion_job_stages set stage_status=case when p_ok then 'completed' else 'failed' end,
    finished_at=pg_catalog.clock_timestamp(),artifact_counts=p_counts,error_message=p_error
  where id=p_stage_id and job_id=(p_fence->>'job_id')::uuid and document_id=v_document_id
    and job_kind=p_fence->>'job_kind' and lease_token=(p_fence->>'lease_token')::uuid
    and index_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid and stage_status='started';
  if not found then raise exception 'ingestion_stage_identity_mismatch'; end if;
  if v_shadow then perform public.shadow_checkpoint_advance_v1((p_fence->>'job_id')::uuid); end if;
  return jsonb_build_object('ok',true);
end $$;
alter function public.finish_ingestion_job_stage(jsonb, uuid, boolean, jsonb, text) owner to postgres;
revoke all on function public.finish_ingestion_job_stage(jsonb, uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_ingestion_job_stage(jsonb, uuid, boolean, jsonb, text) to service_role;

create or replace function public.fail_or_retry_ingestion_job(p_fence jsonb, p_batch_id uuid, p_retry boolean, p_stage text, p_error_message text, p_next_run_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_retry boolean; v_batch uuid; v_pending integer; v_processing integer; v_failed integer;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if public.shadow_control_before_v1(p_fence,v_locked) then
    if p_batch_id is not null or p_retry is distinct from false or p_next_run_at is not null or p_stage is distinct from 'shadow_failed'
      then raise exception 'shadow_retry_forbidden'; end if;
    if p_error_message is null or pg_catalog.length(p_error_message)=0 or pg_catalog.octet_length(public.shadow_utf16_order_v1(p_error_message))/2>65536 then raise exception 'invalid_shadow_error_message'; end if;
    update public.ingestion_jobs set status='failed',stage='shadow_failed',error_message=p_error_message,locked_by=null,locked_at=null,
      completed_at=pg_catalog.clock_timestamp(),next_run_at=null
      where id=(p_fence->>'job_id')::uuid and document_id=(p_fence->>'document_id')::uuid and status='processing'
        and lease_token=(p_fence->>'lease_token')::uuid and lease_expires_at>pg_catalog.clock_timestamp();
    if not found then raise exception 'ingestion_mutation_row_count'; end if;
    perform public.shadow_checkpoint_advance_v1((p_fence->>'job_id')::uuid);
    return jsonb_build_object('ok',true,'retry',false);
  end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  v_batch := (v_locked->'job'->>'batch_id')::uuid;
  if p_batch_id is not null and p_batch_id is distinct from v_batch then raise exception 'ingestion_batch_identity_mismatch'; end if;
  if v_batch is not null then perform 1 from public.import_batches where id=v_batch for update; end if;
  if p_retry is null then raise exception 'invalid_ingestion_retry'; end if;
  v_retry := p_retry and (v_locked->'job'->>'attempt_count')::integer < (v_locked->'job'->>'max_attempts')::integer;
  update public.documents set status=case when index_generation_id is not null then 'indexed' when v_retry then 'queued' else 'failed' end,
    error_message=p_error_message, updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  update public.ingestion_jobs set status=case when v_retry then 'pending' else 'failed' end,stage=p_stage,error_message=p_error_message,
    next_run_at=case when v_retry then p_next_run_at else null end,locked_by=null,locked_at=null,
    completed_at=case when v_retry then null else pg_catalog.clock_timestamp() end where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='node'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  if v_batch is not null then
    select count(*) filter(where status='pending'),count(*) filter(where status='processing'),count(*) filter(where status='failed')
      into v_pending,v_processing,v_failed from public.ingestion_jobs where batch_id=v_batch;
    update public.import_batches set status=case when v_pending+v_processing>0 then 'processing' when v_failed>0 then 'completed_with_errors' else 'completed' end,
      failed_files=v_failed, completed_at=case when v_pending+v_processing>0 then null else pg_catalog.clock_timestamp() end where id=v_batch;
  end if;
  return jsonb_build_object('ok',true,'retry',v_retry);
end $$;
alter function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) owner to postgres;
revoke all on function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) from public,anon,authenticated;
grant execute on function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) to service_role;

create or replace function public.claim_ingestion_jobs(p_worker_id text, p_claim_limit integer default 1, p_stale_after_minutes integer default 45)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.document_index_generations%rowtype; v_shadow boolean; v_candidate record; v_locked jsonb; v_job public.ingestion_jobs%rowtype; v_count integer := 0; v_now timestamptz; v_generation uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' or p_claim_limit is null or p_claim_limit not between 1 and 100
    or p_stale_after_minutes not between 1 and 1440 or p_stale_after_minutes is null then raise exception 'invalid_ingestion_claim_configuration'; end if;
  for v_candidate in select j.id, j.document_id from public.ingestion_jobs j
    where j.attempt_count < j.max_attempts
      and (j.status in ('pending','failed','deferred') and coalesce(j.next_run_at, pg_catalog.clock_timestamp()) <= pg_catalog.clock_timestamp()
        or j.status = 'processing' and j.lease_expires_at <= pg_catalog.clock_timestamp())
    order by j.created_at, j.id
  loop
    exit when v_count >= p_claim_limit;
    v_locked := public.lock_ingestion_document_authority(v_candidate.document_id, true);
    if v_locked is null then continue; end if;
    perform 1 from public.ingestion_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    perform 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    v_now := pg_catalog.clock_timestamp();
    if exists (select 1 from public.ingestion_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now)
      or exists (select 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now) then continue; end if;
    select * into v_job from public.ingestion_jobs where id = v_candidate.id for update skip locked;
    if not found or v_job.attempt_count >= v_job.max_attempts or not (
      v_job.status in ('pending','failed','deferred') and coalesce(v_job.next_run_at, v_now) <= v_now
      or v_job.status = 'processing' and v_job.lease_expires_at <= v_now) then continue; end if;
    v_generation := (v_locked->'document'->>'index_generation_id')::uuid;
    if v_generation is null and (v_locked->'document'->'metadata' ? 'index_generation_id') then continue; end if;

    v_shadow:=v_job.operation='shadow_reindex';
    if v_shadow then
      select * into v_member from public.document_index_generations where job_id=v_job.id for update skip locked;
      if not found or v_member.state<>'reserved' or v_member.first_lease_token is not null or v_member.claimed_at is not null
        or v_job.status<>'pending' or v_job.attempt_count<>0 or v_job.max_attempts<>1 or v_job.batch_id is not null
        or v_job.lease_token is not null or v_job.locked_by is not null or v_job.lease_expires_at is not null
        or v_job.requested_generation_id is distinct from v_member.index_generation_id
        or v_member.baseline_generation_id is distinct from v_generation
        or v_member.owner_id is distinct from (v_locked->'document'->>'owner_id')::uuid
        or v_member.authority_digest is distinct from v_locked->>'authority_digest'
        or v_job.shadow_plan_digest is distinct from (select plan_digest from public.shadow_reindex_waves where candidate_generation_id=v_member.index_generation_id)
        or v_member.control_snapshot is distinct from public.shadow_control_snapshot_v1(v_job.id,v_member.control_revision)
        then continue; end if;
      perform public.shadow_assert_origin_unchanged_v1(v_member);
    elsif v_job.operation is distinct from 'standard' or v_job.requested_generation_id is not null or v_job.shadow_plan_digest is not null
      or exists(select 1 from public.document_index_generations where job_id=v_job.id) then continue;
    end if;
    update public.ingestion_jobs set status = 'processing', locked_by = p_worker_id, locked_at = v_now,
      lease_token = gen_random_uuid(), lease_expected_generation_id = v_generation,
      lease_write_generation_id = case when v_shadow then v_member.index_generation_id else gen_random_uuid() end,
      lease_authority_digest = v_locked->>'authority_digest', lease_expires_at = v_now + make_interval(secs => p_stale_after_minutes * 60),
      lease_duration_seconds = p_stale_after_minutes * 60, attempt_count = attempt_count + 1, next_run_at = null
    where id = v_job.id returning * into v_job;
    if v_shadow then
      if v_member.control_revision>=9007199254740991 then raise exception 'shadow_control_revision_exhausted'; end if;
      update public.document_index_generations set state='building',first_lease_token=v_job.lease_token,claimed_at=v_now,
        control_revision=v_member.control_revision+1,control_snapshot=public.shadow_control_snapshot_v1(v_job.id,v_member.control_revision+1)
        where document_id=v_member.document_id and index_generation_id=v_member.index_generation_id and state='reserved' and first_lease_token is null;
      if not found then raise exception 'shadow_claim_identity'; end if;
    end if;
    return next to_jsonb(v_job) || jsonb_build_object('job_kind','node', 'documents',v_locked->'document');
    v_count := v_count + 1;
  end loop;
end $$;
alter function public.claim_ingestion_jobs(text,integer,integer) owner to postgres;
revoke all on function public.claim_ingestion_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_ingestion_jobs(text, integer, integer) to service_role;

-- Remove only independently persisted own wave identities from the complete
-- capture. Foreign queue rows and all retained baseline rows remain comparable.
create or replace function public.shadow_state_rows_v1(p_rows jsonb,p_candidate uuid,p_jobs uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_table text; v_values jsonb; v_e jsonb; v_row jsonb; v_keep jsonb; v_result jsonb:='{}'::jsonb; v_own boolean;
begin
  for v_table,v_values in select key,value from pg_catalog.jsonb_each(p_rows) loop
    v_keep:='[]'::jsonb;
    for v_e in select value from pg_catalog.jsonb_array_elements(v_values) loop
      v_row:=(v_e->>'canonicalPayload')::jsonb; v_own:=false;
      if v_table='shadow_reindex_waves' then v_own:=v_row->>'candidate_generation_id'=p_candidate::text;
      elsif v_table in ('document_index_generations','document_generation_inventory','document_generation_projections') then
        v_own:=v_row->>'index_generation_id'=p_candidate::text and exists(select 1 from public.document_index_generations g where g.index_generation_id=p_candidate and g.document_id::text=v_row->>'document_id');
      elsif v_table='document_generation_baselines' then v_own:=v_row->>'candidate_generation_id'=p_candidate::text;
      elsif v_table='ingestion_jobs' then v_own:=(v_row->>'id')::uuid=any(p_jobs);
      elsif v_table='ingestion_job_stages' then v_own:=v_row->>'job_kind'='node' and (v_row->>'job_id')::uuid=any(p_jobs);
      elsif v_table in ('document_pages','document_chunks','document_images','document_table_facts','document_embedding_fields','document_index_units','document_sections','document_memory_cards') then
        v_own:=exists(select 1 from public.document_index_generations g where g.index_generation_id=p_candidate and g.document_id::text=v_row->>'document_id'
          and (v_row->>'index_generation_id'=p_candidate::text or exists(select 1 from public.document_generation_inventory i where i.document_id=g.document_id and i.index_generation_id=p_candidate
            and i.artifact_generation_id is not null and i.artifact_generation_id::text=v_row->>'index_generation_id')
          or (v_table in ('document_index_units','document_sections','document_memory_cards')
            and exists(select 1 from public.ingestion_job_stages st where st.job_id=g.job_id and st.document_id=g.document_id
              and st.job_id=any(p_jobs) and public.shadow_failed_artifact_generation_v1(st,g,1)::text=v_row->>'index_generation_id'
              and v_row->'owner_id' is not distinct from coalesce(pg_catalog.to_jsonb(g.owner_id),'null'::jsonb)
              and v_row->>'producer'='local-worker' and v_row->>'artifact_generation_id'=public.shadow_failed_artifact_generation_v1(st,g,1)::text
              and v_row->'metadata'->>'generated_by'='local-worker'
              and v_row->'metadata'->>'artifact_generation_id'=public.shadow_failed_artifact_generation_v1(st,g,1)::text
              and v_row->'metadata'->>'index_generation_id'=public.shadow_failed_artifact_generation_v1(st,g,1)::text
              and v_row->'metadata'->>'ingestion_lease_token'=g.first_lease_token::text))));
      end if;
      if v_own is not true then v_keep:=v_keep||pg_catalog.jsonb_build_array(v_e); end if;
    end loop;
    v_result:=v_result||pg_catalog.jsonb_build_object(v_table,v_keep);
  end loop;
  return v_result;
end $$;
alter function public.shadow_state_rows_v1(jsonb,uuid,uuid[]) owner to postgres;
revoke all on function public.shadow_state_rows_v1(jsonb,uuid,uuid[]) from public,anon,authenticated,service_role;

create or replace function public.shadow_assert_origin_unchanged_v1(p_member public.document_index_generations)
returns void language plpgsql security definer set search_path = '' as $$
declare v_origin jsonb; v_current jsonb; v_w uuid[]; v_m uuid[]; v_jobs uuid[]; v_doc uuid; v_g public.document_index_generations%rowtype;
begin
  v_origin:=(p_member.original_origin_envelope->>'canonicalPayload')::jsonb;
  select pg_catalog.array_agg(value::uuid order by ord) into v_w from pg_catalog.jsonb_array_elements_text(v_origin->'documentIds') with ordinality a(value,ord);
  select coalesce(pg_catalog.array_agg(value::uuid order by ord),array[]::uuid[]) into v_m from pg_catalog.jsonb_array_elements_text(v_origin->'manualAliasIds') with ordinality a(value,ord);
  for v_doc in select id from pg_catalog.unnest(v_w) id order by id loop
    if public.lock_ingestion_document_authority(v_doc,true) is null then raise exception 'shadow_authority_busy'; end if;
  end loop;
  perform 1 from public.ingestion_jobs where document_id=any(v_w) order by id for update nowait;
  perform 1 from public.indexing_v3_agent_jobs where document_id=any(v_w) order by id for update nowait;
  perform 1 from public.document_index_generations where document_id=any(v_w) order by document_id,index_generation_id for update nowait;
  select pg_catalog.array_agg(job_id order by document_id) into v_jobs from public.document_index_generations where index_generation_id=p_member.index_generation_id;
  for v_g in select * from public.document_index_generations where index_generation_id=p_member.index_generation_id order by document_id loop
    if v_g.original_origin_envelope is distinct from p_member.original_origin_envelope or v_g.control_snapshot is distinct from public.shadow_control_snapshot_v1(v_g.job_id,v_g.control_revision)
      then raise exception 'shadow_control_changed'; end if;
    perform public.shadow_queue_history_v1(v_g.document_id,v_g.job_id,v_origin);
  end loop;
  v_current:=(public.capture_shadow_reindex_origin(v_w,v_origin->>'sourcePolicyVersion',v_m,v_origin->'executionProfileEnvelope')->>'canonicalPayload')::jsonb;
  if v_current-array['capturedAt','rows'] is distinct from v_origin-array['capturedAt','rows']
    or public.shadow_state_rows_v1(v_current->'rows',p_member.index_generation_id,v_jobs) is distinct from public.shadow_state_rows_v1(v_origin->'rows',p_member.index_generation_id,v_jobs)
    then raise exception 'shadow_baseline_changed'; end if;
end $$;
alter function public.shadow_assert_origin_unchanged_v1(public.document_index_generations) owner to postgres;
revoke all on function public.shadow_assert_origin_unchanged_v1(public.document_index_generations) from public,anon,authenticated,service_role;

create or replace function public.shadow_ledger_guard_v1()
returns trigger language plpgsql set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_member public.document_index_generations%rowtype; v_projection public.document_generation_projections%rowtype;
  v_old_generation uuid; v_new_generation uuid; v_lock text; v_job public.ingestion_jobs%rowtype; v_receipt jsonb; v_final jsonb; v_seal boolean:=false;
begin
  if tg_table_schema<>'public' or tg_table_name not in ('shadow_reindex_waves','document_index_generations','document_generation_inventory','document_generation_projections','document_generation_baselines') then raise exception 'shadow_guard_owner_mismatch'; end if;
  if tg_op in ('DELETE','TRUNCATE') then raise exception 'shadow_retained_ledger'; end if;
  if current_user<>'postgres' then raise exception 'shadow_fixed_writer_required'; end if;
  v_new:=pg_catalog.to_jsonb(new);
  if tg_op='UPDATE' then
    v_old:=pg_catalog.to_jsonb(old);
    if v_new=v_old then return new; end if;
    if tg_table_name in ('shadow_reindex_waves','document_generation_baselines') then raise exception 'shadow_immutable_bundle'; end if;
  end if;
  if tg_table_name='document_generation_projections' then
    select * into v_member from public.document_index_generations where document_id=new.document_id and index_generation_id=new.index_generation_id for update nowait;
    select * into v_job from public.ingestion_jobs where id=v_member.job_id;
    v_seal:=tg_op='UPDATE' and old.sealed_at is null and new.sealed_at is not null;
    if v_member.document_id is null or v_member.state<>'building' or v_job.id is null
      or v_job.lease_token is distinct from v_member.first_lease_token or v_job.lease_write_generation_id is distinct from v_member.index_generation_id
      or v_job.lease_expected_generation_id is distinct from v_member.baseline_generation_id or v_job.lease_authority_digest is distinct from v_member.authority_digest
      or v_job.lease_expires_at is null or not pg_catalog.isfinite(v_job.lease_expires_at)
      or (not v_seal and (v_job.status<>'processing' or v_job.lease_expires_at<=pg_catalog.clock_timestamp()))
      or (v_seal and (v_job.status<>'completed' or v_job.stage<>'shadow_staged' or v_job.progress<>100
        or v_job.locked_by is not null or v_job.locked_at is not null or v_job.completed_at is distinct from new.sealed_at
        or v_job.lease_expires_at<=new.sealed_at)) then raise exception 'shadow_projection_attempt_invalid'; end if;
    perform public.shadow_validate_projection_components_v1(v_member,new);
    if tg_op='UPDATE' then
      if old.document_id is distinct from new.document_id or old.index_generation_id is distinct from new.index_generation_id
        or old.owner_id is distinct from new.owner_id or old.lease_token is distinct from new.lease_token or old.sealed_at is not null
        then raise exception 'shadow_projection_identity_immutable'; end if;
      if v_seal then
        if not pg_catalog.isfinite(new.sealed_at) or new.sealed_at>pg_catalog.clock_timestamp()
          or v_old-'sealed_at' is distinct from v_new-'sealed_at'
          or exists(select 1 from public.document_generation_inventory where document_id=new.document_id and index_generation_id=new.index_generation_id
            and (disposition='pending' or required and disposition<>'retained'))
          then raise exception 'shadow_projection_seal_invalid'; end if;
      else
        if new.sealed_at is not null then raise exception 'shadow_projection_seal_invalid'; end if;
        if old.summary_digest is not null and (old.summary_digest is distinct from new.summary_digest or old.summary is distinct from new.summary
          or old.generated_labels is distinct from new.generated_labels or old.summary_projection_complete is distinct from new.summary_projection_complete
          or old.enrichment_metadata is distinct from new.enrichment_metadata) then raise exception 'shadow_summary_component_immutable'; end if;
        if old.quality_digest is not null and (old.quality_digest is distinct from new.quality_digest or old.quality is distinct from new.quality)
          then raise exception 'shadow_quality_component_immutable'; end if;
        if old.deep_memory_digest is not null and (old.deep_memory_digest is distinct from new.deep_memory_digest
          or old.deep_memory_artifact_generation_id is distinct from new.deep_memory_artifact_generation_id or old.deep_memory_receipt is distinct from new.deep_memory_receipt
          or old.deep_memory_metadata is distinct from new.deep_memory_metadata or old.producer_aliases is distinct from new.producer_aliases)
          then raise exception 'shadow_deep_component_immutable'; end if;
        if old.worker_state_digest is not null and (old.worker_state_digest is distinct from new.worker_state_digest
          or old.worker_metadata is distinct from new.worker_metadata or old.document_counts is distinct from new.document_counts)
          then raise exception 'shadow_worker_component_immutable'; end if;
        if (new.summary_digest is not null)::integer+(new.quality_digest is not null)::integer+(new.deep_memory_digest is not null)::integer+(new.worker_state_digest is not null)::integer
          <>1+(old.summary_digest is not null)::integer+(old.quality_digest is not null)::integer+(old.deep_memory_digest is not null)::integer+(old.worker_state_digest is not null)::integer
          then raise exception 'shadow_projection_single_component_required'; end if;
      end if;
    elsif new.sealed_at is not null or (new.summary_digest is not null)::integer+(new.quality_digest is not null)::integer+(new.deep_memory_digest is not null)::integer+(new.worker_state_digest is not null)::integer<>1
      then raise exception 'shadow_projection_single_component_required'; end if;
  elsif tg_table_name='document_index_generations' then
    select * into v_job from public.ingestion_jobs where id=new.job_id;
    if not found or v_job.operation is distinct from 'shadow_reindex' or v_job.requested_generation_id is distinct from new.index_generation_id
      or v_job.document_id<>new.document_id or v_job.batch_id is not null or v_job.max_attempts<>1 then raise exception 'shadow_member_job_identity'; end if;
    if tg_op='INSERT' then
      if new.state<>'reserved' or new.control_revision<>0 or v_job.status<>'pending' or v_job.attempt_count<>0 then raise exception 'shadow_reservation_identity'; end if;
    else
      if old.state='building' and new.state='staged' then
        if old.inventory_digest is not null or old.candidate_projection_digest is not null or old.stage_receipt is not null
          or old.stage_receipt_digest is not null or old.staged_at is not null or new.inventory_digest is null
          or new.candidate_projection_digest is null or new.stage_receipt is null or new.stage_receipt_digest is null
          or new.staged_at is null or not pg_catalog.isfinite(new.staged_at) or new.control_revision<>old.control_revision+1
          or v_old-array['state','inventory_digest','candidate_projection_digest','stage_receipt','stage_receipt_digest','staged_at','control_revision','control_snapshot'] is distinct from
            v_new-array['state','inventory_digest','candidate_projection_digest','stage_receipt','stage_receipt_digest','staged_at','control_revision','control_snapshot']
          or v_job.status<>'completed' or v_job.stage<>'shadow_staged' or v_job.progress<>100 or v_job.locked_by is not null
          or v_job.locked_at is not null or v_job.completed_at is distinct from new.staged_at
          then raise exception 'shadow_member_seal_invalid'; end if;
        select * into strict v_projection from public.document_generation_projections where document_id=new.document_id and index_generation_id=new.index_generation_id;
        v_receipt:=public.shadow_inventory_envelope_payload_v1(new.stage_receipt);
        v_final:=public.shadow_inventory_envelope_payload_v1(v_receipt->'finalInventoryEnvelope');
        if v_projection.sealed_at is distinct from new.staged_at or new.stage_receipt->>'digest' is distinct from new.stage_receipt_digest
          or v_receipt->>'kind' is distinct from 'u04-member-seal-receipt-v1' or v_receipt->'version' is distinct from '1'::jsonb
          or v_receipt->'sealedAt' is distinct from pg_catalog.to_jsonb(new.staged_at)
          or v_receipt->'finalInventoryEnvelope'->>'digest' is distinct from new.inventory_digest
          or v_receipt->>'candidateProjectionDigest' is distinct from new.candidate_projection_digest
          or v_final->'projectionEnvelope'->>'digest' is distinct from new.candidate_projection_digest
          or public.shadow_inventory_envelope_payload_v1(v_final->'projectionEnvelope') is distinct from pg_catalog.to_jsonb(v_projection)
          or public.shadow_inventory_envelope_payload_v1(v_receipt->'terminalControlEnvelope') is distinct from new.control_snapshot
          then raise exception 'shadow_member_receipt_invalid'; end if;
      else
        if new.stage_receipt is not null or new.stage_receipt_digest is not null or new.inventory_digest is not null or new.candidate_projection_digest is not null
          or new.staged_at is not null then raise exception 'shadow_terminal_semantics_unavailable'; end if;
        if v_old-array['state','first_lease_token','claimed_at','control_revision','control_snapshot','inventory_manifest','expected_inventory_digest']
          is distinct from v_new-array['state','first_lease_token','claimed_at','control_revision','control_snapshot','inventory_manifest','expected_inventory_digest'] then raise exception 'shadow_member_immutable_identity'; end if;
      end if;
      if old.first_lease_token is not null and (new.first_lease_token is distinct from old.first_lease_token or new.claimed_at is distinct from old.claimed_at) then raise exception 'shadow_first_token_immutable'; end if;
      if new.state<>old.state and not(old.state='reserved' and new.state='building') and not(old.state='building' and new.state='staged') then raise exception 'shadow_lifecycle_invalid'; end if;
      if old.expected_inventory_digest is not null and (new.expected_inventory_digest is distinct from old.expected_inventory_digest or new.inventory_manifest is distinct from old.inventory_manifest) then raise exception 'shadow_manifest_immutable'; end if;
      if new.control_revision not in (old.control_revision,old.control_revision+1) or new.control_revision>9007199254740991 then raise exception 'shadow_control_revision_invalid'; end if;
      if new.control_revision=old.control_revision and new.control_snapshot is distinct from old.control_snapshot then raise exception 'shadow_control_revision_required'; end if;
    end if;
    if new.state='building' and (v_job.lease_token is distinct from new.first_lease_token or v_job.lease_write_generation_id is distinct from new.index_generation_id
      or v_job.attempt_count<>1 or v_job.status not in ('processing','failed')) then raise exception 'shadow_member_attempt_identity'; end if;
    if new.control_snapshot is distinct from public.shadow_control_snapshot_v1(new.job_id,new.control_revision) then raise exception 'shadow_checkpoint_after_image'; end if;
  elsif tg_table_name='document_generation_inventory' then
    select * into v_member from public.document_index_generations where document_id=new.document_id and index_generation_id=new.index_generation_id for update nowait;
    if not found or v_member.state<>'building' or new.lease_token is distinct from v_member.first_lease_token
      or new.source_binding->'source' is distinct from v_member.source_binding or new.source_binding->>'candidateGenerationId' is distinct from new.index_generation_id::text
      or new.source_binding->>'jobId' is distinct from v_member.job_id::text or new.source_binding->>'firstLeaseToken' is distinct from new.lease_token::text then raise exception 'shadow_inventory_identity'; end if;
    select * into v_job from public.ingestion_jobs where id=v_member.job_id;
    if v_job.status<>'processing' or v_job.lease_expires_at is null or v_job.lease_expires_at<=pg_catalog.clock_timestamp() then raise exception 'shadow_lease_lost'; end if;
    if tg_op='INSERT' then
      if new.disposition<>'pending' or new.artifact_ref is not null or new.content_digest is not null or new.reason_code is not null
        or new.retained_native_payload is not null or new.retained_evidence_text is not null then raise exception 'shadow_pending_declaration_required'; end if;
    else
      if old.disposition<>'pending' or new.disposition='pending' then raise exception 'shadow_disposition_immutable'; end if;
      if v_old-array['disposition','reason_code','limitations','artifact_ref','content_digest','relationships','retained_evidence_text','retained_native_payload','representation_version','transform_version']
        is distinct from v_new-array['disposition','reason_code','limitations','artifact_ref','content_digest','relationships','retained_evidence_text','retained_native_payload','representation_version','transform_version'] then raise exception 'shadow_unit_declaration_immutable'; end if;
    end if;
  end if;
  return new;
end $$;
alter function public.shadow_ledger_guard_v1() owner to postgres;
revoke all on function public.shadow_ledger_guard_v1() from public,anon,authenticated,service_role;
create trigger shadow_reindex_waves_immutability before insert or update or delete on public.shadow_reindex_waves for each row execute function public.shadow_ledger_guard_v1();
create trigger document_index_generations_immutability before insert or update or delete on public.document_index_generations for each row execute function public.shadow_ledger_guard_v1();
create trigger document_generation_inventory_immutability before insert or update or delete on public.document_generation_inventory for each row execute function public.shadow_ledger_guard_v1();
create trigger document_generation_projections_immutability before insert or update or delete on public.document_generation_projections for each row execute function public.shadow_ledger_guard_v1();
create trigger document_generation_baselines_immutability before insert or update or delete on public.document_generation_baselines for each row execute function public.shadow_ledger_guard_v1();
create trigger shadow_reindex_waves_no_truncate before truncate on public.shadow_reindex_waves for each statement execute function public.shadow_ledger_guard_v1();
create trigger document_index_generations_no_truncate before truncate on public.document_index_generations for each statement execute function public.shadow_ledger_guard_v1();
create trigger document_generation_inventory_no_truncate before truncate on public.document_generation_inventory for each statement execute function public.shadow_ledger_guard_v1();
create trigger document_generation_projections_no_truncate before truncate on public.document_generation_projections for each statement execute function public.shadow_ledger_guard_v1();
create trigger document_generation_baselines_no_truncate before truncate on public.document_generation_baselines for each statement execute function public.shadow_ledger_guard_v1();


create or replace function public.prepare_ingestion_image_upload(p_fence jsonb, p_generation uuid, p_extension text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  if p_generation is null or p_fence->>'job_kind' is distinct from 'node' then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  perform public.shadow_control_before_v1(p_fence,v_locked);
  v_document_id := (p_fence->>'document_id')::uuid;
  if coalesce(p_extension,'') not in ('png','jpg','jpeg','webp') then raise exception 'invalid_ingestion_image_extension'; end if;
  return jsonb_build_object('ok',true,'storage_path',v_document_id::text || '/' || (p_fence->>'lease_token') || '/' || p_generation::text || '/' || gen_random_uuid()::text || '.' || p_extension);
end $$;
alter function public.prepare_ingestion_image_upload(jsonb, uuid, text) owner to postgres;
revoke all on function public.prepare_ingestion_image_upload(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_ingestion_image_upload(jsonb, uuid, text) to service_role;

create or replace function public.write_ingestion_base_artifacts(p_fence jsonb, p_generation uuid, p_chunks jsonb, p_images jsonb, p_table_facts jsonb, p_embedding_fields jsonb, p_index_units jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_shadow boolean; v_member public.document_index_generations%rowtype; v_profile jsonb; v_count bigint; v_bytes bigint; v_family text; v_rows jsonb; v_locked jsonb; v_document_id uuid; v_row jsonb;
begin
  if p_generation is null or p_fence->>'job_kind' is distinct from 'node' then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_shadow:=public.shadow_control_before_v1(p_fence,v_locked);
  if v_shadow then
    select * into v_member from public.document_index_generations where job_id=(p_fence->>'job_id')::uuid;
    v_profile:=public.shadow_profile_capture_v1((v_member.original_origin_envelope->>'canonicalPayload')::jsonb->'executionProfileEnvelope');
    v_count:=0;
    for v_family,v_rows in select * from (values ('chunks',p_chunks),('images',p_images),('table_facts',p_table_facts),('embedding_fields',p_embedding_fields),('index_units',p_index_units)) batches(family,rows) loop
      if pg_catalog.jsonb_typeof(v_rows) is distinct from 'array' then raise exception 'invalid_ingestion_artifact_batch'; end if;
      v_count:=v_count+pg_catalog.jsonb_array_length(v_rows);
      for v_row in select value from pg_catalog.jsonb_array_elements(v_rows) loop
        if pg_catalog.jsonb_typeof(v_row->'id') is distinct from 'string' or not exists(select 1 from public.document_generation_inventory i
          where i.document_id=v_member.document_id and i.index_generation_id=p_generation and i.family=v_family and i.unit_key=v_row->>'id'
            and i.disposition='pending' and i.artifact_generation_id is null and i.lease_token=v_member.first_lease_token)
          then raise exception 'shadow_declaration_required'; end if;
      end loop;
    end loop;
    v_bytes:=pg_catalog.octet_length(pg_catalog.convert_to(pg_catalog.jsonb_build_array(p_chunks,p_images,p_table_facts,p_embedding_fields,p_index_units)::text,'UTF8'));
    if v_count>least(2000,(v_profile->'limits'->>'maxAppendRows')::bigint) or v_bytes>least(16777216,(v_profile->'limits'->>'maxAppendBytes')::bigint) then raise exception 'shadow_append_too_large'; end if;
  end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_chunks) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_chunks(id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,retrieval_synopsis,content_hash,index_generation_id,token_estimate,image_ids,metadata,embedding) select r.id,r.document_id,r.page_number,r.chunk_index,r.section_heading,r.section_path,r.heading_level,r.parent_heading,r.anchor_id,r.content,r.retrieval_synopsis,r.content_hash,r.index_generation_id,r.token_estimate,r.image_ids,r.metadata,r.embedding
      from jsonb_populate_record(null::public.document_chunks,v_row) r;
  end loop;
  if jsonb_typeof(p_images) is distinct from 'array' or jsonb_array_length(p_images) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_images) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);
    if coalesce(v_row->>'storage_path','') !~ ('^' || v_document_id::text || '/' || (p_fence->>'lease_token') || '/' || p_generation::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then raise exception 'ingestion_image_path_mismatch'; end if;
    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));

    insert into public.document_images(id,document_id,page_number,storage_path,mime_type,caption,bbox,image_type,searchable,clinical_relevance_score,skip_reason,source_kind,width,height,image_hash,perceptual_hash,labels,index_generation_id,caption_confidence,clinical_priority_score,crop_completeness,image_quality_score,ocr_text_density,structured_extraction_confidence,visual_duplicate_group,metadata) select r.id,r.document_id,r.page_number,r.storage_path,r.mime_type,r.caption,r.bbox,r.image_type,r.searchable,r.clinical_relevance_score,r.skip_reason,r.source_kind,r.width,r.height,r.image_hash,r.perceptual_hash,r.labels,r.index_generation_id,r.caption_confidence,r.clinical_priority_score,r.crop_completeness,r.image_quality_score,r.ocr_text_density,r.structured_extraction_confidence,r.visual_duplicate_group,r.metadata
      from jsonb_populate_record(null::public.document_images,v_row) r;
  end loop;
  if jsonb_typeof(p_table_facts) is distinct from 'array' or jsonb_array_length(p_table_facts) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_table_facts) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));

    insert into public.document_table_facts(id,owner_id,document_id,source_chunk_id,source_image_id,page_number,table_title,row_label,clinical_parameter,threshold_value,action,normalized_terms,index_generation_id,metadata) select r.id,r.owner_id,r.document_id,r.source_chunk_id,r.source_image_id,r.page_number,r.table_title,r.row_label,r.clinical_parameter,r.threshold_value,r.action,r.normalized_terms,r.index_generation_id,r.metadata
      from jsonb_populate_record(null::public.document_table_facts,v_row) r;
  end loop;
  if jsonb_typeof(p_embedding_fields) is distinct from 'array' or jsonb_array_length(p_embedding_fields) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_embedding_fields) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_embedding_fields(id,owner_id,document_id,source_chunk_id,field_type,content,content_hash,embedding,index_generation_id,metadata) select r.id,r.owner_id,r.document_id,r.source_chunk_id,r.field_type,r.content,r.content_hash,r.embedding,r.index_generation_id,r.metadata
      from jsonb_populate_record(null::public.document_embedding_fields,v_row) r;
  end loop;
  if jsonb_typeof(p_index_units) is distinct from 'array' or jsonb_array_length(p_index_units) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_index_units) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',p_generation,'producer','local-worker','artifact_generation_id',case when v_shadow then null::uuid else p_generation end,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_index_units(id,owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,producer,artifact_generation_id,embedding,metadata) select r.id,r.owner_id,r.document_id,r.unit_type,r.source_chunk_id,r.source_image_id,r.page_start,r.page_end,r.heading_path,r.title,r.content,r.normalized_terms,r.source_span,r.quality_score,r.extraction_mode,r.index_generation_id,r.producer,r.artifact_generation_id,r.embedding,r.metadata
      from jsonb_populate_record(null::public.document_index_units,v_row) r;
  end loop;
  return jsonb_build_object('ok',true);
end $$;
alter function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.shadow_inventory_ref_v1(p_ref jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare v_tag text; v_key text;
begin
  v_tag:=p_ref->>'tag';
  if v_tag in ('origin_row','candidate_row') then
    if not public.shadow_keys_v1(p_ref,array['tag','owner','rowId','rowDigest'])
      or pg_catalog.jsonb_typeof(p_ref->'owner') is distinct from 'string'
      or (p_ref->>'owner' in ('page','chunk','image','table_fact','embedding_field','index_unit','section','memory_card','summary','label','quality','document','alias','node_job','edge_job','job_stage','import_batch')) is not true
      or (v_tag='candidate_row' and p_ref->>'owner' not in ('page','chunk','image','table_fact','embedding_field','index_unit','section','memory_card'))
      or pg_catalog.jsonb_typeof(p_ref->'rowId') is distinct from 'string' or pg_catalog.length(p_ref->>'rowId')<>36
      or (p_ref->>'rowId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is not true then raise exception 'invalid_shadow_reference'; end if;
    v_key:='rowDigest';
  elsif v_tag='candidate_projection' then
    if not public.shadow_keys_v1(p_ref,array['tag','slot','itemId','payloadDigest'])
      or (p_ref->>'slot' in ('summary','generated_labels','quality','worker_metadata','document_counts','enrichment_metadata','deep_memory_metadata','deep_memory_receipt','producer_aliases')) is not true
      or (case when p_ref->>'slot' in ('generated_labels','producer_aliases') then pg_catalog.jsonb_typeof(p_ref->'itemId')='string'
        and pg_catalog.length(p_ref->>'itemId')=36 and p_ref->>'itemId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        else p_ref->'itemId'='null'::jsonb end) is not true then raise exception 'invalid_shadow_reference'; end if;
    v_key:='payloadDigest';
  elsif v_tag='retained_payload' then
    if not public.shadow_keys_v1(p_ref,array['tag','envelopeDigest','representation','mediaType','byteLength'])
      or (p_ref->>'representation' in ('producer_text','producer_json','producer_bytes','cache_input','repair_audit_input','control_checkpoint')) is not true then raise exception 'invalid_shadow_reference'; end if;
    v_key:='envelopeDigest';
  elsif v_tag='private_object' then
    if not public.shadow_keys_v1(p_ref,array['tag','bucket','objectPath','objectVersion','sha256','byteLength','mediaType'])
      or pg_catalog.jsonb_typeof(p_ref->'bucket') is distinct from 'string' or pg_catalog.length(p_ref->>'bucket')=0
      or pg_catalog.jsonb_typeof(p_ref->'objectPath') is distinct from 'string' or pg_catalog.length(p_ref->>'objectPath')=0
      or (pg_catalog.jsonb_typeof(p_ref->'objectVersion')='string' and pg_catalog.length(p_ref->>'objectVersion')>0 or p_ref->'objectVersion'='null'::jsonb) is not true then raise exception 'invalid_shadow_reference'; end if;
    v_key:='sha256';
  else raise exception 'invalid_shadow_reference'; end if;
  if pg_catalog.jsonb_typeof(p_ref->v_key) is distinct from 'string' or pg_catalog.length(p_ref->>v_key)<>71 or (p_ref->>v_key ~ '^sha256:[0-9a-f]{64}$') is not true then raise exception 'invalid_shadow_reference'; end if;
  if v_tag in ('retained_payload','private_object') and (pg_catalog.jsonb_typeof(p_ref->'mediaType') is distinct from 'string' or pg_catalog.length(p_ref->>'mediaType')=0
    or pg_catalog.jsonb_typeof(p_ref->'byteLength') is distinct from 'number' or (p_ref->>'byteLength')::numeric not between 0 and 9007199254740991
    or (p_ref->>'byteLength')::numeric<>pg_catalog.trunc((p_ref->>'byteLength')::numeric)) then raise exception 'invalid_shadow_reference'; end if;
end $$;
alter function public.shadow_inventory_ref_v1(jsonb) owner to postgres;
revoke all on function public.shadow_inventory_ref_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_inventory_pointer_v1(p_pointer jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare v_component jsonb;
begin
  if not public.shadow_keys_v1(p_pointer,array['ref','path']) or pg_catalog.jsonb_typeof(p_pointer->'path') is distinct from 'array' then raise exception 'invalid_shadow_pointer'; end if;
  perform public.shadow_inventory_ref_v1(p_pointer->'ref');
  for v_component in select value from pg_catalog.jsonb_array_elements(p_pointer->'path') loop
    if pg_catalog.jsonb_typeof(v_component)='string' then continue; end if;
    if pg_catalog.jsonb_typeof(v_component) is distinct from 'number' or v_component::text::numeric not between 0 and 9007199254740991
      or v_component::text::numeric<>pg_catalog.trunc(v_component::text::numeric) then raise exception 'invalid_shadow_pointer'; end if;
  end loop;
end $$;
alter function public.shadow_inventory_pointer_v1(jsonb) owner to postgres;
revoke all on function public.shadow_inventory_pointer_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_inventory_limitation_v1(p_value jsonb,p_family text)
returns void language plpgsql immutable set search_path = '' as $$
declare v_entry jsonb;
begin
  if not public.shadow_keys_v1(p_value,array['version','code','scope','evidence','explanation','blocks']) or p_value->'version' is distinct from '1'::jsonb
    or (p_value->>'code' in ('producer_unavailable','producer_failed','producer_skipped','policy_excluded','not_applicable','no_units_expected','native_capability_unknown','native_capability_unavailable','reference_unavailable','object_attachment_ambiguous','measurement_unavailable','source_identity_unavailable')) is not true
    or not public.shadow_keys_v1(p_value->'scope',array['family','key']) or p_value->'scope'->>'family' is distinct from p_family
    or pg_catalog.jsonb_typeof(p_value->'scope'->'key') is distinct from 'string' or pg_catalog.length(p_value->'scope'->>'key')=0
    or pg_catalog.jsonb_typeof(p_value->'explanation') is distinct from 'string' or pg_catalog.length(p_value->>'explanation')=0
    or pg_catalog.jsonb_typeof(p_value->'evidence') is distinct from 'array' or pg_catalog.jsonb_typeof(p_value->'blocks') is distinct from 'array' then raise exception 'invalid_shadow_limitation'; end if;
  for v_entry in select value from pg_catalog.jsonb_array_elements(p_value->'evidence') loop perform public.shadow_inventory_pointer_v1(v_entry); end loop;
  for v_entry in select value from pg_catalog.jsonb_array_elements(p_value->'blocks') loop
    if pg_catalog.jsonb_typeof(v_entry) is distinct from 'string' or (v_entry#>>'{}' in ('audit_mapping','text_retrieval','vector_retrieval','structured_retrieval','visual_retrieval','summary_context','deep_memory_context','alias_expansion','recovery','full_engine_evaluation','native_fidelity','semantic_support')) is not true then raise exception 'invalid_shadow_limitation'; end if;
  end loop;
end $$;
alter function public.shadow_inventory_limitation_v1(jsonb,text) owner to postgres;
revoke all on function public.shadow_inventory_limitation_v1(jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.shadow_validate_producer_declaration_v1(p_declaration jsonb,p_family text,p_group text,p_token uuid,p_candidate uuid,p_baseline uuid)
returns void language plpgsql immutable set search_path = '' as $$
declare v_population jsonb; v_unit jsonb; v_pointer jsonb; v_prior text; v_d uuid;
begin
  if not public.shadow_keys_v1(p_declaration,array['firstLeaseToken','producer','artifactGenerationId','population','outputManifestEnvelope'])
    or pg_catalog.jsonb_typeof(p_declaration->'firstLeaseToken') is distinct from 'string' or p_token is null or p_declaration->>'firstLeaseToken' is distinct from p_token::text
    or not public.shadow_keys_v1(p_declaration->'producer',array['name','version','outputManifestDigest'])
    or pg_catalog.jsonb_typeof(p_declaration->'producer'->'name') is distinct from 'string' or pg_catalog.length(p_declaration->'producer'->>'name')=0
    or (p_declaration->'producer'->'version'='null'::jsonb or pg_catalog.jsonb_typeof(p_declaration->'producer'->'version')='string' and pg_catalog.length(p_declaration->'producer'->>'version')>0) is not true
    or public.shadow_capture_raw_envelope_valid_v1(p_declaration->'outputManifestEnvelope') is not true
    or p_declaration->'producer'->>'outputManifestDigest' is distinct from p_declaration->'outputManifestEnvelope'->>'digest'
    then raise exception 'invalid_shadow_producer_declaration'; end if;
  if (p_declaration->'artifactGenerationId'='null'::jsonb or pg_catalog.jsonb_typeof(p_declaration->'artifactGenerationId')='string'
    and pg_catalog.length(p_declaration->>'artifactGenerationId')=36 and p_declaration->>'artifactGenerationId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is not true then raise exception 'invalid_shadow_producer_declaration'; end if;
  v_d:=(p_declaration->>'artifactGenerationId')::uuid;
  if (p_group<>'deep_memory' and v_d is not null) or (v_d is not null and (v_d=p_candidate or v_d=p_baseline)) then raise exception 'invalid_shadow_producer_generation'; end if;
  v_population:=p_declaration->'population';
  if v_population->>'tag'='known' then
    if not public.shadow_keys_v1(v_population,array['tag','expectedUnits','basis','reason']) or pg_catalog.jsonb_typeof(v_population->'expectedUnits') is distinct from 'array'
      or pg_catalog.jsonb_typeof(v_population->'basis') is distinct from 'array'
      or (pg_catalog.jsonb_array_length(v_population->'expectedUnits')=0 and (v_population->>'reason' is distinct from 'no_units_expected' or pg_catalog.jsonb_array_length(v_population->'basis')=0))
      or (pg_catalog.jsonb_array_length(v_population->'expectedUnits')>0 and (v_population->'reason' is distinct from 'null'::jsonb or p_group='deep_memory' and v_d is null)) then raise exception 'invalid_shadow_producer_population'; end if;
    for v_unit in select value from pg_catalog.jsonb_array_elements(v_population->'expectedUnits') loop
      if not public.shadow_keys_v1(v_unit,array['family','key']) or v_unit->>'family' is distinct from p_family or pg_catalog.jsonb_typeof(v_unit->'key') is distinct from 'string'
        or pg_catalog.length(v_unit->>'key')=0 or (v_prior is not null and public.shadow_utf16_order_v1(v_prior)>=public.shadow_utf16_order_v1(v_unit->>'key')) then raise exception 'invalid_shadow_producer_population'; end if;
      v_prior:=v_unit->>'key';
    end loop;
    for v_pointer in select value from pg_catalog.jsonb_array_elements(v_population->'basis') loop perform public.shadow_inventory_pointer_v1(v_pointer); end loop;
  elsif v_population->>'tag' in ('unknown','unavailable') then
    if not public.shadow_keys_v1(v_population,array['tag','limitation']) then raise exception 'invalid_shadow_producer_population'; end if;
    perform public.shadow_inventory_limitation_v1(v_population->'limitation',p_family);
    if v_population->>'tag'='unknown' and p_family not in ('native_structure','cache_inputs','repair_audit_inputs') then raise exception 'invalid_shadow_producer_population'; end if;
    if v_population->>'tag'='unavailable' and (p_group not in ('worker_native','deep_memory','enrichment','cache','repair')
      or v_population->'limitation'->>'code' not in ('producer_unavailable','producer_failed','producer_skipped')) then raise exception 'invalid_shadow_producer_population'; end if;
  else raise exception 'invalid_shadow_producer_population'; end if;
end $$;
alter function public.shadow_validate_producer_declaration_v1(jsonb,text,text,uuid,uuid,uuid) owner to postgres;
revoke all on function public.shadow_validate_producer_declaration_v1(jsonb,text,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Canonical family order and complete durable declaration output.
create or replace function public.shadow_generation_manifest_shape(p_manifest jsonb, p_first_token uuid)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_slots constant jsonb := '[{"family":"pages","groups":[{"groupKey":"worker_core"}]},{"family":"native_structure","groups":[{"groupKey":"worker_native"}]},{"family":"chunks","groups":[{"groupKey":"worker_core"}]},{"family":"images","groups":[{"groupKey":"worker_core"}]},{"family":"table_facts","groups":[{"groupKey":"worker_core"}]},{"family":"embedding_fields","groups":[{"groupKey":"worker_core"}]},{"family":"index_units","groups":[{"groupKey":"worker_core"},{"groupKey":"deep_memory"}]},{"family":"sections","groups":[{"groupKey":"deep_memory"}]},{"family":"memory_cards","groups":[{"groupKey":"deep_memory"}]},{"family":"summary","groups":[{"groupKey":"enrichment"}]},{"family":"generated_labels","groups":[{"groupKey":"enrichment"}]},{"family":"quality","groups":[{"groupKey":"worker_core"}]},{"family":"document_metadata","groups":[{"groupKey":"projection_aggregate"}]},{"family":"producer_aliases","groups":[{"groupKey":"deep_memory"}]},{"family":"private_objects","groups":[{"groupKey":"private_objects"}]},{"family":"attempt_control","groups":[{"groupKey":"control"}]},{"family":"cache_inputs","groups":[{"groupKey":"cache"}]},{"family":"repair_audit_inputs","groups":[{"groupKey":"repair"}]}]'::jsonb;
  v_family jsonb; v_group jsonb; v_expected jsonb; v_declaration jsonb;
  v_i integer; v_j integer;
begin
  if not coalesce(pg_catalog.jsonb_typeof(p_manifest) = 'object'
    and p_manifest ?& array['version','documentId','candidateGenerationId','jobId','families']
    and p_manifest - array['version','documentId','candidateGenerationId','jobId','families'] = '{}'::jsonb
    and p_manifest -> 'version' = '1'::jsonb
    and pg_catalog.jsonb_typeof(p_manifest -> 'families') = 'array', false) then return false; end if;
  if pg_catalog.jsonb_array_length(p_manifest -> 'families') <> 18 then return false; end if;
  for v_i in 0..17 loop
    v_family := p_manifest -> 'families' -> v_i;
    select value into v_expected from pg_catalog.jsonb_array_elements(v_slots) order by public.shadow_utf16_order_v1(value->>'family') offset v_i limit 1;
    if not coalesce(pg_catalog.jsonb_typeof(v_family) = 'object'
      and v_family ?& array['family','groups'] and v_family - array['family','groups'] = '{}'::jsonb
      and v_family -> 'family' = v_expected -> 'family'
      and pg_catalog.jsonb_typeof(v_family -> 'groups') = 'array', false) then return false; end if;
    if pg_catalog.jsonb_array_length(v_family -> 'groups') <> pg_catalog.jsonb_array_length(v_expected -> 'groups')
      then return false; end if;
    for v_j in 0..pg_catalog.jsonb_array_length(v_expected -> 'groups') - 1 loop
      v_group := v_family -> 'groups' -> v_j;
      if not coalesce(pg_catalog.jsonb_typeof(v_group) = 'object'
        and v_group ?& array['groupKey','state','declaration']
        and v_group - array['groupKey','state','declaration'] = '{}'::jsonb
        and v_group -> 'groupKey' = v_expected -> 'groups' -> v_j -> 'groupKey'
        and v_group ->> 'state' in ('pending','declared'), false) then return false; end if;
      if v_group ->> 'state' = 'pending' then
        if v_group -> 'declaration' is distinct from 'null'::jsonb then return false; end if;
      else
        v_declaration := v_group -> 'declaration';
        perform public.shadow_validate_producer_declaration_v1(v_declaration,v_family->>'family',v_group->>'groupKey',p_first_token,(p_manifest->>'candidateGenerationId')::uuid,null);
        if not coalesce(p_first_token is not null
          and pg_catalog.jsonb_typeof(v_declaration) = 'object'
          and v_declaration ?& array['firstLeaseToken','producer','artifactGenerationId','population','outputManifestEnvelope']
          and v_declaration - array['firstLeaseToken','producer','artifactGenerationId','population','outputManifestEnvelope'] = '{}'::jsonb
          and pg_catalog.jsonb_typeof(v_declaration -> 'firstLeaseToken') = 'string'
          and v_declaration ->> 'firstLeaseToken' = p_first_token::text
          and pg_catalog.jsonb_typeof(v_declaration -> 'producer') = 'object'
          and pg_catalog.jsonb_typeof(v_declaration -> 'population') = 'object'
          and pg_catalog.jsonb_typeof(v_declaration -> 'artifactGenerationId') in ('string','null'),
          false) then return false; end if;
        if v_declaration -> 'artifactGenerationId' <> 'null'::jsonb and not coalesce(
          pg_catalog.length(v_declaration ->> 'artifactGenerationId') = 36
          and v_declaration ->> 'artifactGenerationId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
          false) then return false; end if;
        if not coalesce(
          (v_declaration -> 'producer') ?& array['name','version','outputManifestDigest']
          and (v_declaration -> 'producer') - array['name','version','outputManifestDigest'] = '{}'::jsonb
          and pg_catalog.jsonb_typeof(v_declaration -> 'producer' -> 'name') = 'string'
          and pg_catalog.btrim(v_declaration -> 'producer' ->> 'name') <> ''
          and pg_catalog.jsonb_typeof(v_declaration -> 'producer' -> 'version') in ('string','null')
          and pg_catalog.jsonb_typeof(v_declaration -> 'producer' -> 'outputManifestDigest') = 'string'
          and pg_catalog.length(v_declaration -> 'producer' ->> 'outputManifestDigest') = 71
          and v_declaration -> 'producer' ->> 'outputManifestDigest' ~ '^sha256:[0-9a-f]{64}$'
          and v_declaration -> 'population' ->> 'tag' in ('known','unknown','unavailable'), false)
          then return false; end if;
        if v_declaration -> 'population' ->> 'tag' = 'known' then
          if not coalesce(
            (v_declaration -> 'population') ?& array['tag','expectedUnits','basis','reason']
            and (v_declaration -> 'population') - array['tag','expectedUnits','basis','reason'] = '{}'::jsonb
            and pg_catalog.jsonb_typeof(v_declaration -> 'population' -> 'expectedUnits') = 'array'
            and pg_catalog.jsonb_typeof(v_declaration -> 'population' -> 'basis') = 'array', false)
            then return false; end if;
          if pg_catalog.jsonb_array_length(v_declaration -> 'population' -> 'expectedUnits') = 0 then
            if v_declaration -> 'population' -> 'reason' is distinct from '"no_units_expected"'::jsonb
              then return false; end if;
          elsif v_declaration -> 'population' -> 'reason' is distinct from 'null'::jsonb then
            return false;
          end if;
        elsif not coalesce(
          (v_declaration -> 'population') ?& array['tag','limitation']
          and (v_declaration -> 'population') - array['tag','limitation'] = '{}'::jsonb
          and pg_catalog.jsonb_typeof(v_declaration -> 'population' -> 'limitation') = 'object'
          and v_declaration -> 'population' -> 'limitation' <> '{}'::jsonb, false) then
          return false;
        end if;
      end if;
    end loop;
  end loop;
  return true;
end $$;
alter function public.shadow_generation_manifest_shape(jsonb,uuid) owner to postgres;
revoke all on function public.shadow_generation_manifest_shape(jsonb,uuid) from public, anon, authenticated, service_role;

-- Audit observations preserve six fractional digits. Recovery Date semantics
-- remain separately implemented by shadow_recovery_timestamp_ms_v1.
create or replace function public.shadow_audit_micros_v1(p_value jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v_text text; v_parts text[]; v_year integer; v_month integer; v_day integer; v_date date;
  v_hour integer; v_minute integer; v_second integer; v_zone text; v_zone_hours integer; v_zone_minutes integer; v_offset integer:=0;
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'string' then raise exception 'invalid_shadow_timestamp'; end if;
  v_text:=p_value#>>'{}';
  if v_text ~ E'[\n\r]' then raise exception 'invalid_shadow_timestamp'; end if;
  v_parts:=pg_catalog.regexp_match(v_text,'^([0-9]{4})-([0-9]{2})-([0-9]{2})[ T]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?(Z|[+-][0-9]{2}(?::?[0-9]{2})?)$');
  if v_parts is null then raise exception 'invalid_shadow_timestamp'; end if;
  v_year:=v_parts[1]::integer;v_month:=v_parts[2]::integer;v_day:=v_parts[3]::integer;
  v_date:=pg_catalog.make_date(case when v_year=0 then -1 else v_year end,v_month,v_day);
  v_hour:=v_parts[4]::integer;v_minute:=v_parts[5]::integer;v_second:=v_parts[6]::integer;
  if v_hour>23 or v_minute>59 or v_second>59 then raise exception 'invalid_shadow_timestamp'; end if;
  v_zone:=v_parts[8];
  if v_zone<>'Z' then
    v_zone:=pg_catalog.replace(v_zone,':','');v_zone_hours:=pg_catalog.substr(v_zone,2,2)::integer;
    v_zone_minutes:=case when pg_catalog.length(v_zone)=3 then 0 else pg_catalog.substr(v_zone,4,2)::integer end;
    if v_zone_hours>15 or v_zone_minutes>59 then raise exception 'invalid_shadow_timestamp'; end if;
    v_offset:=(v_zone_hours*60+v_zone_minutes)*case when pg_catalog.left(v_zone,1)='-' then -1 else 1 end;
  end if;
  return (v_date-date '1970-01-01')::numeric*86400000000+(v_hour*3600+v_minute*60+v_second-v_offset*60)::numeric*1000000
    +pg_catalog.rpad(coalesce(v_parts[7],''),6,'0')::numeric;
exception when others then raise exception 'invalid_shadow_timestamp' using errcode='22023';
end $$;
alter function public.shadow_audit_micros_v1(jsonb) owner to postgres;
revoke all on function public.shadow_audit_micros_v1(jsonb) from public,anon,authenticated,service_role;
create or replace function public.shadow_audit_timestamp_v1(p_value jsonb)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare v_micros numeric;v_days integer;v_remainder bigint;
begin
  v_micros:=public.shadow_audit_micros_v1(p_value);v_days:=pg_catalog.floor(v_micros/86400000000)::integer;
  v_remainder:=(v_micros-v_days::numeric*86400000000)::bigint;
  return ((date '1970-01-01'+v_days)::timestamp+(v_remainder/1000000)*interval '1 second'+(v_remainder%1000000)*interval '1 microsecond') at time zone 'UTC';
end $$;
alter function public.shadow_audit_timestamp_v1(jsonb) owner to postgres;
revoke all on function public.shadow_audit_timestamp_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_inventory_envelope_payload_v1(p_envelope jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_payload jsonb;
begin
  if public.shadow_capture_raw_envelope_valid_v1(p_envelope) is not true then raise exception 'invalid_shadow_inventory_envelope'; end if;
  if p_envelope->>'encoding'='node-json-v1' then return public.shadow_node_payload_v1(p_envelope,p_envelope->>'domain'); end if;
  v_payload:=(p_envelope->>'canonicalPayload')::jsonb;
  if v_payload::text is distinct from p_envelope->>'canonicalPayload' then raise exception 'invalid_shadow_inventory_envelope'; end if;
  return v_payload;
end $$;
alter function public.shadow_inventory_envelope_payload_v1(jsonb) owner to postgres;
revoke all on function public.shadow_inventory_envelope_payload_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.validate_shadow_inventory_v1(p_declarations jsonb,p_dispositions jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare v_group jsonb;v_unit jsonb;v_outcome jsonb;v_item jsonb;v_component jsonb;v_prior bytea;v_identity bytea;v_key text;
begin
  if not public.shadow_keys_v1(p_declarations,array['version','expectedControlRevision','groups','units']) or p_declarations->'version' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_declarations->'expectedControlRevision') is distinct from 'number'
    or (p_declarations->>'expectedControlRevision')::numeric not between 0 and 9007199254740991
    or (p_declarations->>'expectedControlRevision')::numeric<>pg_catalog.trunc((p_declarations->>'expectedControlRevision')::numeric)
    or pg_catalog.jsonb_typeof(p_declarations->'groups') is distinct from 'array' or pg_catalog.jsonb_typeof(p_declarations->'units') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_dispositions) is distinct from 'array' then raise exception 'invalid_shadow_inventory'; end if;
  for v_group in select value from pg_catalog.jsonb_array_elements(p_declarations->'groups') loop
    if not public.shadow_keys_v1(v_group,array['family','groupKey','declaration']) or pg_catalog.jsonb_typeof(v_group->'family') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_group->'groupKey') is distinct from 'string' then raise exception 'invalid_shadow_inventory'; end if;
    v_identity:=public.shadow_utf16_order_v1(v_group->>'family')||'\x0000'::bytea||case when v_group->>'groupKey'='deep_memory' then '\x0001'::bytea else '\x0000'::bytea end;
    if v_prior is not null and v_identity<=v_prior then raise exception 'invalid_shadow_inventory_order'; end if;v_prior:=v_identity;
  end loop;
  v_prior:=null;
  for v_unit in select value from pg_catalog.jsonb_array_elements(p_declarations->'units') loop
    if not public.shadow_keys_v1(v_unit,array['family','unitKey','expected','required','producer','sourceBinding'])
      or pg_catalog.jsonb_typeof(v_unit->'family') is distinct from 'string' or pg_catalog.jsonb_typeof(v_unit->'unitKey') is distinct from 'string' or pg_catalog.length(v_unit->>'unitKey')=0
      or pg_catalog.jsonb_typeof(v_unit->'expected') is distinct from 'boolean' or pg_catalog.jsonb_typeof(v_unit->'required') is distinct from 'boolean'
      or (v_unit->'required'='true'::jsonb and v_unit->'expected'<>'true'::jsonb)
      or pg_catalog.jsonb_typeof(v_unit->'producer') is distinct from 'string' or pg_catalog.length(v_unit->>'producer')=0
      or not public.shadow_keys_v1(v_unit->'sourceBinding',array['tag','source','candidateGenerationId','jobId','firstLeaseToken','artifactGenerationId'])
      or v_unit->'sourceBinding'->>'tag' is distinct from 'candidate' then raise exception 'invalid_shadow_inventory_unit'; end if;
    v_identity:=public.shadow_utf16_order_v1(v_unit->>'family')||'\x0000'::bytea||public.shadow_utf16_order_v1(v_unit->>'unitKey');
    if v_prior is not null and v_identity<=v_prior then raise exception 'invalid_shadow_inventory_order'; end if;v_prior:=v_identity;
  end loop;
  v_prior:=null;
  for v_outcome in select value from pg_catalog.jsonb_array_elements(p_dispositions) loop
    if not public.shadow_keys_v1(v_outcome,array['family','unitKey','disposition','reasonCode','limitations','artifactRef','contentDigest','relationships','retainedEvidenceText','retainedNativePayload','representationVersion','transformVersion'])
      or pg_catalog.jsonb_typeof(v_outcome->'family') is distinct from 'string' or pg_catalog.jsonb_typeof(v_outcome->'unitKey') is distinct from 'string' or pg_catalog.length(v_outcome->>'unitKey')=0
      or (v_outcome->>'disposition' in ('retained','failed','skipped','excluded','not_required')) is not true
      or pg_catalog.jsonb_typeof(v_outcome->'limitations') is distinct from 'array' or pg_catalog.jsonb_typeof(v_outcome->'relationships') is distinct from 'array'
      then raise exception 'invalid_shadow_disposition'; end if;
    foreach v_key in array array['reasonCode','contentDigest','retainedEvidenceText','retainedNativePayload','representationVersion','transformVersion'] loop
      if (v_outcome->v_key='null'::jsonb or pg_catalog.jsonb_typeof(v_outcome->v_key)='string') is not true then raise exception 'invalid_shadow_disposition'; end if;
    end loop;
    if v_outcome->'artifactRef'<>'null'::jsonb then perform public.shadow_inventory_ref_v1(v_outcome->'artifactRef'); end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_outcome->'limitations') loop perform public.shadow_inventory_limitation_v1(v_item,v_outcome->>'family'); end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_outcome->'relationships') loop
      if not public.shadow_keys_v1(v_item,case when v_item->>'tag'='anchor' then array['tag','field','target','value'] else array['tag','field','target'] end)
        or (v_item->>'tag' in ('source_chunk','source_image','section','page','private_object','anchor','input')) is not true
        or not public.shadow_keys_v1(v_item->'target',array['family','key']) or pg_catalog.jsonb_typeof(v_item->'target'->'family') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_item->'target'->'key') is distinct from 'string' or pg_catalog.length(v_item->'target'->>'key')=0
        or (v_item->>'tag'='anchor' and (pg_catalog.jsonb_typeof(v_item->'value') is distinct from 'string' or pg_catalog.length(v_item->>'value')=0))
        then raise exception 'invalid_shadow_relationship'; end if;
      if pg_catalog.jsonb_typeof(v_item->'field') is distinct from 'array' then raise exception 'invalid_shadow_relationship'; end if;
      for v_component in select value from pg_catalog.jsonb_array_elements(v_item->'field') loop
        if pg_catalog.jsonb_typeof(v_component)='string' then continue; end if;
        if pg_catalog.jsonb_typeof(v_component) is distinct from 'number' or v_component::text::numeric not between 0 and 9007199254740991
          or v_component::text::numeric<>pg_catalog.trunc(v_component::text::numeric) then raise exception 'invalid_shadow_relationship'; end if;
      end loop;
    end loop;
    if (select count(*) from pg_catalog.jsonb_array_elements(v_outcome->'relationships'))<>(select count(distinct value) from pg_catalog.jsonb_array_elements(v_outcome->'relationships')) then raise exception 'invalid_shadow_relationship'; end if;
    v_identity:=public.shadow_utf16_order_v1(v_outcome->>'family')||'\x0000'::bytea||public.shadow_utf16_order_v1(v_outcome->>'unitKey');
    if v_prior is not null and v_identity<=v_prior then raise exception 'invalid_shadow_inventory_order'; end if;v_prior:=v_identity;
  end loop;
end $$;
alter function public.validate_shadow_inventory_v1(jsonb,jsonb) owner to postgres;
revoke all on function public.validate_shadow_inventory_v1(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_validate_planned_batch_v1(p_declaration jsonb,p_family text,p_source_binding jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare v_payload jsonb;v_unit jsonb;v_units jsonb;v_pointer jsonb;v_value jsonb;v_component jsonb;
begin
  v_payload:=public.shadow_inventory_envelope_payload_v1(p_declaration->'outputManifestEnvelope');
  if not public.shadow_keys_v1(v_payload,array['producer','producerVersion','binding','units'])
    or v_payload->'producer' is distinct from p_declaration->'producer'->'name' or v_payload->'producerVersion' is distinct from p_declaration->'producer'->'version'
    or v_payload->'binding' is distinct from p_source_binding or pg_catalog.jsonb_typeof(v_payload->'units') is distinct from 'array' then raise exception 'shadow_producer_semantics_unavailable'; end if;
  for v_unit in select value from pg_catalog.jsonb_array_elements(v_payload->'units') loop
    if not public.shadow_keys_v1(v_unit,array['family','key','output']) or pg_catalog.jsonb_typeof(v_unit->'family') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_unit->'key') is distinct from 'string' or pg_catalog.length(v_unit->>'key')=0 then raise exception 'invalid_shadow_planned_output'; end if;
  end loop;
  if (select count(*) from pg_catalog.jsonb_array_elements(v_payload->'units'))<>(select count(distinct pg_catalog.jsonb_build_array(value->'family',value->'key')) from pg_catalog.jsonb_array_elements(v_payload->'units')) then raise exception 'invalid_shadow_planned_output'; end if;
  if p_declaration->'population'->>'tag'<>'known' then
    -- Retain the explicit unavailable/unknown declaration only if there is no
    -- available output to hide. It grants no candidate or evaluation capability.
    if pg_catalog.jsonb_array_length(v_payload->'units')<>0 then raise exception 'shadow_partial_output_cannot_be_unavailable'; end if;
    for v_pointer in select value from pg_catalog.jsonb_array_elements(p_declaration->'population'->'limitation'->'evidence') loop
      perform public.shadow_resolve_batch_pointer_v1(v_pointer,p_declaration->'outputManifestEnvelope');
    end loop;
    return;
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('family',value->'family','key',value->'key') order by public.shadow_utf16_order_v1(value->>'key')),'[]'::jsonb)
    into v_units from pg_catalog.jsonb_array_elements(v_payload->'units') where value->>'family'=p_family;
  if v_units is distinct from p_declaration->'population'->'expectedUnits' then raise exception 'shadow_planned_membership_mismatch'; end if;
  if pg_catalog.jsonb_array_length(p_declaration->'population'->'basis')=0 then raise exception 'shadow_planned_basis_required'; end if;
  for v_pointer in select value from pg_catalog.jsonb_array_elements(p_declaration->'population'->'basis') loop
    if v_pointer->'ref'->>'tag' is distinct from 'retained_payload' or v_pointer->'ref'->'envelopeDigest' is distinct from p_declaration->'outputManifestEnvelope'->'digest'
      or v_pointer->'ref'->>'representation' is distinct from 'producer_json'
      or (v_pointer->'ref'->>'byteLength')::bigint<>pg_catalog.octet_length(pg_catalog.convert_to(p_declaration->'outputManifestEnvelope'->>'canonicalPayload','UTF8')) then raise exception 'shadow_planned_basis_unavailable'; end if;
    v_value:=v_payload;
    for v_component in select value from pg_catalog.jsonb_array_elements(v_pointer->'path') loop
      if pg_catalog.jsonb_typeof(v_component)='number' and pg_catalog.jsonb_typeof(v_value)='array' then v_value:=v_value->(v_component::text::integer);
      elsif pg_catalog.jsonb_typeof(v_component)='string' and pg_catalog.jsonb_typeof(v_value)='object' then v_value:=v_value->(v_component#>>'{}');
      else raise exception 'shadow_planned_basis_unavailable'; end if;
      if v_value is null then raise exception 'shadow_planned_basis_unavailable'; end if;
    end loop;
  end loop;
end $$;
alter function public.shadow_validate_planned_batch_v1(jsonb,text,jsonb) owner to postgres;
revoke all on function public.shadow_validate_planned_batch_v1(jsonb,text,jsonb) from public,anon,authenticated,service_role;


-- The first control declaration is the already-admitted claim checkpoint.
-- Later replay is intentionally not compared with this snapshot because
-- ordinary heartbeats, progress and inventory writes advance the checkpoint.
create or replace function public.shadow_initial_control_capture_v1(p_member public.document_index_generations,p_declaration jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare v_batch jsonb;v_unit jsonb;v_capture jsonb;
begin
  v_batch:=public.shadow_inventory_envelope_payload_v1(p_declaration->'outputManifestEnvelope');
  if p_declaration->'artifactGenerationId'<>'null'::jsonb or p_declaration->'producer'->>'name' is distinct from 'local-worker'
    or v_batch->'binding' is distinct from public.shadow_projection_binding_v1(p_member,null)
    or pg_catalog.jsonb_array_length(v_batch->'units')<>1 then raise exception 'shadow_initial_control_identity'; end if;
  v_unit:=v_batch->'units'->0;
  if v_unit->>'family'<>'attempt_control' or v_unit->>'key' is distinct from p_member.job_id::text then raise exception 'shadow_initial_control_identity'; end if;
  v_capture:=public.shadow_node_payload_v1(v_unit->'output','u04-retained-evidence-v1');
  if not public.shadow_keys_v1(v_capture,array['input','ownUndefinedPaths'])
    or v_capture->'ownUndefinedPaths'<>'[]'::jsonb
    or v_capture->'input' is distinct from p_member.control_snapshot then raise exception 'shadow_initial_control_changed'; end if;
end $$;
alter function public.shadow_initial_control_capture_v1(public.document_index_generations,jsonb) owner to postgres;
revoke all on function public.shadow_initial_control_capture_v1(public.document_index_generations,jsonb) from public,anon,authenticated,service_role;

create or replace function public.write_shadow_generation_inventory(p_fence jsonb,p_generation uuid,p_declarations jsonb,p_dispositions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.document_index_generations%rowtype;v_manifest jsonb;v_profile jsonb;v_group jsonb;v_family jsonb;v_slot jsonb;v_declaration jsonb;
  v_view jsonb;v_unit jsonb;v_existing public.document_generation_inventory%rowtype;v_outcome jsonb;v_expected jsonb;v_supplied jsonb;v_f integer;v_g integer;
  v_changed boolean:=false;v_slot_changed boolean;v_required boolean;v_d uuid;v_count bigint;v_bytes bigint;v_digest text;v_frozen jsonb;
begin
  perform public.validate_shadow_inventory_v1(p_declarations,p_dispositions);
  v_member:=public.shadow_assert_attempt_v1(p_fence,p_generation,(p_declarations->>'expectedControlRevision')::bigint);
  v_manifest:=v_member.inventory_manifest;
  v_profile:=public.shadow_profile_capture_v1((v_member.original_origin_envelope->>'canonicalPayload')::jsonb->'executionProfileEnvelope');
  v_count:=pg_catalog.jsonb_array_length(p_declarations->'groups')+pg_catalog.jsonb_array_length(p_declarations->'units')+pg_catalog.jsonb_array_length(p_dispositions);
  v_bytes:=pg_catalog.octet_length(pg_catalog.convert_to(pg_catalog.jsonb_build_object('groups',p_declarations->'groups','units',p_declarations->'units','dispositions',p_dispositions)::text,'UTF8'));
  if v_count>least(2000,(v_profile->'limits'->>'maxAppendRows')::bigint) or v_bytes>least(16777216,(v_profile->'limits'->>'maxAppendBytes')::bigint) then raise exception 'shadow_append_too_large'; end if;
  v_expected:='[]'::jsonb;
  for v_group in select value from pg_catalog.jsonb_array_elements(p_declarations->'groups') loop
    select (ord-1)::integer,value into v_f,v_family from pg_catalog.jsonb_array_elements(v_manifest->'families') with ordinality a(value,ord) where value->'family'=v_group->'family';
    if not found then raise exception 'shadow_unknown_family'; end if;
    select (ord-1)::integer,value into v_g,v_slot from pg_catalog.jsonb_array_elements(v_family->'groups') with ordinality a(value,ord) where value->'groupKey'=v_group->'groupKey';
    if not found then raise exception 'shadow_unknown_producer_slot'; end if;
    v_declaration:=v_group->'declaration';
    perform public.shadow_validate_producer_declaration_v1(v_declaration,v_group->>'family',v_group->>'groupKey',v_member.first_lease_token,p_generation,v_member.baseline_generation_id);
    v_d:=(v_declaration->>'artifactGenerationId')::uuid;
    perform public.shadow_reserve_producer_d_v1(v_member,v_declaration);
    v_view:=pg_catalog.jsonb_build_object('tag','candidate','source',v_member.source_binding,'candidateGenerationId',p_generation,'jobId',v_member.job_id,'firstLeaseToken',v_member.first_lease_token,'artifactGenerationId',v_d);
    perform public.shadow_validate_planned_batch_v1(v_declaration,v_group->>'family',v_view);
    if v_d is not null and (v_declaration->'producer'->>'name' is distinct from 'local-worker' or exists(select 1 from public.document_index_generations g
      cross join lateral pg_catalog.jsonb_array_elements(g.inventory_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
      where s->'declaration'->>'artifactGenerationId'=v_d::text and (g.document_id<>v_member.document_id or g.index_generation_id<>p_generation))
      or exists(select 1 from public.ingestion_job_stages st join public.document_index_generations g
        on g.job_id=st.job_id and g.document_id=st.document_id
        where public.shadow_failed_artifact_generation_v1(st,g,1)=v_d))
      then raise exception 'shadow_producer_generation_owned'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
      where s->>'groupKey'='deep_memory' and s->>'state'='declared' and s->'declaration'->'artifactGenerationId'<>'null'::jsonb
        and v_d is not null and s->'declaration'->>'artifactGenerationId'<>v_d::text) then raise exception 'shadow_producer_generation_changed'; end if;
    if v_d is not null and exists(select 1 from pg_catalog.jsonb_array_elements(v_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
      where s->>'state'='declared' and s->'declaration'->>'artifactGenerationId'=v_d::text
      and (s->'declaration'->'producer' is distinct from v_declaration->'producer' or s->'declaration'->'outputManifestEnvelope' is distinct from v_declaration->'outputManifestEnvelope')) then raise exception 'shadow_shared_batch_changed'; end if;
    v_slot_changed:=v_slot->>'state'='pending';
    if not v_slot_changed and v_slot->'declaration' is distinct from v_declaration then raise exception 'shadow_declaration_changed'; end if;
    if v_slot_changed then
      if v_member.expected_inventory_digest is not null then raise exception 'shadow_inventory_already_frozen'; end if;
      if v_group->>'family'='attempt_control' then perform public.shadow_initial_control_capture_v1(v_member,v_declaration); end if;
      v_manifest:=pg_catalog.jsonb_set(v_manifest,array['families',v_f::text,'groups',v_g::text],pg_catalog.jsonb_build_object('groupKey',v_group->'groupKey','state','declared','declaration',v_declaration),false);
      v_changed:=true;
    end if;
    if v_declaration->'population'->>'tag'='known' then
      for v_unit in select value from pg_catalog.jsonb_array_elements(v_declaration->'population'->'expectedUnits') loop
        v_expected:=v_expected||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('family',v_unit->'family','key',v_unit->'key'));
      end loop;
    end if;
  end loop;
  select coalesce(pg_catalog.jsonb_agg(value order by public.shadow_utf16_order_v1(value->>'family'),public.shadow_utf16_order_v1(value->>'key')),'[]'::jsonb) into v_expected from pg_catalog.jsonb_array_elements(v_expected);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('family',value->'family','key',value->'unitKey') order by ord),'[]'::jsonb)
    into v_supplied from pg_catalog.jsonb_array_elements(p_declarations->'units') with ordinality a(value,ord);
  if v_expected is distinct from v_supplied then raise exception 'shadow_exact_planned_units_required'; end if;
  for v_unit in select value from pg_catalog.jsonb_array_elements(p_declarations->'units') loop
    select s->'declaration',s->>'groupKey' into v_declaration,v_digest from pg_catalog.jsonb_array_elements(v_manifest->'families') f
      cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where f->'family'=v_unit->'family' and s->>'state'='declared'
        and s->'declaration'->'population'->>'tag'='known' and s->'declaration'->'population'->'expectedUnits' @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('family',v_unit->'family','key',v_unit->'unitKey'));
    if not found or (select count(*) from pg_catalog.jsonb_array_elements(v_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
      where f->'family'=v_unit->'family' and s->>'state'='declared' and s->'declaration'->'population'->'expectedUnits' @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('family',v_unit->'family','key',v_unit->'unitKey')))<>1 then raise exception 'shadow_ambiguous_unit_producer'; end if;
    v_view:=pg_catalog.jsonb_build_object('tag','candidate','source',v_member.source_binding,'candidateGenerationId',p_generation,'jobId',v_member.job_id,'firstLeaseToken',v_member.first_lease_token,'artifactGenerationId',v_declaration->'artifactGenerationId');
    v_required:=v_unit->>'family' in ('pages','chunks','images','table_facts','embedding_fields','quality','document_metadata','private_objects','attempt_control','cache_inputs','repair_audit_inputs') or (v_unit->>'family'='index_units' and v_digest='worker_core');
    if v_unit->'sourceBinding' is distinct from v_view or v_unit->'producer' is distinct from v_declaration->'producer'->'name'
      or v_unit->'expected' is distinct from 'true'::jsonb or v_unit->'required' is distinct from pg_catalog.to_jsonb(v_required) then raise exception 'shadow_unit_identity_requiredness'; end if;
    if v_unit->>'family' in ('quality','document_metadata') and v_unit->>'unitKey'<>'singleton' then raise exception 'shadow_singleton_identity'; end if;
    select * into v_existing from public.document_generation_inventory where document_id=v_member.document_id and index_generation_id=p_generation and family=v_unit->>'family' and unit_key=v_unit->>'unitKey' for update;
    if found then
      if v_existing.source_binding is distinct from v_view or v_existing.expected is distinct from true or v_existing.required is distinct from v_required
        or v_existing.producer is distinct from v_unit->>'producer' or v_existing.lease_token is distinct from v_member.first_lease_token then raise exception 'shadow_unit_declaration_changed'; end if;
    else v_changed:=true; end if;
  end loop;
  -- Preflight every final disposition before the first declaration/row effect.
  for v_outcome in select value from pg_catalog.jsonb_array_elements(p_dispositions) loop perform public.shadow_validate_final_disposition_v1(v_member,v_manifest,v_outcome); end loop;
  -- Unit rows precede the single manifest/digest UPDATE, so the last-slot CHECK
  -- never observes a complete manifest with a still-null expected digest.
  for v_unit in select value from pg_catalog.jsonb_array_elements(p_declarations->'units') loop
    insert into public.document_generation_inventory(document_id,index_generation_id,family,unit_key,lease_token,expected,required,disposition,limitations,producer,artifact_generation_id,source_binding,relationships)
      values(v_member.document_id,p_generation,v_unit->>'family',v_unit->>'unitKey',v_member.first_lease_token,(v_unit->>'expected')::boolean,(v_unit->>'required')::boolean,'pending','[]'::jsonb,v_unit->>'producer',(v_unit->'sourceBinding'->>'artifactGenerationId')::uuid,v_unit->'sourceBinding','[]'::jsonb)
      on conflict(document_id,index_generation_id,family,unit_key) do nothing;
  end loop;
  for v_outcome in select value from pg_catalog.jsonb_array_elements(p_dispositions) loop
    if public.shadow_finalize_inventory_unit_v1(v_member,v_outcome) then v_changed:=true; end if;
  end loop;
  if not pg_catalog.jsonb_path_exists(v_manifest,'$.families[*].groups[*] ? (@.state == "pending")') and v_member.expected_inventory_digest is null then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('family',family,'unitKey',unit_key,'expected',expected,'required',required,'producer',producer,'sourceBinding',source_binding)
      order by public.shadow_utf16_order_v1(family),public.shadow_utf16_order_v1(unit_key)),'[]'::jsonb) into v_frozen from public.document_generation_inventory where document_id=v_member.document_id and index_generation_id=p_generation;
    v_digest:=public.shadow_pg_bundle_v1(pg_catalog.jsonb_build_object('manifest',v_manifest,'declarations',v_frozen),'inventory')->>'digest';
    v_changed:=true;
  end if;
  if v_manifest is distinct from v_member.inventory_manifest or (v_member.expected_inventory_digest is null and v_digest like 'sha256:%') then
    update public.document_index_generations set inventory_manifest=v_manifest,expected_inventory_digest=case when v_digest like 'sha256:%' then v_digest else expected_inventory_digest end
      where document_id=v_member.document_id and index_generation_id=p_generation;
  end if;
  if v_changed then perform public.shadow_checkpoint_advance_v1(v_member.job_id); end if;
  return pg_catalog.jsonb_build_object('ok',true,'kind',case when v_changed then 'inventory_written' else 'unchanged' end,'control_revision',v_member.control_revision+case when v_changed then 1 else 0 end,'terminal_acceptance','unavailable');
exception when others then raise exception 'invalid_shadow_inventory_write' using errcode='22023';
end $$;
alter function public.write_shadow_generation_inventory(jsonb,uuid,jsonb,jsonb) owner to postgres;
revoke all on function public.write_shadow_generation_inventory(jsonb,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_inventory_outcome_v1(p_unit public.document_generation_inventory)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('family',p_unit.family,'unitKey',p_unit.unit_key,'disposition',p_unit.disposition,'reasonCode',p_unit.reason_code,
    'limitations',p_unit.limitations,'artifactRef',p_unit.artifact_ref,'contentDigest',p_unit.content_digest,'relationships',p_unit.relationships,
    'retainedEvidenceText',p_unit.retained_evidence_text,'retainedNativePayload',p_unit.retained_native_payload,
    'representationVersion',p_unit.representation_version,'transformVersion',p_unit.transform_version)
$$;
alter function public.shadow_inventory_outcome_v1(public.document_generation_inventory) owner to postgres;
revoke all on function public.shadow_inventory_outcome_v1(public.document_generation_inventory) from public,anon,authenticated,service_role;

create or replace function public.shadow_native_rpc_input_v1(p_value jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_path jsonb;v_part jsonb;v_parent jsonb;v_seen jsonb:='[]'::jsonb;v_index integer;v_length integer;v_key text;
begin
  if not public.shadow_keys_v1(p_value,array['input','ownUndefinedPaths']) or pg_catalog.jsonb_typeof(p_value->'ownUndefinedPaths') is distinct from 'array'
    then raise exception 'shadow_native_presence_shape'; end if;
  for v_path in select value from pg_catalog.jsonb_array_elements(p_value->'ownUndefinedPaths') loop
    if pg_catalog.jsonb_typeof(v_path) is distinct from 'array' or exists(select 1 from pg_catalog.jsonb_array_elements(v_seen) x where x=v_path)
      then raise exception 'shadow_native_presence_path'; end if;
    v_seen:=v_seen||pg_catalog.jsonb_build_array(v_path);v_length:=pg_catalog.jsonb_array_length(v_path);v_parent:=p_value->'input';
    if v_length=0 then
      if v_parent is distinct from 'null'::jsonb or pg_catalog.jsonb_array_length(p_value->'ownUndefinedPaths')<>1 then raise exception 'shadow_native_presence_root'; end if;
      continue;
    end if;
    for v_index in 0..v_length-1 loop
      v_part:=v_path->v_index;v_key:=v_part#>>'{}';
      if pg_catalog.jsonb_typeof(v_parent)='array' then
        if pg_catalog.jsonb_typeof(v_part)<>'number' or v_key!~'^(0|[1-9][0-9]*)$' or v_key::numeric>=pg_catalog.jsonb_array_length(v_parent)
          then raise exception 'shadow_native_presence_array'; end if;
        if v_index=v_length-1 and v_parent->(v_key::integer) is distinct from 'null'::jsonb then raise exception 'shadow_native_presence_array_value'; end if;
        v_parent:=v_parent->(v_key::integer);
      elsif pg_catalog.jsonb_typeof(v_parent)='object' then
        if pg_catalog.jsonb_typeof(v_part)<>'string' or (v_index=v_length-1 and v_parent?v_key) or (v_index<v_length-1 and not v_parent?v_key)
          then raise exception 'shadow_native_presence_object'; end if;
        v_parent:=v_parent->v_key;
      else raise exception 'shadow_native_presence_parent'; end if;
    end loop;
  end loop;
  -- Native own-undefined has no PostgreSQL value. The complete path bytes remain
  -- immutable; the Node receipt consumer reconstructs and recaptures them exactly.
  return p_value->'input';
end $$;
alter function public.shadow_native_rpc_input_v1(jsonb) owner to postgres;
revoke all on function public.shadow_native_rpc_input_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_core_row_matches_v1(p_member public.document_index_generations,p_family text,p_output jsonb,p_row jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare v_input jsonb;v_value jsonb;v_expected jsonb;v_columns text[];v_generated text[]:=array['created_at'];v_all text[];
begin
  v_input:=public.shadow_native_rpc_input_v1(p_output);
  if pg_catalog.jsonb_typeof(v_input) is distinct from 'object' or v_input->'id' is distinct from p_row->'id'
    or v_input->>'document_id' is distinct from p_member.document_id::text
    or pg_catalog.jsonb_typeof(coalesce(v_input->'metadata','{}'::jsonb)) is distinct from 'object' then return false; end if;
  v_columns:=case p_family
    when 'chunks' then array['id','document_id','page_number','chunk_index','section_heading','section_path','heading_level','parent_heading','anchor_id','content','retrieval_synopsis','content_hash','index_generation_id','token_estimate','image_ids','metadata','embedding']
    when 'images' then array['id','document_id','page_number','storage_path','mime_type','caption','bbox','image_type','searchable','clinical_relevance_score','skip_reason','source_kind','width','height','image_hash','perceptual_hash','labels','index_generation_id','caption_confidence','clinical_priority_score','crop_completeness','image_quality_score','ocr_text_density','structured_extraction_confidence','visual_duplicate_group','metadata']
    when 'table_facts' then array['id','owner_id','document_id','source_chunk_id','source_image_id','page_number','table_title','row_label','clinical_parameter','threshold_value','action','normalized_terms','index_generation_id','metadata']
    when 'embedding_fields' then array['id','owner_id','document_id','source_chunk_id','field_type','content','content_hash','embedding','index_generation_id','metadata']
    when 'index_units' then array['id','owner_id','document_id','unit_type','source_chunk_id','source_image_id','page_start','page_end','heading_path','title','content','normalized_terms','source_span','quality_score','extraction_mode','index_generation_id','producer','artifact_generation_id','embedding','metadata']
    else null end;
  if v_columns is null or exists(select 1 from pg_catalog.jsonb_object_keys(v_input) k where not k=any(v_columns)) then return false; end if;
  if p_family<>'images' then v_generated:=v_generated||array['search_tsv']; end if;
  if p_family='index_units' then v_generated:=v_generated||array['updated_at']; end if;
  v_all:=v_columns||v_generated;
  if not public.shadow_keys_v1(p_row,v_all) or public.shadow_audit_timestamp_v1(p_row->'created_at') is null
    or (p_family='index_units' and public.shadow_audit_timestamp_v1(p_row->'updated_at') is null) then return false; end if;
  v_value:=pg_catalog.jsonb_build_object('metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,
    'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,
    'clinical_relevance_score',0,'source_kind','embedded','quality_score',0.7,'extraction_mode','deterministic')||v_input||
    pg_catalog.jsonb_build_object('index_generation_id',p_member.index_generation_id,'metadata',coalesce(v_input->'metadata','{}'::jsonb)||
      pg_catalog.jsonb_build_object('index_generation_id',p_member.index_generation_id,'ingestion_lease_token',p_member.first_lease_token,'ingestion_job_kind','node','ingestion_job_id',p_member.job_id));
  if p_family in ('table_facts','embedding_fields','index_units') then v_value:=v_value||pg_catalog.jsonb_build_object('owner_id',p_member.owner_id); end if;
  if p_family='index_units' then v_value:=v_value||pg_catalog.jsonb_build_object('producer','local-worker','artifact_generation_id',null); end if;
  if p_family in ('chunks','embedding_fields','index_units') then v_value:=v_value||pg_catalog.jsonb_build_object('embedding',(v_value->'embedding')::text); end if;
  -- Use the same fixed composite casts as the actual writer, including vector
  -- float storage. No guessed id, time, TSV or Unicode normalization is supplied.
  case p_family
    when 'chunks' then v_expected:=pg_catalog.to_jsonb(pg_catalog.jsonb_populate_record(null::public.document_chunks,v_value));
    when 'images' then v_expected:=pg_catalog.to_jsonb(pg_catalog.jsonb_populate_record(null::public.document_images,v_value));
    when 'table_facts' then v_expected:=pg_catalog.to_jsonb(pg_catalog.jsonb_populate_record(null::public.document_table_facts,v_value));
    when 'embedding_fields' then v_expected:=pg_catalog.to_jsonb(pg_catalog.jsonb_populate_record(null::public.document_embedding_fields,v_value));
    when 'index_units' then v_expected:=pg_catalog.to_jsonb(pg_catalog.jsonb_populate_record(null::public.document_index_units,v_value));
  end case;
  if p_family in ('chunks','embedding_fields','index_units') then
    v_expected:=v_expected||pg_catalog.jsonb_build_object('embedding',case when v_value->>'embedding' is null then null else ((v_value->>'embedding')::extensions.vector)::text end);
  end if;
  select pg_catalog.jsonb_object_agg(k,v_expected->k) into v_expected from pg_catalog.unnest(v_columns) k;
  if v_expected=p_row-v_generated then return true; end if;
  if p_family='chunks' then
    select v_expected||pg_catalog.jsonb_object_agg(k,p_row->k) into v_expected from pg_catalog.unnest(v_generated) k;
    return public.shadow_candidate_anchor_update_v1(p_member,v_expected,p_row);
  end if;
  return false;
exception when others then return false;
end $$;
alter function public.shadow_core_row_matches_v1(public.document_index_generations,text,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_core_row_matches_v1(public.document_index_generations,text,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Resolve only actual producer-owned projection slots. The fixed component
-- writers already validate and immutably bind the complete after-images; the
-- declaration-based digest reconstruction below reuses that exact proof.
create or replace function public.shadow_projection_disposition_v1(p_member public.document_index_generations,p_declaration jsonb,p_outcome jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row public.document_generation_projections%rowtype;v_ref jsonb;v_family text;v_slot text;v_batch jsonb;v_planned jsonb;v_original jsonb;
  v_payload jsonb;v_component jsonb;v_component_digest text;v_digest text;v_count bigint;v_ordinal bigint;
begin
  v_ref:=p_outcome->'artifactRef';v_family:=p_outcome->>'family';v_slot:=v_ref->>'slot';
  if v_ref->>'tag' is distinct from 'candidate_projection'
    or v_slot is distinct from (case v_family when 'summary' then 'summary' when 'generated_labels' then 'generated_labels'
      when 'quality' then 'quality' when 'document_metadata' then 'worker_metadata' when 'producer_aliases' then 'producer_aliases' end)
    then raise exception 'shadow_projection_reference_family'; end if;
  select * into v_row from public.document_generation_projections where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  if not found or v_row.owner_id is distinct from p_member.owner_id or v_row.lease_token is distinct from p_member.first_lease_token
    or v_row.sealed_at is not null then raise exception 'shadow_projection_reference_identity'; end if;
  v_batch:=public.shadow_inventory_envelope_payload_v1(p_declaration->'outputManifestEnvelope');
  select count(*),pg_catalog.jsonb_agg(value->'output')->0 into v_count,v_planned from pg_catalog.jsonb_array_elements(v_batch->'units')
    where value->>'family'=v_family and value->>'key'=p_outcome->>'unitKey';
  if v_count<>1 or pg_catalog.jsonb_typeof(p_outcome->'retainedNativePayload') is distinct from 'string'
    then raise exception 'shadow_projection_original_required'; end if;
  perform public.shadow_strict_original_json_v1((p_outcome->>'retainedNativePayload')::json);
  v_original:=public.shadow_inventory_envelope_payload_v1((p_outcome->>'retainedNativePayload')::jsonb);
  if v_original is distinct from v_planned then raise exception 'shadow_projection_original_changed'; end if;
  if v_family in ('generated_labels','producer_aliases') then
    if pg_catalog.jsonb_typeof(v_ref->'itemId') is distinct from 'string' then raise exception 'shadow_projection_item_required'; end if;
    select count(*),min(ord),pg_catalog.jsonb_agg(value)->0 into v_count,v_ordinal,v_payload
      from pg_catalog.jsonb_array_elements(case v_family when 'generated_labels' then v_row.generated_labels else v_row.producer_aliases end)
        with ordinality a(value,ord) where value->'id'=v_ref->'itemId';
    if v_count<>1 then raise exception 'shadow_projection_item_unavailable'; end if;
    if (v_family='generated_labels' and p_outcome->>'unitKey' is distinct from public.shadow_node_value_text_v1(
          pg_catalog.jsonb_build_object('label',v_payload->'label','label_type',v_payload->'label_type')))
      or (v_family='producer_aliases' and p_outcome->>'unitKey' is distinct from 'deep:'||(v_ordinal-1)::text)
      then raise exception 'shadow_projection_item_original_mismatch'; end if;
  else
    if v_ref->'itemId' is distinct from 'null'::jsonb or p_outcome->>'unitKey' is distinct from 'singleton'
      then raise exception 'shadow_projection_singleton_required'; end if;
    v_payload:=case v_family when 'summary' then v_row.summary when 'quality' then v_row.quality else v_row.worker_metadata end;
  end if;
  if v_payload is null or v_payload='null'::jsonb then raise exception 'shadow_projection_payload_unavailable'; end if;
  if v_family in ('summary','generated_labels') then
    v_component_digest:=v_row.summary_digest;
    v_component:=pg_catalog.jsonb_build_object('kind','u04-summary-projection-v1','binding',public.shadow_projection_binding_v1(p_member),
      'outputManifestEnvelope',p_declaration->'outputManifestEnvelope','summary',v_row.summary,'generated_labels',v_row.generated_labels,
      'summary_projection_complete',v_row.summary_projection_complete,'enrichment_metadata',v_row.enrichment_metadata);
  elsif v_family='quality' then
    v_component_digest:=v_row.quality_digest;
    v_component:=pg_catalog.jsonb_build_object('kind','u04-quality-projection-v1','binding',public.shadow_projection_binding_v1(p_member),
      'outputManifestEnvelope',p_declaration->'outputManifestEnvelope','quality',v_row.quality);
  elsif v_family='document_metadata' then
    v_component_digest:=v_row.worker_state_digest;
    v_component:=pg_catalog.jsonb_build_object('kind','u04-worker-projection-v1','binding',public.shadow_projection_binding_v1(p_member),
      'outputManifestEnvelope',p_declaration->'outputManifestEnvelope','worker_metadata',v_row.worker_metadata,'document_counts',v_row.document_counts);
  else
    v_component_digest:=v_row.deep_memory_digest;
    v_component:=pg_catalog.jsonb_build_object('kind','u04-deep-projection-v1','binding',public.shadow_projection_binding_v1(p_member,v_row.deep_memory_artifact_generation_id),
      'outputManifestEnvelope',p_declaration->'outputManifestEnvelope','deep_memory_receipt',v_row.deep_memory_receipt,
      'deep_memory_metadata',v_row.deep_memory_metadata,'producer_aliases',v_row.producer_aliases);
  end if;
  if v_component_digest is null or public.shadow_pg_bundle_v1(v_component,'projection')->>'digest' is distinct from v_component_digest
    then raise exception 'shadow_projection_component_changed'; end if;
  v_digest:=public.shadow_pg_bundle_v1(v_payload,'projection')->>'digest';
  if v_ref->>'payloadDigest' is distinct from v_digest then raise exception 'shadow_projection_payload_digest'; end if;
  return pg_catalog.jsonb_build_object('payload',v_payload,'digest',v_digest);
end $$;
alter function public.shadow_projection_disposition_v1(public.document_index_generations,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_projection_disposition_v1(public.document_index_generations,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Reconstruct the exact captureShadowProducerInputV1 transport. JSON object
-- keys carrying native undefined are absent; undefined array slots are null.
create or replace function public.shadow_producer_capture_v1(p_envelope jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_capture jsonb;v_path jsonb;v_component jsonb;v_current jsonb;v_next jsonb;v_ord bigint;v_length bigint;v_index bigint;v_sort text;v_previous_sort text;
begin
  v_capture:=public.shadow_node_payload_v1(p_envelope,'u04-retained-evidence-v1');
  if not public.shadow_keys_v1(v_capture,array['input','ownUndefinedPaths'])
    or pg_catalog.jsonb_typeof(v_capture->'ownUndefinedPaths') is distinct from 'array'
    or (select count(*) from pg_catalog.jsonb_array_elements(v_capture->'ownUndefinedPaths'))
      <>(select count(distinct value) from pg_catalog.jsonb_array_elements(v_capture->'ownUndefinedPaths'))
    then raise exception 'invalid_shadow_producer_capture'; end if;
  for v_path in select value from pg_catalog.jsonb_array_elements(v_capture->'ownUndefinedPaths') loop
    if pg_catalog.jsonb_typeof(v_path) is distinct from 'array' or pg_catalog.jsonb_array_length(v_path)=0
      then raise exception 'invalid_shadow_producer_capture'; end if;
    select pg_catalog.string_agg(case pg_catalog.jsonb_typeof(value)
      when 'string' then 's:'||pg_catalog.encode(pg_catalog.convert_to(value#>>'{}','UTF8'),'hex')
      when 'number' then 'n:'||pg_catalog.lpad(value::text,16,'0') else 'x:'||value::text end,'/' order by ord)
      into v_sort from pg_catalog.jsonb_array_elements(v_path) with ordinality a(value,ord);
    if v_previous_sort is not null and (v_sort collate "C")<=(v_previous_sort collate "C") then raise exception 'invalid_shadow_producer_capture'; end if;
    v_previous_sort:=v_sort;
    v_current:=v_capture->'input';v_length:=pg_catalog.jsonb_array_length(v_path);
    for v_component,v_ord in select value,ord from pg_catalog.jsonb_array_elements(v_path) with ordinality a(value,ord) loop
      if v_ord=v_length then
        if pg_catalog.jsonb_typeof(v_component)='string' and pg_catalog.jsonb_typeof(v_current)='object' then
          if v_current ? (v_component#>>'{}') then raise exception 'invalid_shadow_producer_capture'; end if;
        elsif pg_catalog.jsonb_typeof(v_component)='number' and pg_catalog.jsonb_typeof(v_current)='array' then
          if v_component::text::numeric<>pg_catalog.trunc(v_component::text::numeric) or v_component::text::numeric not between 0 and 2147483647
            then raise exception 'invalid_shadow_producer_capture'; end if;
          v_index:=v_component::text::bigint;
          if v_index>=pg_catalog.jsonb_array_length(v_current) or v_current->(v_index::integer) is distinct from 'null'::jsonb
            then raise exception 'invalid_shadow_producer_capture'; end if;
        else raise exception 'invalid_shadow_producer_capture'; end if;
      elsif pg_catalog.jsonb_typeof(v_component)='string' and pg_catalog.jsonb_typeof(v_current)='object' then
        v_next:=v_current->(v_component#>>'{}');if v_next is null then raise exception 'invalid_shadow_producer_capture'; end if;v_current:=v_next;
      elsif pg_catalog.jsonb_typeof(v_component)='number' and pg_catalog.jsonb_typeof(v_current)='array' then
        if v_component::text::numeric<>pg_catalog.trunc(v_component::text::numeric) or v_component::text::numeric not between 0 and 2147483647
          then raise exception 'invalid_shadow_producer_capture'; end if;
        v_index:=v_component::text::bigint;if v_index>=pg_catalog.jsonb_array_length(v_current) then raise exception 'invalid_shadow_producer_capture'; end if;
        v_current:=v_current->(v_index::integer);
      else raise exception 'invalid_shadow_producer_capture'; end if;
    end loop;
  end loop;
  return v_capture;
end $$;
alter function public.shadow_producer_capture_v1(jsonb) owner to postgres;
revoke all on function public.shadow_producer_capture_v1(jsonb) from public,anon,authenticated,service_role;


-- Validate the original claimed checkpoint against the later pre-seal owner.
-- The initial declaration is separately bound before its first manifest write;
-- this comparison admits only the normal processing-stage evolution.
create or replace function public.shadow_attempt_control_payload_v1(p_member public.document_index_generations,p_declaration jsonb,p_output jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_batch jsonb;v_capture jsonb;v_checkpoint jsonb;v_current jsonb;v_initial_job jsonb;v_current_job jsonb;v_stage jsonb;
  v_duration numeric;
begin
  v_batch:=public.shadow_inventory_envelope_payload_v1(p_declaration->'outputManifestEnvelope');
  if p_declaration->'artifactGenerationId'<>'null'::jsonb or p_declaration->'producer'->>'name' is distinct from 'local-worker'
    or v_batch->'binding' is distinct from public.shadow_projection_binding_v1(p_member,null)
    or pg_catalog.jsonb_array_length(v_batch->'units')<>1
    or v_batch->'units'->0->>'family'<>'attempt_control'
    or v_batch->'units'->0->>'key' is distinct from p_member.job_id::text
    or v_batch->'units'->0->'output' is distinct from p_output then raise exception 'shadow_control_owner_identity'; end if;
  v_capture:=public.shadow_producer_capture_v1(p_output);v_checkpoint:=v_capture->'input';
  if v_capture->'ownUndefinedPaths'<>'[]'::jsonb
    or not public.shadow_keys_v1(v_checkpoint,array['controlRevision','ownNodeJobs','ownStages'])
    or pg_catalog.jsonb_typeof(v_checkpoint->'controlRevision')<>'number'
    or (v_checkpoint->>'controlRevision')::numeric<>pg_catalog.trunc((v_checkpoint->>'controlRevision')::numeric)
    or (v_checkpoint->>'controlRevision')::numeric not between 1 and 9007199254740991
    or (v_checkpoint->>'controlRevision')::numeric>p_member.control_revision
    or pg_catalog.jsonb_typeof(v_checkpoint->'ownNodeJobs')<>'array'
    or pg_catalog.jsonb_array_length(v_checkpoint->'ownNodeJobs')<>1
    or v_checkpoint->'ownStages'<>'[]'::jsonb then raise exception 'shadow_control_checkpoint_invalid'; end if;
  v_current:=p_member.control_snapshot;
  if v_current is distinct from public.shadow_control_snapshot_v1(p_member.job_id,p_member.control_revision)
    or pg_catalog.jsonb_array_length(v_current->'ownNodeJobs')<>1 then raise exception 'shadow_control_current_invalid'; end if;
  v_initial_job:=v_checkpoint->'ownNodeJobs'->0;v_current_job:=v_current->'ownNodeJobs'->0;
  v_duration:=(v_initial_job->>'lease_duration_seconds')::numeric;
  if v_initial_job->>'id' is distinct from p_member.job_id::text
    or v_initial_job->>'document_id' is distinct from p_member.document_id::text
    or v_initial_job->>'status'<>'processing' or v_current_job->>'status'<>'processing'
    or v_initial_job->'batch_id'<>'null'::jsonb or v_initial_job->>'operation'<>'shadow_reindex'
    or v_initial_job->'attempt_count'<>'1'::jsonb or v_initial_job->'max_attempts'<>'1'::jsonb
    or v_initial_job->>'requested_generation_id' is distinct from p_member.index_generation_id::text
    or v_initial_job->>'shadow_plan_digest' is distinct from v_current_job->>'shadow_plan_digest'
    or v_initial_job->>'lease_token' is distinct from p_member.first_lease_token::text
    or v_initial_job->'lease_expected_generation_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.baseline_generation_id),'null'::jsonb)
    or v_initial_job->>'lease_write_generation_id' is distinct from p_member.index_generation_id::text
    or v_initial_job->>'lease_authority_digest' is distinct from p_member.authority_digest
    or pg_catalog.jsonb_typeof(v_initial_job->'locked_by')<>'string' or pg_catalog.length(v_initial_job->>'locked_by')=0
    or v_initial_job->'locked_by' is distinct from v_current_job->'locked_by'
    or v_duration<>pg_catalog.trunc(v_duration) or v_duration not between 60 and 86400
    or v_initial_job->'lease_duration_seconds' is distinct from v_current_job->'lease_duration_seconds'
    or (v_initial_job-array['stage','progress','locked_at','lease_expires_at','updated_at'])
      is distinct from (v_current_job-array['stage','progress','locked_at','lease_expires_at','updated_at'])
    then raise exception 'shadow_control_owner_changed'; end if;
  perform public.shadow_audit_timestamp_v1(v_initial_job->'locked_at');
  perform public.shadow_audit_timestamp_v1(v_initial_job->'lease_expires_at');
  for v_stage in select value from pg_catalog.jsonb_array_elements(v_current->'ownStages') loop
    if v_stage->>'job_id' is distinct from p_member.job_id::text
      or v_stage->>'document_id' is distinct from p_member.document_id::text
      or v_stage->>'job_kind'<>'node'
      or v_stage->>'lease_token' is distinct from p_member.first_lease_token::text
      or v_stage->'index_generation_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.baseline_generation_id),'null'::jsonb)
      then raise exception 'shadow_control_stage_scope'; end if;
  end loop;
  return v_capture;
exception when others then raise exception 'invalid_shadow_attempt_control' using errcode='22023';
end $$;
alter function public.shadow_attempt_control_payload_v1(public.document_index_generations,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_attempt_control_payload_v1(public.document_index_generations,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_repair_audit_payload_v1(p_member public.document_index_generations,p_declaration jsonb,p_output jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_batch jsonb;v_capture jsonb;v_native jsonb;v_input jsonb;v_issues jsonb;v_decision jsonb;v_issue jsonb;v_path jsonb;
  v_projection public.document_generation_projections%rowtype;v_metadata jsonb;v_quality jsonb;v_expected jsonb;
  v_index bigint;v_count numeric;v_status text;v_error text;v_final_status text;v_final_error text;v_required boolean;v_reason text;v_message text;
begin
  v_batch:=public.shadow_inventory_envelope_payload_v1(p_declaration->'outputManifestEnvelope');
  if p_declaration->'artifactGenerationId'<>'null'::jsonb or p_declaration->'producer'->>'name' is distinct from 'local-worker'
    or v_batch->'binding' is distinct from public.shadow_projection_binding_v1(p_member,null)
    or pg_catalog.jsonb_array_length(v_batch->'units')<>1
    or v_batch->'units'->0->>'family'<>'repair_audit_inputs'
    or v_batch->'units'->0->>'key'<>'enrichment-repair'
    or v_batch->'units'->0->'output' is distinct from p_output then raise exception 'shadow_repair_owner_identity'; end if;
  v_capture:=public.shadow_producer_capture_v1(p_output);v_native:=v_capture->'input';
  if not public.shadow_keys_v1(v_native,array['input','optionalIndexWriteIssues','decision']) then raise exception 'shadow_repair_input_invalid'; end if;
  v_input:=v_native->'input';v_issues:=v_native->'optionalIndexWriteIssues';v_decision:=v_native->'decision';
  if not public.shadow_keys_v1(v_input,array['enrichmentStatus','enrichmentErrorMessage','optionalIssueCount'])
    or (v_input->>'enrichmentStatus' in ('pending','completed','failed')) is not true
    or (pg_catalog.jsonb_typeof(v_input->'enrichmentErrorMessage') in ('string','null')) is not true
    or pg_catalog.jsonb_typeof(v_input->'optionalIssueCount')<>'number'
    or (v_input->>'optionalIssueCount')::numeric<>pg_catalog.trunc((v_input->>'optionalIssueCount')::numeric)
    or (v_input->>'optionalIssueCount')::numeric not between 0 and 9007199254740991
    or pg_catalog.jsonb_typeof(v_issues)<>'array'
    or v_input->'optionalIssueCount' is distinct from pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(v_issues))
    then raise exception 'shadow_repair_input_invalid'; end if;
  for v_issue,v_index in select value,ord-1 from pg_catalog.jsonb_array_elements(v_issues) with ordinality a(value,ord) loop
    if not coalesce(pg_catalog.jsonb_typeof(v_issue)='object' and v_issue ?& array['stage','message']
      and v_issue-array['stage','message','code']='{}'::jsonb
      and pg_catalog.jsonb_typeof(v_issue->'stage')='string' and pg_catalog.jsonb_typeof(v_issue->'message')='string'
      and (not(v_issue?'code') or pg_catalog.jsonb_typeof(v_issue->'code') in ('string','null')),false)
      then raise exception 'shadow_repair_issue_invalid'; end if;
  end loop;
  for v_path in select value from pg_catalog.jsonb_array_elements(v_capture->'ownUndefinedPaths') loop
    if pg_catalog.jsonb_array_length(v_path)<>3 or v_path->0<>'"optionalIndexWriteIssues"'::jsonb
      or pg_catalog.jsonb_typeof(v_path->1)<>'number' or v_path->2<>'"code"'::jsonb
      or (v_path->>1)::numeric<>pg_catalog.trunc((v_path->>1)::numeric)
      or (v_path->>1)::numeric not between 0 and pg_catalog.jsonb_array_length(v_issues)-1
      or (v_issues->((v_path->>1)::integer)) ? 'code' then raise exception 'shadow_repair_undefined_path'; end if;
  end loop;
  if not public.shadow_keys_v1(v_decision,array['enrichmentStatus','enrichmentErrorMessage','repairRequired','repairReason','repairMessage']) then raise exception 'shadow_repair_decision_invalid'; end if;
  v_status:=v_input->>'enrichmentStatus';v_error:=v_input->>'enrichmentErrorMessage';v_count:=(v_input->>'optionalIssueCount')::numeric;
  v_required:=v_count>0;v_final_status:=case when v_required and v_status='completed' then 'pending' else v_status end;
  v_final_error:=case when v_required and v_status='completed' then 'Optional index artifact writes failed; queued for indexing-v3-agent repair.' else v_error end;
  v_required:=v_final_status<>'completed' or v_required;
  v_reason:=case when v_count>0 then 'optional_index_write_issues' when v_final_status='failed' then 'inline_enrichment_failed' else 'enrichment_deferred' end;
  v_message:=coalesce(v_final_error,case when v_count>0 then 'Optional index artifact writes failed; queued for indexing-v3-agent repair.' else 'Core index complete; enrichment queued for indexing-v3-agent.' end);
  v_expected:=pg_catalog.jsonb_build_object('enrichmentStatus',v_final_status,'enrichmentErrorMessage',v_final_error,
    'repairRequired',v_required,'repairReason',v_reason,'repairMessage',v_message);
  if v_decision is distinct from v_expected then raise exception 'shadow_repair_decision_changed'; end if;
  select * into v_projection from public.document_generation_projections where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  if not found or v_projection.quality is null or v_projection.worker_metadata is null then raise exception 'shadow_repair_projection_required'; end if;
  perform public.shadow_validate_projection_components_v1(p_member,v_projection);
  v_quality:=v_projection.quality;v_metadata:=v_projection.worker_metadata;
  if v_issues is distinct from v_quality->'metrics'->'optional_index_write_issues'
    or v_issues is distinct from v_metadata->'optional_index_write_issues'
    or v_metadata->'enrichment_status' is distinct from v_expected->'enrichmentStatus'
    or v_metadata->'enrichment_error' is distinct from v_expected->'enrichmentErrorMessage'
    or v_metadata->'indexing_v3_agent_status' is distinct from pg_catalog.to_jsonb(case when v_required then 'pending' else 'completed' end)
    or v_metadata->'indexing_v3_agent_last_error' is distinct from (case when v_required then v_expected->'repairMessage' else 'null'::jsonb end)
    or v_metadata->'indexing_v3_agent_repair_reason' is distinct from (case when v_required then v_expected->'repairReason' else 'null'::jsonb end)
    then raise exception 'shadow_repair_projection_changed'; end if;
  return v_capture;
exception when others then raise exception 'invalid_shadow_repair_audit' using errcode='22023';
end $$;
alter function public.shadow_repair_audit_payload_v1(public.document_index_generations,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_repair_audit_payload_v1(public.document_index_generations,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_native_undefined_path_v1(p_path jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_path)='array' and (
    (pg_catalog.jsonb_array_length(p_path)=2 and p_path->0='"extracted"'::jsonb
      and p_path->>1 in ('warnings','temporaryPaths','budgetUsage'))
    or (pg_catalog.jsonb_array_length(p_path)=4 and p_path->0='"extracted"'::jsonb
      and p_path->1='"pages"'::jsonb and pg_catalog.jsonb_typeof(p_path->2)='number'
      and p_path->>3 in ('ocrUsed','needsOcr'))
    or (pg_catalog.jsonb_array_length(p_path)=4 and p_path->0='"extracted"'::jsonb
      and p_path->1='"images"'::jsonb and pg_catalog.jsonb_typeof(p_path->2)='number'
      and p_path->>3 in ('bbox','width','height','sourceKind','metadata'))
  ),false)
$$;
alter function public.shadow_native_undefined_path_v1(jsonb) owner to postgres;
revoke all on function public.shadow_native_undefined_path_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_visual_undefined_field_v1(p_collection text,p_field text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(case p_collection
    when 'thresholds' then p_field in ('value','action','source_text','source_image_id','page_number','source_region','visible_text')
    when 'flowchart_nodes' then p_field in ('type','source_image_id','page_number','source_region','visible_text')
    when 'flowchart_edges' then p_field in ('label','source_image_id','page_number','source_region','visible_text')
    when 'risk_matrix_cells' then p_field in ('action','source_image_id','page_number','source_region','visible_text')
    when 'chart_findings' then p_field in ('value','interpretation','source_image_id','page_number','source_region','visible_text')
    else false end,false)
$$;
alter function public.shadow_visual_undefined_field_v1(text,text) owner to postgres;
revoke all on function public.shadow_visual_undefined_field_v1(text,text) from public,anon,authenticated,service_role;

create or replace function public.shadow_cache_undefined_path_v1(p_path jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_path)='array' and (
    (pg_catalog.jsonb_array_length(p_path)=2 and p_path='["task","nearbyText"]'::jsonb)
    or (pg_catalog.jsonb_array_length(p_path)=3 and p_path->0='"task"'::jsonb and p_path->1='"candidate"'::jsonb
      and p_path->>2 in ('id','nearbyText'))
    or (pg_catalog.jsonb_array_length(p_path)=3 and p_path->0='"task"'::jsonb and p_path->1='"image"'::jsonb
      and p_path->>2 in ('bbox','width','height','sourceKind','metadata'))
    or (pg_catalog.jsonb_array_length(p_path)=5 and p_path->0='"classification"'::jsonb
      and p_path->1='"structured_visual_profile"'::jsonb and pg_catalog.jsonb_typeof(p_path->3)='number'
      and public.shadow_visual_undefined_field_v1(p_path->>2,p_path->>4))
    or (pg_catalog.jsonb_array_length(p_path)=6 and p_path->0='"task"'::jsonb and p_path->1='"presetClassification"'::jsonb
      and p_path->2='"structured_visual_profile"'::jsonb and pg_catalog.jsonb_typeof(p_path->4)='number'
      and public.shadow_visual_undefined_field_v1(p_path->>3,p_path->>5))
  ),false)
$$;
alter function public.shadow_cache_undefined_path_v1(jsonb) owner to postgres;
revoke all on function public.shadow_cache_undefined_path_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_json_string_array_v1(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_value)='array'
    and not exists(select 1 from pg_catalog.jsonb_array_elements(p_value) a where pg_catalog.jsonb_typeof(a.value)<>'string'),false)
$$;
alter function public.shadow_json_string_array_v1(jsonb) owner to postgres;
revoke all on function public.shadow_json_string_array_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_visual_profile_v1(p_value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_item jsonb;v_key text;v_field text;v_allowed text[];v_required text[];
begin
  if not coalesce(pg_catalog.jsonb_typeof(p_value)='object' and p_value ?& array['clinical_purpose','key_terms','medications','thresholds','actions','monitoring_items','flowchart_nodes','flowchart_edges','risk_matrix_axes','risk_matrix_cells','chart_axes','chart_findings','table_column_roles','source_regions','confidence']
    and p_value-array['clinical_purpose','key_terms','medications','thresholds','actions','monitoring_items','flowchart_nodes','flowchart_edges','risk_matrix_axes','risk_matrix_cells','chart_axes','chart_findings','table_column_roles','source_regions','confidence']='{}'::jsonb
    and (p_value->'clinical_purpose'='null'::jsonb or pg_catalog.jsonb_typeof(p_value->'clinical_purpose')='string')
    and pg_catalog.jsonb_typeof(p_value->'confidence')='number' and (p_value->>'confidence')::numeric between 0 and 1
    and pg_catalog.jsonb_typeof(p_value->'table_column_roles')='object'
    and pg_catalog.jsonb_typeof(p_value->'source_regions')='array',false) then return false; end if;
  foreach v_key in array array['key_terms','medications','actions','monitoring_items','risk_matrix_axes','chart_axes'] loop
    if not public.shadow_json_string_array_v1(p_value->v_key) then return false; end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_each(p_value->'table_column_roles') where pg_catalog.jsonb_typeof(value)<>'string')
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_value->'source_regions') where pg_catalog.jsonb_typeof(value)<>'object') then return false; end if;
  foreach v_key in array array['thresholds','flowchart_nodes','flowchart_edges','risk_matrix_cells','chart_findings'] loop
    if pg_catalog.jsonb_typeof(p_value->v_key)<>'array' then return false; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_value->v_key) loop
      v_allowed:=case v_key when 'thresholds' then array['label','value','action','confidence','source_text','source_image_id','page_number','source_region','visible_text']
        when 'flowchart_nodes' then array['id','label','type','source_image_id','page_number','source_region','visible_text']
        when 'flowchart_edges' then array['from','to','label','source_image_id','page_number','source_region','visible_text']
        when 'risk_matrix_cells' then array['row','column','risk','action','confidence','source_image_id','page_number','source_region','visible_text']
        else array['label','value','interpretation','confidence','source_image_id','page_number','source_region','visible_text'] end;
      v_required:=case v_key when 'thresholds' then array['label','confidence'] when 'flowchart_nodes' then array['id','label']
        when 'flowchart_edges' then array['from','to'] when 'risk_matrix_cells' then array['row','column','risk','confidence'] else array['label','confidence'] end;
      if not coalesce(pg_catalog.jsonb_typeof(v_item)='object' and v_item ?& v_required and v_item-v_allowed='{}'::jsonb,false) then return false; end if;
      foreach v_field in array array['label','id','from','to','row','column','risk'] loop
        if v_item ? v_field and pg_catalog.jsonb_typeof(v_item->v_field)<>'string' then return false; end if;
      end loop;
      foreach v_field in array array['value','action','source_text','type','source_image_id','visible_text','interpretation'] loop
        if v_item ? v_field and v_item->v_field<>'null'::jsonb and pg_catalog.jsonb_typeof(v_item->v_field)<>'string' then return false; end if;
      end loop;
      if v_item ? 'confidence' and (pg_catalog.jsonb_typeof(v_item->'confidence')<>'number' or (v_item->>'confidence')::numeric not between 0 and 1) then return false; end if;
      if v_item ? 'page_number' and v_item->'page_number'<>'null'::jsonb and pg_catalog.jsonb_typeof(v_item->'page_number')<>'number' then return false; end if;
      if v_item ? 'source_region' and v_item->'source_region'<>'null'::jsonb and pg_catalog.jsonb_typeof(v_item->'source_region')<>'object' then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end $$;
alter function public.shadow_visual_profile_v1(jsonb) owner to postgres;
revoke all on function public.shadow_visual_profile_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_image_classification_v1(p_value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  return coalesce(public.shadow_keys_v1(p_value,array['image_type','searchable','clinical_relevance_score','labels','caption','skip_reason','clinical_use_class','clinical_use_reason','clinical_signal_score','admin_signal_score','structured_visual_profile','structured_extraction_confidence'])
    and p_value->>'image_type' in ('clinical_table','flowchart_algorithm','form_checklist','risk_matrix','medication_chart','graph','screenshot_ui','photo','logo_decorative','unclear')
    and pg_catalog.jsonb_typeof(p_value->'searchable')='boolean'
    and pg_catalog.jsonb_typeof(p_value->'clinical_relevance_score')='number' and (p_value->>'clinical_relevance_score')::numeric between 0 and 1
    and public.shadow_json_string_array_v1(p_value->'labels') and pg_catalog.jsonb_typeof(p_value->'caption')='string'
    and (p_value->'skip_reason'='null'::jsonb or pg_catalog.jsonb_typeof(p_value->'skip_reason')='string')
    and p_value->>'clinical_use_class' in ('clinical_evidence','administrative','reference','decorative_or_empty','ambiguous')
    and pg_catalog.jsonb_typeof(p_value->'clinical_use_reason')='string'
    and pg_catalog.jsonb_typeof(p_value->'clinical_signal_score')='number' and (p_value->>'clinical_signal_score')::numeric between 0 and 10
    and pg_catalog.jsonb_typeof(p_value->'admin_signal_score')='number' and (p_value->>'admin_signal_score')::numeric between 0 and 10
    and public.shadow_visual_profile_v1(p_value->'structured_visual_profile')
    and pg_catalog.jsonb_typeof(p_value->'structured_extraction_confidence')='number' and (p_value->>'structured_extraction_confidence')::numeric between 0 and 1,false);
exception when others then return false;
end $$;
alter function public.shadow_image_classification_v1(jsonb) owner to postgres;
revoke all on function public.shadow_image_classification_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_native_structure_payload_v1(p_member public.document_index_generations,p_manifest jsonb,p_declaration jsonb,p_output jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_capture jsonb;v_input jsonb;v_extracted jsonb;v_page jsonb;v_image jsonb;v_bytes jsonb;v_page_declaration jsonb;v_page_batch jsonb;v_page_output jsonb;v_native_batch jsonb;
  v_item jsonb;v_key text;v_index bigint;v_count bigint;
begin
  if p_declaration->'artifactGenerationId'<>'null'::jsonb or p_declaration->'producer'->>'name' is distinct from 'local-worker'
    or public.shadow_inventory_envelope_payload_v1(p_declaration->'outputManifestEnvelope')->'binding' is distinct from public.shadow_projection_binding_v1(p_member,null)
    then raise exception 'shadow_native_owner_identity'; end if;
  v_native_batch:=public.shadow_inventory_envelope_payload_v1(p_declaration->'outputManifestEnvelope');
  if pg_catalog.jsonb_array_length(v_native_batch->'units')<>1 or v_native_batch->'units'->0->>'family'<>'native_structure'
    or v_native_batch->'units'->0->>'key'<>'extracted-document' or v_native_batch->'units'->0->'output' is distinct from p_output
    then raise exception 'shadow_native_owner_identity'; end if;
  v_capture:=public.shadow_producer_capture_v1(p_output);v_input:=v_capture->'input';
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_capture->'ownUndefinedPaths') a
    where not public.shadow_native_undefined_path_v1(a.value)) then raise exception 'shadow_full_native_structure_required'; end if;
  if not public.shadow_keys_v1(v_input,array['extracted','imageBytes']) then raise exception 'shadow_full_native_structure_required'; end if;
  v_extracted:=v_input->'extracted';
  if not coalesce(pg_catalog.jsonb_typeof(v_extracted)='object' and v_extracted ?& array['pages','images']
    and v_extracted-array['pages','images','warnings','temporaryPaths','budgetUsage']='{}'::jsonb
    and pg_catalog.jsonb_typeof(v_extracted->'pages')='array' and pg_catalog.jsonb_typeof(v_extracted->'images')='array'
    and pg_catalog.jsonb_typeof(v_input->'imageBytes')='array',false) then raise exception 'shadow_full_native_structure_required'; end if;
  if v_extracted ? 'warnings' and not public.shadow_json_string_array_v1(v_extracted->'warnings')
    or v_extracted ? 'temporaryPaths' and not public.shadow_json_string_array_v1(v_extracted->'temporaryPaths') then raise exception 'shadow_full_native_structure_required'; end if;
  if v_extracted ? 'budgetUsage' and (not public.shadow_keys_v1(v_extracted->'budgetUsage',array['pages','artifacts','artifactBytes','textBytes'])
    or exists(select 1 from pg_catalog.jsonb_each(v_extracted->'budgetUsage') where pg_catalog.jsonb_typeof(value)<>'number' or value::text::numeric<>pg_catalog.trunc(value::text::numeric) or value::text::numeric not between 0 and 9007199254740991))
    then raise exception 'shadow_full_native_structure_required'; end if;
  select count(*),(pg_catalog.jsonb_agg(s->'declaration')->0) into v_count,v_page_declaration
    from pg_catalog.jsonb_array_elements(p_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
    where f->>'family'='pages' and s->>'groupKey'='worker_core' and s->>'state'='declared' and s->'declaration'->'population'->>'tag'='known';
  if v_count<>1 then raise exception 'shadow_native_pages_unavailable'; end if;
  v_page_batch:=public.shadow_inventory_envelope_payload_v1(v_page_declaration->'outputManifestEnvelope');
  if (select count(*) from pg_catalog.jsonb_array_elements(v_page_batch->'units') where value->>'family'='pages')<>pg_catalog.jsonb_array_length(v_extracted->'pages')
    or (select count(*) from pg_catalog.jsonb_array_elements(v_extracted->'pages'))<>
      (select count(distinct value->'pageNumber') from pg_catalog.jsonb_array_elements(v_extracted->'pages'))
    then raise exception 'shadow_native_pages_changed'; end if;
  for v_page in select value from pg_catalog.jsonb_array_elements(v_extracted->'pages') loop
    if not coalesce(pg_catalog.jsonb_typeof(v_page)='object' and v_page ?& array['pageNumber','text']
      and v_page-array['pageNumber','text','ocrUsed','needsOcr']='{}'::jsonb and pg_catalog.jsonb_typeof(v_page->'pageNumber')='number'
      and (v_page->>'pageNumber')::numeric=pg_catalog.trunc((v_page->>'pageNumber')::numeric) and (v_page->>'pageNumber')::numeric between 1 and 9007199254740991
      and pg_catalog.jsonb_typeof(v_page->'text')='string'
      and (not v_page?'ocrUsed' or pg_catalog.jsonb_typeof(v_page->'ocrUsed')='boolean')
      and (not v_page?'needsOcr' or pg_catalog.jsonb_typeof(v_page->'needsOcr')='boolean'),false) then raise exception 'shadow_full_native_page_required'; end if;
    select count(*),(pg_catalog.jsonb_agg(value->'output')->0) into v_count,v_page_output from pg_catalog.jsonb_array_elements(v_page_batch->'units')
      where value->>'family'='pages' and value->>'key'=v_page->>'pageNumber';
    if v_count<>1 or v_page_output->'extractedPage' is distinct from v_page then raise exception 'shadow_native_pages_changed'; end if;
  end loop;
  if pg_catalog.jsonb_array_length(v_input->'imageBytes')<>pg_catalog.jsonb_array_length(v_extracted->'images') then raise exception 'shadow_native_image_bytes_changed'; end if;
  for v_image,v_index in select value,ord-1 from pg_catalog.jsonb_array_elements(v_extracted->'images') with ordinality a(value,ord) loop
    if not coalesce(pg_catalog.jsonb_typeof(v_image)='object' and v_image ?& array['pageNumber','path','mimeType']
      and v_image-array['pageNumber','path','mimeType','bbox','width','height','sourceKind','metadata']='{}'::jsonb
      and (v_image->'pageNumber'='null'::jsonb or pg_catalog.jsonb_typeof(v_image->'pageNumber')='number' and (v_image->>'pageNumber')::numeric=pg_catalog.trunc((v_image->>'pageNumber')::numeric) and (v_image->>'pageNumber')::numeric between 1 and 9007199254740991)
      and pg_catalog.jsonb_typeof(v_image->'path')='string' and pg_catalog.length(v_image->>'path')>0
      and pg_catalog.jsonb_typeof(v_image->'mimeType')='string' and pg_catalog.length(v_image->>'mimeType')>0,false) then raise exception 'shadow_full_native_image_required'; end if;
    foreach v_key in array array['width','height'] loop
      if v_image ? v_key and v_image->v_key<>'null'::jsonb and (pg_catalog.jsonb_typeof(v_image->v_key)<>'number' or (v_image->>v_key)::numeric<>pg_catalog.trunc((v_image->>v_key)::numeric) or (v_image->>v_key)::numeric not between 1 and 9007199254740991) then raise exception 'shadow_full_native_image_required'; end if;
    end loop;
    if v_image ? 'bbox' and v_image->'bbox'<>'null'::jsonb and (pg_catalog.jsonb_typeof(v_image->'bbox')<>'array' or pg_catalog.jsonb_array_length(v_image->'bbox')<>4
      or exists(select 1 from pg_catalog.jsonb_array_elements(v_image->'bbox') where pg_catalog.jsonb_typeof(value)<>'number')) then raise exception 'shadow_full_native_image_required'; end if;
    if v_image ? 'sourceKind' and v_image->>'sourceKind' not in ('embedded','table_crop','diagram_crop','page_region','fallback','cover_page')
      or v_image ? 'metadata' and pg_catalog.jsonb_typeof(v_image->'metadata')<>'object' then raise exception 'shadow_full_native_image_required'; end if;
    v_bytes:=v_input->'imageBytes'->(v_index::integer);
    if not public.shadow_keys_v1(v_bytes,array['path','encoding','content']) or v_bytes->'path' is distinct from v_image->'path'
      or v_bytes->>'encoding'<>'base64' or pg_catalog.jsonb_typeof(v_bytes->'content')<>'string'
      or pg_catalog.replace(pg_catalog.encode(pg_catalog.decode(v_bytes->>'content','base64'),'base64'),E'\n','') is distinct from v_bytes->>'content'
      then raise exception 'shadow_native_image_bytes_changed'; end if;
  end loop;
  return v_capture;
exception when others then
  if sqlerrm like 'shadow_%' or sqlerrm like 'invalid_shadow_%' then raise; end if;
  raise exception 'shadow_full_native_structure_required' using errcode='22023';
end $$;
alter function public.shadow_native_structure_payload_v1(public.document_index_generations,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_native_structure_payload_v1(public.document_index_generations,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_worker_metadata_string_v1(p_metadata jsonb,p_key text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_text text;
begin
  if pg_catalog.jsonb_typeof(p_metadata)<>'object' or pg_catalog.jsonb_typeof(p_metadata->p_key)<>'string' then return 'null'::jsonb; end if;
  v_text:=public.shadow_ecmascript_trim_v1(p_metadata->>p_key);
  return case when v_text='' then 'null'::jsonb else pg_catalog.to_jsonb(v_text) end;
end
$$;
alter function public.shadow_worker_metadata_string_v1(jsonb,text) owner to postgres;
revoke all on function public.shadow_worker_metadata_string_v1(jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.shadow_worker_metadata_number_v1(p_metadata jsonb,p_key text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_value jsonb;v_text text;v_number numeric;v_float double precision;v_base integer;v_digit integer;v_position integer;v_wrapped boolean:=false;
begin
  if pg_catalog.jsonb_typeof(p_metadata)<>'object' or not p_metadata ? p_key then return 'null'::jsonb; end if;
  v_value:=p_metadata->p_key;
  if pg_catalog.jsonb_typeof(v_value)='number' then return v_value; end if;
  if v_value='null'::jsonb then return '0'::jsonb; end if;
  if pg_catalog.jsonb_typeof(v_value)='boolean' then return case when v_value='true'::jsonb then '1'::jsonb else '0'::jsonb end; end if;
  while pg_catalog.jsonb_typeof(v_value)='array' loop
    v_wrapped:=true;
    if pg_catalog.jsonb_array_length(v_value)=0 then return '0'::jsonb; end if;
    if pg_catalog.jsonb_array_length(v_value)<>1 then return 'null'::jsonb; end if;
    v_value:=v_value->0;
    if v_value='null'::jsonb then return '0'::jsonb; end if;
    if pg_catalog.jsonb_typeof(v_value)='number' then return v_value; end if;
  end loop;
  if v_wrapped and pg_catalog.jsonb_typeof(v_value)<>'string' then return 'null'::jsonb; end if;
  if pg_catalog.jsonb_typeof(v_value)<>'string' then return 'null'::jsonb; end if;
  v_text:=public.shadow_ecmascript_trim_v1(v_value#>>'{}');if v_text='' then return '0'::jsonb; end if;
  if v_text ~ '^0[xX][0-9a-fA-F]+$' then v_base:=16;
  elsif v_text ~ '^0[bB][01]+$' then v_base:=2;
  elsif v_text ~ '^0[oO][0-7]+$' then v_base:=8;
  else v_base:=null; end if;
  if v_base is not null then
    v_number:=0;
    for v_position in 3..pg_catalog.length(v_text) loop
      v_digit:=pg_catalog.strpos('0123456789abcdef',pg_catalog.lower(pg_catalog.substr(v_text,v_position,1)))-1;
      v_number:=v_number*v_base+v_digit;
      if v_number>9007199254740991 then return '"__invalid_unsafe_number__"'::jsonb; end if;
    end loop;
    return pg_catalog.to_jsonb(v_number);
  end if;
  if v_text !~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$' then return 'null'::jsonb; end if;
  v_float:=v_text::double precision;
  if (v_float=0 and v_text like '-%') or (v_float=pg_catalog.trunc(v_float) and pg_catalog.abs(v_float)>9007199254740991)
    then return '"__invalid_unsafe_number__"'::jsonb; end if;
  return pg_catalog.to_jsonb(v_float);
exception when others then return 'null'::jsonb;
end $$;
alter function public.shadow_worker_metadata_number_v1(jsonb,text) owner to postgres;
revoke all on function public.shadow_worker_metadata_number_v1(jsonb,text) from public,anon,authenticated,service_role;


-- Reproduce JavaScript whitespace collapse, UTF-16 length and slice for the worker's
-- compactMetadataText. A split surrogate cannot be represented in jsonb and
-- is refused rather than silently converted to a different string.
create or replace function public.shadow_ecmascript_collapse_v1(p_text text)
returns text language plpgsql immutable set search_path = '' as $$
declare v_space text:=pg_catalog.chr(9)||pg_catalog.chr(10)||pg_catalog.chr(11)||pg_catalog.chr(12)||pg_catalog.chr(13)||pg_catalog.chr(32)
    ||pg_catalog.chr(160)||pg_catalog.chr(5760)||pg_catalog.chr(8192)||pg_catalog.chr(8193)||pg_catalog.chr(8194)||pg_catalog.chr(8195)
    ||pg_catalog.chr(8196)||pg_catalog.chr(8197)||pg_catalog.chr(8198)||pg_catalog.chr(8199)||pg_catalog.chr(8200)||pg_catalog.chr(8201)||pg_catalog.chr(8202)
    ||pg_catalog.chr(8232)||pg_catalog.chr(8233)||pg_catalog.chr(8239)||pg_catalog.chr(8287)||pg_catalog.chr(12288)||pg_catalog.chr(65279);
begin
  return public.shadow_ecmascript_trim_v1(pg_catalog.regexp_replace(p_text,'['||v_space||']+',' ','g'));
end $$;
alter function public.shadow_ecmascript_collapse_v1(text) owner to postgres;
revoke all on function public.shadow_ecmascript_collapse_v1(text) from public,anon,authenticated,service_role;

create or replace function public.shadow_utf16_slice_v1(p_text text,p_units integer)
returns text language plpgsql immutable set search_path = '' as $$
declare v_result text:='';v_character text;v_index integer;v_used integer:=0;v_width integer;
begin
  if p_units<0 then raise exception 'invalid_shadow_utf16_slice'; end if;
  for v_index in 1..pg_catalog.length(p_text) loop
    v_character:=pg_catalog.substr(p_text,v_index,1);v_width:=pg_catalog.octet_length(public.shadow_utf16_order_v1(v_character))/2;
    if v_used+v_width>p_units then
      if v_used<p_units then raise exception 'invalid_shadow_utf16_slice'; end if;
      return v_result;
    end if;
    v_result:=v_result||v_character;v_used:=v_used+v_width;
  end loop;
  return v_result;
end $$;
alter function public.shadow_utf16_slice_v1(text,integer) owner to postgres;
revoke all on function public.shadow_utf16_slice_v1(text,integer) from public,anon,authenticated,service_role;

create or replace function public.shadow_worker_compact_text_v1(p_text text,p_limit integer)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_compact text;
begin
  if p_text is null or p_limit<3 then return 'null'::jsonb; end if;
  v_compact:=public.shadow_ecmascript_collapse_v1(p_text);
  if v_compact='' then return 'null'::jsonb; end if;
  if pg_catalog.octet_length(public.shadow_utf16_order_v1(v_compact))/2>p_limit then
    v_compact:=public.shadow_ecmascript_trim_v1(public.shadow_utf16_slice_v1(v_compact,p_limit-3))||'...';
  end if;
  return pg_catalog.to_jsonb(v_compact);
end $$;
alter function public.shadow_worker_compact_text_v1(text,integer) owner to postgres;
revoke all on function public.shadow_worker_compact_text_v1(text,integer) from public,anon,authenticated,service_role;


create or replace function public.shadow_cache_input_payload_v1(p_member public.document_index_generations,p_manifest jsonb,p_declaration jsonb,p_unit_key text,p_output jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_capture jsonb;v_input jsonb;v_task jsonb;v_candidate jsonb;v_image jsonb;v_classification jsonb;v_table jsonb;v_native_declaration jsonb;v_native_batch jsonb;v_native_output jsonb;v_native_capture jsonb;v_native_image jsonb;v_native_bytes jsonb;
  v_key text;v_index bigint;v_count bigint;v_metadata jsonb;v_table_text text;v_path jsonb;v_suffix jsonb;v_mapped jsonb;
begin
  if p_declaration->'artifactGenerationId'<>'null'::jsonb or p_declaration->'producer'->>'name' is distinct from 'local-worker'
    or public.shadow_inventory_envelope_payload_v1(p_declaration->'outputManifestEnvelope')->'binding' is distinct from public.shadow_projection_binding_v1(p_member,null)
    then raise exception 'shadow_cache_owner_identity'; end if;
  v_capture:=public.shadow_producer_capture_v1(p_output);v_input:=v_capture->'input';
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_capture->'ownUndefinedPaths') a
    where not public.shadow_cache_undefined_path_v1(a.value)) then raise exception 'shadow_full_cache_input_required'; end if;
  if not public.shadow_keys_v1(v_input,array['task','classification','classificationCacheHit','ownerId','model'])
    or pg_catalog.jsonb_typeof(v_input->'classificationCacheHit')<>'boolean'
    or v_input->'ownerId' is distinct from coalesce(pg_catalog.to_jsonb(p_member.owner_id),'null'::jsonb)
    or pg_catalog.jsonb_typeof(v_input->'model')<>'string' or pg_catalog.length(v_input->>'model')=0
    or not public.shadow_image_classification_v1(v_input->'classification') then raise exception 'shadow_full_cache_input_required'; end if;
  v_task:=v_input->'task';v_classification:=v_input->'classification';
  if not coalesce(pg_catalog.jsonb_typeof(v_task)='object' and v_task ?& array['candidate','index','image','perceptualHash','imageHash','tableMetadata','contextHash','presetClassification']
      and v_task-array['candidate','index','image','perceptualHash','imageHash','nearbyText','tableMetadata','contextHash','presetClassification']='{}'::jsonb,false)
    or pg_catalog.jsonb_typeof(v_task->'index')<>'number' or (v_task->>'index')::numeric<>pg_catalog.trunc((v_task->>'index')::numeric)
    or (v_task->>'index')::numeric not between 0 and 9007199254740991 or v_task->>'index' is distinct from p_unit_key
    or pg_catalog.jsonb_typeof(v_task->'perceptualHash')<>'string' or pg_catalog.jsonb_typeof(v_task->'imageHash')<>'string' or v_task->>'imageHash' !~ '^[0-9a-f]{64}$'
    or (v_task ? 'nearbyText' and pg_catalog.jsonb_typeof(v_task->'nearbyText')<>'string')
    or (not (v_task ? 'nearbyText') and not (v_capture->'ownUndefinedPaths' @> '[["task","nearbyText"]]'::jsonb))
    or pg_catalog.jsonb_typeof(v_task->'contextHash')<>'string' or v_task->>'contextHash' !~ '^[0-9a-f]{32}$'
    or (v_task->'presetClassification'<>'null'::jsonb and not public.shadow_image_classification_v1(v_task->'presetClassification'))
    then raise exception 'shadow_full_cache_input_required'; end if;
  v_index:=(v_task->>'index')::bigint;v_candidate:=v_task->'candidate';v_image:=v_task->'image';v_table:=v_task->'tableMetadata';
  if not coalesce(pg_catalog.jsonb_typeof(v_candidate)='object' and v_candidate ?& array['pageNumber','width','height','bbox','sourceKind','imageHash','perceptualHash','metadata','originalIndex','candidatePriorityScore','imageQualityScore','cropCompleteness','ocrTextDensity','captionBudgetClass','reasons','duplicateGroup']
      and v_candidate-array['id','pageNumber','width','height','bbox','sourceKind','imageHash','perceptualHash','metadata','nearbyText','originalIndex','candidatePriorityScore','imageQualityScore','cropCompleteness','ocrTextDensity','captionBudgetClass','reasons','duplicateGroup']='{}'::jsonb,false)
    or (v_candidate ? 'id' and v_candidate->'id'<>'null'::jsonb and pg_catalog.jsonb_typeof(v_candidate->'id')<>'string')
    or (not (v_candidate ? 'nearbyText') and not (v_capture->'ownUndefinedPaths' @> '[["task","candidate","nearbyText"]]'::jsonb))
    or (v_candidate ? 'nearbyText' and v_candidate->'nearbyText'<>'null'::jsonb and pg_catalog.jsonb_typeof(v_candidate->'nearbyText')<>'string')
    or (v_candidate->'duplicateGroup'<>'null'::jsonb and pg_catalog.jsonb_typeof(v_candidate->'duplicateGroup')<>'string')
    or v_candidate->'originalIndex' is distinct from v_task->'index' or v_candidate->'imageHash' is distinct from v_task->'imageHash'
    or v_candidate->'perceptualHash' is distinct from v_task->'perceptualHash'
    or v_candidate->>'captionBudgetClass' not in ('clinical_table','flowchart','risk_matrix','medication_chart','form_checklist','graph','clinical_region','admin_reference','low_signal')
    or not public.shadow_json_string_array_v1(v_candidate->'reasons') or pg_catalog.jsonb_typeof(v_candidate->'metadata')<>'object'
    then raise exception 'shadow_full_cache_input_required'; end if;
  foreach v_key in array array['candidatePriorityScore','imageQualityScore','cropCompleteness','ocrTextDensity'] loop
    if pg_catalog.jsonb_typeof(v_candidate->v_key)<>'number' then raise exception 'shadow_full_cache_input_required'; end if;
  end loop;
  if not public.shadow_keys_v1(v_table,array['candidateType','tableLabel','tableTitle','tableRole','tableConfidence','tableText','tableTextSnippet','accessibleTableMarkdown','tableRows','tableColumns']) then raise exception 'shadow_full_cache_input_required'; end if;
  foreach v_key in array array['candidateType','tableLabel','tableTitle','tableRole','tableText','tableTextSnippet','accessibleTableMarkdown'] loop
    if v_table->v_key<>'null'::jsonb and pg_catalog.jsonb_typeof(v_table->v_key)<>'string' then raise exception 'shadow_full_cache_input_required'; end if;
  end loop;
  if v_table->'tableConfidence'<>'null'::jsonb and pg_catalog.jsonb_typeof(v_table->'tableConfidence')<>'number'
    or v_table->'tableRows'<>'null'::jsonb and pg_catalog.jsonb_typeof(v_table->'tableRows')<>'array'
    or v_table->'tableColumns'<>'null'::jsonb and pg_catalog.jsonb_typeof(v_table->'tableColumns')<>'array' then raise exception 'shadow_full_cache_input_required'; end if;
  if v_task->'presetClassification'<>'null'::jsonb and (v_task->'presetClassification' is distinct from v_classification or v_input->'classificationCacheHit'<>'false'::jsonb)
    or v_input->'classificationCacheHit'='true'::jsonb and (v_task->'presetClassification'<>'null'::jsonb or p_member.owner_id is null) then raise exception 'shadow_cache_classification_identity'; end if;
  select count(*),(pg_catalog.jsonb_agg(s->'declaration')->0) into v_count,v_native_declaration
    from pg_catalog.jsonb_array_elements(p_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
    where f->>'family'='native_structure' and s->>'groupKey'='worker_native' and s->>'state'='declared' and s->'declaration'->'population'->>'tag'='known'
      and s->'declaration'->'population'->'expectedUnits' @> '[{"family":"native_structure","key":"extracted-document"}]'::jsonb;
  if v_count<>1 then raise exception 'shadow_cache_native_input_unavailable'; end if;
  v_native_batch:=public.shadow_inventory_envelope_payload_v1(v_native_declaration->'outputManifestEnvelope');
  select count(*),(pg_catalog.jsonb_agg(value->'output')->0) into v_count,v_native_output from pg_catalog.jsonb_array_elements(v_native_batch->'units')
    where value->>'family'='native_structure' and value->>'key'='extracted-document';
  if v_count<>1 then raise exception 'shadow_cache_native_input_unavailable'; end if;
  v_native_capture:=public.shadow_native_structure_payload_v1(p_member,p_manifest,v_native_declaration,v_native_output);
  v_native_image:=v_native_capture->'input'->'extracted'->'images'->(v_index::integer);v_native_bytes:=v_native_capture->'input'->'imageBytes'->(v_index::integer);
  if v_native_image is null or v_native_bytes is null or v_image is distinct from v_native_image
    or v_native_bytes->'path' is distinct from v_image->'path'
    or pg_catalog.encode(extensions.digest(pg_catalog.decode(v_native_bytes->>'content','base64'),'sha256'),'hex') is distinct from v_task->>'imageHash'
    or v_candidate->'pageNumber' is distinct from v_image->'pageNumber' or v_candidate->'width' is distinct from coalesce(v_image->'width','null'::jsonb)
    or v_candidate->'height' is distinct from coalesce(v_image->'height','null'::jsonb) or v_candidate->'bbox' is distinct from coalesce(v_image->'bbox','null'::jsonb)
    or v_candidate->'sourceKind' is distinct from coalesce(v_image->'sourceKind','null'::jsonb) or v_candidate->'metadata' is distinct from coalesce(v_image->'metadata','{}'::jsonb)
    or (not (
      coalesce(v_candidate->'nearbyText','null'::jsonb) is not distinct from coalesce(v_task->'nearbyText','null'::jsonb)
        and (v_candidate ? 'nearbyText')=(v_task ? 'nearbyText')
      or v_image->'pageNumber'='null'::jsonb and v_candidate->'nearbyText'='null'::jsonb and not(v_task?'nearbyText')
        and v_capture->'ownUndefinedPaths' @> '[["task","nearbyText"]]'::jsonb
    )) then raise exception 'shadow_cache_native_input_changed'; end if;
  -- JSONB equality alone cannot distinguish an omitted own-undefined field.
  -- Map every such task.image path to the corresponding retained native image.
  for v_path in select value from pg_catalog.jsonb_array_elements(v_capture->'ownUndefinedPaths')
    where value->0='"task"'::jsonb and value->1='"image"'::jsonb loop
    select coalesce(pg_catalog.jsonb_agg(value order by ord),'[]'::jsonb) into v_suffix
      from pg_catalog.jsonb_array_elements(v_path) with ordinality a(value,ord) where ord>2;
    v_mapped:=pg_catalog.jsonb_build_array('extracted','images',v_index)||v_suffix;
    if not (v_native_capture->'ownUndefinedPaths' @> pg_catalog.jsonb_build_array(v_mapped)) then raise exception 'shadow_cache_native_input_changed'; end if;
  end loop;
  for v_path in select value from pg_catalog.jsonb_array_elements(v_native_capture->'ownUndefinedPaths')
    where value->0='"extracted"'::jsonb and value->1='"images"'::jsonb and value->2=pg_catalog.to_jsonb(v_index) loop
    select coalesce(pg_catalog.jsonb_agg(value order by ord),'[]'::jsonb) into v_suffix
      from pg_catalog.jsonb_array_elements(v_path) with ordinality a(value,ord) where ord>3;
    v_mapped:=pg_catalog.jsonb_build_array('task','image')||v_suffix;
    if not (v_capture->'ownUndefinedPaths' @> pg_catalog.jsonb_build_array(v_mapped)) then raise exception 'shadow_cache_native_input_changed'; end if;
  end loop;
  v_metadata:=coalesce(v_image->'metadata','{}'::jsonb);
  if v_table->'candidateType' is distinct from public.shadow_worker_metadata_string_v1(v_metadata,'candidate_type')
    or v_table->'tableLabel' is distinct from public.shadow_worker_metadata_string_v1(v_metadata,'table_label')
    or v_table->'tableTitle' is distinct from public.shadow_worker_metadata_string_v1(v_metadata,'table_title')
    or v_table->'tableRole' is distinct from public.shadow_worker_metadata_string_v1(v_metadata,'table_role')
    or v_table->'tableConfidence' is distinct from public.shadow_worker_metadata_number_v1(v_metadata,'table_confidence')
    or v_table->'tableText' is distinct from public.shadow_worker_metadata_string_v1(v_metadata,'table_text')
    or v_table->'tableRows' is distinct from (case when pg_catalog.jsonb_typeof(v_metadata->'table_rows')='array' then v_metadata->'table_rows' else 'null'::jsonb end)
    or v_table->'tableColumns' is distinct from (case when pg_catalog.jsonb_typeof(v_metadata->'table_columns')='array' then v_metadata->'table_columns' else 'null'::jsonb end)
    then raise exception 'shadow_cache_table_metadata_changed'; end if;
  v_table_text:=case when v_table->'tableText'='null'::jsonb then null else v_table->>'tableText' end;
  if v_table->'tableTextSnippet' is distinct from public.shadow_worker_compact_text_v1(v_table_text,1200)
    or v_table->'accessibleTableMarkdown' is distinct from (case when public.shadow_worker_metadata_string_v1(v_metadata,'accessible_table_markdown')<>'null'::jsonb
      then public.shadow_worker_metadata_string_v1(v_metadata,'accessible_table_markdown') else v_table->'tableText' end)
    then raise exception 'shadow_cache_table_metadata_changed'; end if;
  return v_capture;
exception when others then
  if sqlerrm like 'shadow_%' or sqlerrm like 'invalid_shadow_%' then raise; end if;
  raise exception 'shadow_full_cache_input_required' using errcode='22023';
end $$;
alter function public.shadow_cache_input_payload_v1(public.document_index_generations,jsonb,jsonb,text,jsonb) owner to postgres;
revoke all on function public.shadow_cache_input_payload_v1(public.document_index_generations,jsonb,jsonb,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_reconcile_final_disposition_v1(p_member public.document_index_generations,p_manifest jsonb,p_outcome jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_unit public.document_generation_inventory%rowtype;v_declaration jsonb;v_batch jsonb;v_planned jsonb;v_ref jsonb;v_payload jsonb;v_raw jsonb;v_native jsonb;
  v_table text;v_family text;v_group text;v_row jsonb;v_digest text;v_bytes bytea;v_reason text;v_count integer;v_d uuid;v_key text;v_page_input jsonb;v_limitation jsonb;v_pointer jsonb;
begin
  select * into v_unit from public.document_generation_inventory where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id
    and family=p_outcome->>'family' and unit_key=p_outcome->>'unitKey' for update;
  if not found then raise exception 'shadow_disposition_unit_required'; end if;
  select s->'declaration',s->>'groupKey' into v_declaration,v_group from pg_catalog.jsonb_array_elements(p_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
    where f->>'family'=p_outcome->>'family' and s->>'state'='declared' and s->'declaration'->'population'->>'tag'='known'
      and s->'declaration'->'population'->'expectedUnits' @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('family',p_outcome->'family','key',p_outcome->'unitKey'));
  if not found then raise exception 'shadow_disposition_declaration_required'; end if;
  v_batch:=public.shadow_inventory_envelope_payload_v1(v_declaration->'outputManifestEnvelope');
  select value->'output' into v_planned from pg_catalog.jsonb_array_elements(v_batch->'units') where value->'family'=p_outcome->'family' and value->'key'=p_outcome->'unitKey';
  if not found then raise exception 'shadow_planned_output_required'; end if;
  for v_limitation in select value from pg_catalog.jsonb_array_elements(p_outcome->'limitations') loop
    for v_pointer in select value from pg_catalog.jsonb_array_elements(v_limitation->'evidence') loop
      perform public.shadow_resolve_batch_pointer_v1(v_pointer,v_declaration->'outputManifestEnvelope');
    end loop;
  end loop;
  if p_outcome->>'disposition'<>'retained' then
    if p_outcome->>'family'='cache_inputs' and v_unit.required then raise exception 'shadow_required_cache_input_not_retained'; end if;
    if p_outcome->>'family' in ('attempt_control','repair_audit_inputs') and v_unit.required then raise exception 'shadow_required_retained_input_not_retained'; end if;
    v_reason:=p_outcome->>'reasonCode';
    if (p_outcome->>'disposition'='failed' and v_reason='producer_failed'
      or p_outcome->>'disposition'='skipped' and v_reason in ('producer_skipped','producer_unavailable')
      or p_outcome->>'disposition'='excluded' and v_reason='policy_excluded') is not true
      or pg_catalog.jsonb_array_length(p_outcome->'limitations')=0 or not exists(select 1 from pg_catalog.jsonb_array_elements(p_outcome->'limitations') l
        where l->>'code'=v_reason and l->'scope'->>'key' in (p_outcome->>'unitKey','*')) then raise exception 'invalid_shadow_nonretained_disposition'; end if;
    -- This writer's known planned units contain actual output. A failed write
    -- cannot discard those bytes: retain the complete original producer value.
    if p_outcome->'artifactRef' is distinct from 'null'::jsonb or p_outcome->'contentDigest' is distinct from 'null'::jsonb
      or pg_catalog.jsonb_typeof(p_outcome->'retainedNativePayload') is distinct from 'string'
      or public.shadow_node_value_text_v1(v_planned) is distinct from p_outcome->>'retainedNativePayload' then raise exception 'shadow_partial_evidence_required'; end if;
    -- Preserve the complete captured value above; inspect only its validated
    -- native RPC input for source fields after a failed core write.
    v_payload:=case
      when p_outcome->>'family'='pages' then public.shadow_page_producer_input_v1(v_planned,p_member.document_id)
      when v_declaration->'artifactGenerationId'='null'::jsonb and p_outcome->>'family' in ('chunks','images','table_facts','embedding_fields','index_units')
        then public.shadow_native_rpc_input_v1(v_planned)
      else v_planned end;
    perform public.shadow_validate_inventory_relationships_v1(p_member,p_manifest,p_outcome,v_payload);
    return;
  end if;
  if p_outcome->'reasonCode' is distinct from 'null'::jsonb or p_outcome->'artifactRef'='null'::jsonb then raise exception 'invalid_shadow_retained_disposition'; end if;
  v_ref:=p_outcome->'artifactRef';v_d:=(v_declaration->>'artifactGenerationId')::uuid;
  if v_ref->>'tag'='candidate_row' then
    v_table:=case v_ref->>'owner' when 'page' then 'document_pages' when 'chunk' then 'document_chunks' when 'image' then 'document_images'
      when 'table_fact' then 'document_table_facts' when 'embedding_field' then 'document_embedding_fields' when 'index_unit' then 'document_index_units'
      when 'section' then 'document_sections' when 'memory_card' then 'document_memory_cards' end;
    v_family:=case v_ref->>'owner' when 'page' then 'pages' when 'chunk' then 'chunks' when 'image' then 'images' when 'table_fact' then 'table_facts'
      when 'embedding_field' then 'embedding_fields' when 'index_unit' then 'index_units' when 'section' then 'sections' when 'memory_card' then 'memory_cards' end;
    if v_family is distinct from p_outcome->>'family' then raise exception 'shadow_reference_family'; end if;
    select row_payload into v_row from public.shadow_capture_rows_v1(array[p_member.document_id],array[]::uuid[]) where table_name=v_table and row_payload->'id'=v_ref->'rowId';
    if not found or v_row->>'document_id' is distinct from p_member.document_id::text
      or (v_row ? 'owner_id' and v_row->'owner_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.owner_id),'null'::jsonb))
      or v_row->'metadata'->>'ingestion_lease_token' is distinct from p_member.first_lease_token::text
      or (case when v_family='pages' then v_row->>'page_number'
        when v_d is not null then public.shadow_deep_row_key_v1(p_member,v_family,v_row)
        else v_row->>'id' end) is distinct from p_outcome->>'unitKey'
      then raise exception 'shadow_candidate_reference_identity'; end if;
    if v_d is null then
      if v_row->>'index_generation_id' is distinct from p_member.index_generation_id::text then raise exception 'shadow_candidate_generation'; end if;
    elsif v_d in (p_member.index_generation_id,p_member.baseline_generation_id) or v_row->>'producer' is distinct from 'local-worker'
      or v_row->>'artifact_generation_id' is distinct from v_d::text or v_row->'metadata'->>'artifact_generation_id' is distinct from v_d::text
      or (v_row->>'index_generation_id' in (v_d::text,p_member.index_generation_id::text)) is not true then raise exception 'shadow_candidate_generation'; end if;
    v_digest:=public.shadow_capture_envelope_v1(v_row)->>'digest';
    if v_ref->>'rowDigest' is distinct from v_digest then raise exception 'shadow_candidate_reference_digest'; end if;
    if pg_catalog.jsonb_typeof(p_outcome->'retainedNativePayload') is distinct from 'string' then raise exception 'shadow_original_unit_required'; end if;
    perform public.shadow_strict_original_json_v1((p_outcome->>'retainedNativePayload')::json);
    v_raw:=(p_outcome->>'retainedNativePayload')::jsonb;v_native:=public.shadow_inventory_envelope_payload_v1(v_raw);
    if v_native is distinct from v_planned then raise exception 'shadow_original_unit_changed'; end if;
    -- Native declarations precede generated IDs/times and fixed writer stamps.
    -- Match through the same typed writer contracts; never rewrite the retained
    -- original output to resemble the final server row.
    if v_d is not null then
      if public.shadow_deep_row_matches_v1(p_member,v_family,p_outcome->>'unitKey',v_row) is not true
        then raise exception 'shadow_original_deep_mismatch'; end if;
    elsif v_family='pages' then
      v_page_input:=public.shadow_page_producer_input_v1(v_native,p_member.document_id);
      if v_page_input->>'page_number' is distinct from p_outcome->>'unitKey'
        or v_row->'text' is distinct from v_page_input->'text' or v_row->'ocr_used' is distinct from v_page_input->'ocr_used'
        or v_row->'metadata' is distinct from v_page_input->'metadata'||pg_catalog.jsonb_build_object('index_generation_id',p_member.index_generation_id,'ingestion_job_kind','node','ingestion_job_id',p_member.job_id,'ingestion_lease_token',p_member.first_lease_token)
        or pg_catalog.jsonb_typeof(v_row->'id') is distinct from 'string' or (v_row->>'id')::uuid is null
        or public.shadow_audit_timestamp_v1(v_row->'created_at') is null then raise exception 'shadow_original_page_mismatch'; end if;
      -- rowDigest above binds the complete actual server id/time/row. Neither
      -- is invented in the pre-write native producer output or excluded from it.
    elsif public.shadow_core_row_matches_v1(p_member,v_family,v_native,v_row) is not true
      then raise exception 'shadow_original_candidate_mismatch'; end if;
    v_payload:=v_row;
  elsif v_ref->>'tag'='candidate_projection' then
    v_raw:=public.shadow_projection_disposition_v1(p_member,v_declaration,p_outcome);
    v_payload:=v_raw->'payload';v_digest:=v_raw->>'digest';
  elsif v_ref->>'tag'='retained_payload' then
    v_raw:=v_planned;v_payload:=public.shadow_inventory_envelope_payload_v1(v_raw);v_digest:=v_raw->>'digest';
    if v_ref->>'envelopeDigest' is distinct from v_digest or (v_ref->>'byteLength')::bigint<>pg_catalog.octet_length(pg_catalog.convert_to(v_raw->>'canonicalPayload','UTF8')) then raise exception 'shadow_retained_payload_identity'; end if;
    if v_ref->>'representation'='producer_text' then
      if pg_catalog.jsonb_typeof(v_payload) is distinct from 'string' or p_outcome->>'retainedEvidenceText' is distinct from v_payload#>>'{}' then raise exception 'shadow_retained_text_identity'; end if;
    elsif v_ref->>'representation'='producer_bytes' then
      if pg_catalog.jsonb_typeof(v_payload) is distinct from 'string' then raise exception 'shadow_retained_bytes_identity'; end if;
      v_bytes:=pg_catalog.decode(v_payload#>>'{}','base64');
      if pg_catalog.replace(pg_catalog.encode(v_bytes,'base64'),E'\n','') is distinct from v_payload#>>'{}' or p_outcome->>'retainedNativePayload' is distinct from v_payload#>>'{}' then raise exception 'shadow_retained_bytes_identity'; end if;
    elsif p_outcome->>'retainedNativePayload' is distinct from v_raw->>'canonicalPayload' then raise exception 'shadow_retained_payload_identity'; end if;
    if p_outcome->>'family' in ('native_structure','cache_inputs') or p_outcome->>'family' in ('attempt_control','repair_audit_inputs') then
      if p_outcome->'retainedEvidenceText'<>'null'::jsonb or p_outcome->'representationVersion'<>'null'::jsonb or p_outcome->'transformVersion'<>'null'::jsonb
        or v_ref->>'mediaType'<>'application/json' or (p_outcome->>'family'='native_structure' and (v_group<>'worker_native' or p_outcome->>'unitKey'<>'extracted-document' or v_ref->>'representation'<>'producer_json'))
        or (p_outcome->>'family'='cache_inputs' and (v_group<>'cache' or v_ref->>'representation'<>'cache_input'))
        or (p_outcome->>'family'='attempt_control' and (v_group<>'control' or p_outcome->>'unitKey' is distinct from p_member.job_id::text or v_ref->>'representation'<>'control_checkpoint'))
        or (p_outcome->>'family'='repair_audit_inputs' and (v_group<>'repair' or p_outcome->>'unitKey'<>'enrichment-repair' or v_ref->>'representation'<>'repair_audit_input'))
        or v_unit.lease_token is distinct from p_member.first_lease_token or v_unit.artifact_generation_id is not null or v_unit.producer is distinct from 'local-worker'
        or v_unit.source_binding is distinct from public.shadow_projection_binding_v1(p_member,null) then raise exception 'shadow_retained_owner_identity'; end if;
      v_payload:=case when p_outcome->>'family'='native_structure'
        then public.shadow_native_structure_payload_v1(p_member,p_manifest,v_declaration,v_planned)
        when p_outcome->>'family'='cache_inputs'
        then public.shadow_cache_input_payload_v1(p_member,p_manifest,v_declaration,p_outcome->>'unitKey',v_planned)
        when p_outcome->>'family'='attempt_control'
        then public.shadow_attempt_control_payload_v1(p_member,v_declaration,v_planned)
        else public.shadow_repair_audit_payload_v1(p_member,v_declaration,v_planned) end;
    end if;
  elsif v_ref->>'tag'='private_object' then
    if p_outcome->>'family'<>'private_objects' or not public.shadow_keys_v1(v_planned,array['tag','ref','bytes']) or v_planned->>'tag' is distinct from 'private_object'
      or v_planned->'ref' is distinct from v_ref or not public.shadow_keys_v1(v_planned->'bytes',array['encoding','content'])
      or v_planned->'bytes'->>'encoding' is distinct from 'base64' or p_outcome->>'retainedNativePayload' is distinct from v_planned->'bytes'->>'content' then raise exception 'shadow_object_evidence_required'; end if;
    v_bytes:=pg_catalog.decode(p_outcome->>'retainedNativePayload','base64');v_digest:='sha256:'||pg_catalog.encode(extensions.digest(v_bytes,'sha256'),'hex');
    if pg_catalog.replace(pg_catalog.encode(v_bytes,'base64'),E'\n','') is distinct from p_outcome->>'retainedNativePayload'
      or v_digest is distinct from v_ref->>'sha256' or pg_catalog.octet_length(v_bytes)::bigint<>(v_ref->>'byteLength')::bigint
      or p_outcome->>'unitKey' is distinct from 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(public.shadow_node_value_text_v1(v_ref),'UTF8'),'sha256'),'hex') then raise exception 'shadow_object_identity'; end if;
    v_row:=public.shadow_candidate_image_attachment_v1(p_member,v_ref);v_payload:=v_planned;
  else raise exception 'shadow_reference_semantics_unavailable'; end if;
  if p_outcome->>'contentDigest' is distinct from v_digest then raise exception 'shadow_content_digest_mismatch'; end if;
  perform public.shadow_validate_inventory_relationships_v1(p_member,p_manifest,p_outcome,v_payload);
end $$;
alter function public.shadow_reconcile_final_disposition_v1(public.document_index_generations,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_reconcile_final_disposition_v1(public.document_index_generations,jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function public.shadow_validate_final_disposition_v1(p_member public.document_index_generations,p_manifest jsonb,p_outcome jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_unit public.document_generation_inventory%rowtype;
begin
  select * into v_unit from public.document_generation_inventory where document_id=p_member.document_id
    and index_generation_id=p_member.index_generation_id and family=p_outcome->>'family' and unit_key=p_outcome->>'unitKey' for update;
  if found and v_unit.disposition<>'pending' then
    if public.shadow_inventory_outcome_v1(v_unit) is distinct from p_outcome then raise exception 'shadow_disposition_changed'; end if;
    return;
  end if;
  perform public.shadow_reconcile_final_disposition_v1(p_member,p_manifest,p_outcome);
end $$;
alter function public.shadow_validate_final_disposition_v1(public.document_index_generations,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_validate_final_disposition_v1(public.document_index_generations,jsonb,jsonb) from public,anon,authenticated,service_role;


create or replace function public.shadow_finalize_inventory_unit_v1(p_member public.document_index_generations,p_outcome jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_unit public.document_generation_inventory%rowtype;
begin
  select * into strict v_unit from public.document_generation_inventory where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id
    and family=p_outcome->>'family' and unit_key=p_outcome->>'unitKey' for update;
  if v_unit.disposition<>'pending' then
    if public.shadow_inventory_outcome_v1(v_unit) is distinct from p_outcome then raise exception 'shadow_disposition_changed'; end if;return false;
  end if;
  update public.document_generation_inventory set disposition=p_outcome->>'disposition',reason_code=p_outcome->>'reasonCode',limitations=p_outcome->'limitations',
    artifact_ref=nullif(p_outcome->'artifactRef','null'::jsonb),content_digest=p_outcome->>'contentDigest',relationships=p_outcome->'relationships',
    retained_evidence_text=p_outcome->>'retainedEvidenceText',retained_native_payload=p_outcome->>'retainedNativePayload',
    representation_version=p_outcome->>'representationVersion',transform_version=p_outcome->>'transformVersion'
    where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id and family=v_unit.family and unit_key=v_unit.unit_key and disposition='pending';
  if not found then raise exception 'shadow_disposition_changed'; end if;return true;
end $$;
alter function public.shadow_finalize_inventory_unit_v1(public.document_index_generations,jsonb) owner to postgres;
revoke all on function public.shadow_finalize_inventory_unit_v1(public.document_index_generations,jsonb) from public,anon,authenticated,service_role;

-- Fixed source-field reconciliation. This is declaration/retention integrity,
-- not terminal receipt or candidate evaluation acceptance.
create or replace function public.shadow_inventory_relationships_v1(p_member public.document_index_generations,p_manifest jsonb,p_outcome jsonb,p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_expected jsonb:='[]'::jsonb;v_spec jsonb;v_value jsonb;v_path jsonb;v_item jsonb;v_edge jsonb;v_target jsonb;v_declaration jsonb;v_batch jsonb;
  v_output jsonb;v_key text;v_tag text;v_family text;v_index bigint;v_count integer;v_d uuid;v_sorted jsonb;v_actual jsonb;
  v_specs jsonb;v_prefix jsonb;v_profile_key text;v_claim_index bigint;v_target_group text;
begin
  if p_outcome->'artifactRef'->>'tag'='origin_row' then
    return '[]'::jsonb;
  end if;
  if p_outcome->'artifactRef'->>'tag'='retained_payload' then
    if p_outcome->>'family'='native_structure' or p_outcome->>'family' in ('attempt_control','repair_audit_inputs') then
      v_expected:='[]'::jsonb;
    elsif p_outcome->>'family'='cache_inputs' then
      v_expected:=pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('tag','input',
        'field',pg_catalog.jsonb_build_array('input','task','image','path'),
        'target',pg_catalog.jsonb_build_object('family','native_structure','key','extracted-document')));
    else
      -- Complete bytes alone do not grant semantics to an unimplemented owner.
      raise exception 'shadow_payload_relationship_semantics_unavailable';
    end if;
  elsif p_outcome->>'disposition' in ('failed','skipped','excluded') and p_outcome->>'family'='native_structure' then
    return '[]'::jsonb;
  elsif p_outcome->'artifactRef'->>'tag' in ('candidate_row','candidate_projection') or (p_outcome->>'disposition' in ('failed','skipped','excluded') and p_outcome->>'family' in ('pages','chunks','images','table_facts','embedding_fields','index_units','sections','memory_cards')) then
    if (p_outcome->>'family' not in ('quality','document_metadata') and pg_catalog.jsonb_typeof(p_payload->'metadata') is distinct from 'object')
      or (p_payload?'metadata' and pg_catalog.jsonb_typeof(p_payload->'metadata') is distinct from 'object')
      or (p_payload->'metadata') ?| array['relationships','source_relationships'] then raise exception 'shadow_relationship_semantics_unavailable'; end if;
    v_specs:='[
      {"path":["source_chunk_id"],"tag":"source_chunk","family":"chunks","array":false},
      {"path":["source_image_id"],"tag":"source_image","family":"images","array":false},
      {"path":["cover_image_id"],"tag":"source_image","family":"images","array":false},
      {"path":["section_id"],"tag":"section","family":"sections","array":false},
      {"path":["image_ids"],"tag":"source_image","family":"images","array":true},
      {"path":["source_image_ids"],"tag":"source_image","family":"images","array":true},
      {"path":["chunk_ids"],"tag":"source_chunk","family":"chunks","array":true},
      {"path":["source_chunk_ids"],"tag":"source_chunk","family":"chunks","array":true},
      {"path":["metadata","chunk_ids"],"tag":"source_chunk","family":"chunks","array":true},
      {"path":["metadata","source_chunk_ids"],"tag":"source_chunk","family":"chunks","array":true},
      {"path":["metadata","source_image_ids"],"tag":"source_image","family":"images","array":true},
      {"path":["metadata","pages"],"tag":"page","family":"pages","array":true},
      {"path":["page_number"],"tag":"page","family":"pages","array":false},
      {"path":["page_start"],"tag":"page","family":"pages","array":false},
      {"path":["page_end"],"tag":"page","family":"pages","array":false}]'::jsonb;
    if p_outcome->>'family'='summary' then
      -- The summary writer has validated the complete structured payload.
      -- Retain each nested source field and array position in its disposition,
      -- including repeated references: equal targets do not erase provenance.
      v_prefix:='["metadata","source_anchored_summary_v1"]'::jsonb;
      for v_spec in select value from pg_catalog.jsonb_array_elements('[
        {"path":["source_chunk_ids"],"tag":"source_chunk","family":"chunks","array":true},
        {"path":["source_image_ids"],"tag":"source_image","family":"images","array":true}]'::jsonb) loop
        v_specs:=v_specs||pg_catalog.jsonb_build_array(v_spec||pg_catalog.jsonb_build_object('path',v_prefix||(v_spec->'path')));
      end loop;
      foreach v_profile_key in array array['applies_to','key_clinical_actions','medication_dose_monitoring','thresholds_timing','escalation_risk_warnings',
        'required_forms_documentation','not_covered','important_tables_images','best_questions','source_quality_notes'] loop
        for v_claim_index in select ord-1 from pg_catalog.jsonb_array_elements(
          p_payload #> array['metadata','source_anchored_summary_v1','clinical_specifics','profile',v_profile_key]) with ordinality a(value,ord) loop
          for v_spec in select value from pg_catalog.jsonb_array_elements('[
            {"path":["source_chunk_ids"],"tag":"source_chunk","family":"chunks","array":true},
            {"path":["source_image_ids"],"tag":"source_image","family":"images","array":true},
            {"path":["pages"],"tag":"page","family":"pages","array":true}]'::jsonb) loop
            v_specs:=v_specs||pg_catalog.jsonb_build_array(v_spec||pg_catalog.jsonb_build_object('path',
              v_prefix||pg_catalog.jsonb_build_array('clinical_specifics','profile',v_profile_key,v_claim_index)||(v_spec->'path')));
          end loop;
        end loop;
      end loop;
    end if;
    for v_spec in select value from pg_catalog.jsonb_array_elements(v_specs) loop
      if p_outcome->>'family'='pages' and v_spec->>'tag'='page' then continue; end if;
      if v_spec->'path'='["metadata","pages"]'::jsonb and p_outcome->>'family'<>'generated_labels' then continue; end if;
      if v_spec->'path'='["cover_image_id"]'::jsonb and p_outcome->>'family'<>'document_metadata' then continue; end if;
      v_path:=v_spec->'path';v_value:=p_payload #> array(select pg_catalog.jsonb_array_elements_text(v_path));
      if v_value is null or v_value='null'::jsonb then continue; end if;
      if v_spec->'array'='true'::jsonb and pg_catalog.jsonb_typeof(v_value) is distinct from 'array' then raise exception 'invalid_shadow_source_array'; end if;
      for v_item,v_index in select value,ord-1 from pg_catalog.jsonb_array_elements(case when v_spec->'array'='true'::jsonb then v_value else pg_catalog.jsonb_build_array(v_value) end) with ordinality a(value,ord) loop
        if v_spec->>'tag'='page' then
          if pg_catalog.jsonb_typeof(v_item) is distinct from 'number' or v_item::text::numeric not between 1 and 9007199254740991 or v_item::text::numeric<>pg_catalog.trunc(v_item::text::numeric) then raise exception 'invalid_shadow_page_link'; end if;
          v_key:=v_item::text;
        else
          if pg_catalog.jsonb_typeof(v_item) is distinct from 'string' or (v_item#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'invalid_shadow_source_link'; end if;
          v_key:=v_item#>>'{}';
          if v_spec->>'tag'='section' then
            select row_payload into v_output from public.shadow_capture_rows_v1(array[p_member.document_id],array[]::uuid[])
              where table_name='document_sections' and row_payload->'id'=v_item;
            if not found then raise exception 'shadow_section_relationship_unavailable'; end if;
            v_key:=public.shadow_deep_row_key_v1(p_member,'sections',v_output);
          end if;
        end if;
        v_expected:=v_expected||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('tag',v_spec->'tag','field',v_path||case when v_spec->'array'='true'::jsonb then pg_catalog.jsonb_build_array(v_index) else '[]'::jsonb end,
          'target',pg_catalog.jsonb_build_object('family',v_spec->'family','key',v_key)));
      end loop;
    end loop;
    if p_payload->'anchor_id' is not null and p_payload->'anchor_id'<>'null'::jsonb then
      if pg_catalog.jsonb_typeof(p_payload->'anchor_id') is distinct from 'string' or pg_catalog.length(p_payload->>'anchor_id')=0
        or (p_payload->'metadata' ? 'anchor_id' and p_payload->'metadata'->'anchor_id' is distinct from p_payload->'anchor_id') then raise exception 'shadow_anchor_identity'; end if;
      v_expected:=v_expected||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('tag','anchor','field',pg_catalog.jsonb_build_array('anchor_id'),
        'target',pg_catalog.jsonb_build_object('family',p_outcome->'family','key',p_outcome->'unitKey'),'value',p_payload->'anchor_id'));
    end if;
    if p_payload->'storage_path' is not null and p_payload->'storage_path'<>'null'::jsonb then
      select count(*),min(u->>'key') into v_count,v_key from pg_catalog.jsonb_array_elements(p_manifest->'families') f
        cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
        cross join lateral pg_catalog.jsonb_array_elements(case when f->>'family'='private_objects' and s->>'state'='declared' then public.shadow_inventory_envelope_payload_v1(s->'declaration'->'outputManifestEnvelope')->'units' else '[]'::jsonb end) u
        where f->>'family'='private_objects' and s->>'state'='declared' and u->>'family'='private_objects' and u->'output'->'ref'->'objectPath'=p_payload->'storage_path';
      if v_count<>1 then raise exception 'shadow_object_relationship_unavailable'; end if;
      v_expected:=v_expected||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('tag','private_object','field',pg_catalog.jsonb_build_array('storage_path'),'target',pg_catalog.jsonb_build_object('family','private_objects','key',v_key)));
    end if;
  elsif p_outcome->'artifactRef'->>'tag'='private_object' then
    v_output:=public.shadow_candidate_image_attachment_v1(p_member,p_payload->'ref');v_key:=v_output->>'id';
    v_expected:=pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('tag','input','field',pg_catalog.jsonb_build_array('ref','objectPath'),'target',pg_catalog.jsonb_build_object('family','images','key',v_key)));
  else raise exception 'shadow_relationship_semantics_unavailable'; end if;
  select coalesce(pg_catalog.jsonb_agg(value order by public.shadow_node_value_text_v1(value)),'[]'::jsonb) into v_sorted from pg_catalog.jsonb_array_elements(v_expected);
  for v_edge in select value from pg_catalog.jsonb_array_elements(v_expected) loop
    v_target:=v_edge->'target';v_family:=v_target->>'family';v_key:=v_target->>'key';
    select count(*) into v_count from pg_catalog.jsonb_array_elements(p_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
      where f->>'family'=v_family and s->>'state'='declared' and s->'declaration'->'population'->>'tag'='known'
      and s->'declaration'->'population'->'expectedUnits' @> pg_catalog.jsonb_build_array(v_target);
    if v_count<>1 then raise exception 'shadow_relationship_target_undeclared'; end if;
    select s->'declaration',s->>'groupKey' into v_declaration,v_target_group from pg_catalog.jsonb_array_elements(p_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
      where f->>'family'=v_family and s->>'state'='declared' and s->'declaration'->'population'->'expectedUnits' @> pg_catalog.jsonb_build_array(v_target);
    v_d:=(v_declaration->>'artifactGenerationId')::uuid;
    v_batch:=public.shadow_inventory_envelope_payload_v1(v_declaration->'outputManifestEnvelope');
    if v_batch->'binding' is distinct from pg_catalog.jsonb_build_object('tag','candidate','source',p_member.source_binding,'candidateGenerationId',p_member.index_generation_id,'jobId',p_member.job_id,'firstLeaseToken',p_member.first_lease_token,'artifactGenerationId',v_d)
      or (v_family='sections' and (v_d is null or v_declaration->'producer'->>'name' is distinct from 'local-worker'))
      or (v_family in ('chunks','images','pages') and v_d is not null)
      or (v_family='native_structure' and (v_d is not null or v_target_group<>'worker_native' or v_declaration->'producer'->>'name' is distinct from 'local-worker'))
      then raise exception 'shadow_relationship_target_identity'; end if;
    -- Targets may still be pending: retaining both ends of a reciprocal edge
    -- must not depend on which unit is finalized first. Seal must later resolve
    -- all final refs and the complete D receipt; this grants no such acceptance.
  end loop;
  return v_sorted;
end $$;
alter function public.shadow_inventory_relationships_v1(public.document_index_generations,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_inventory_relationships_v1(public.document_index_generations,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function public.shadow_validate_inventory_relationships_v1(p_member public.document_index_generations,p_manifest jsonb,p_outcome jsonb,p_payload jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_expected jsonb;v_actual jsonb;
begin
  v_expected:=public.shadow_inventory_relationships_v1(p_member,p_manifest,p_outcome,p_payload);
  select coalesce(pg_catalog.jsonb_agg(value order by public.shadow_node_value_text_v1(value)),'[]'::jsonb)
    into v_actual from pg_catalog.jsonb_array_elements(p_outcome->'relationships');
  if v_expected is distinct from v_actual then raise exception 'shadow_relationship_population_mismatch'; end if;
end $$;
alter function public.shadow_validate_inventory_relationships_v1(public.document_index_generations,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_validate_inventory_relationships_v1(public.document_index_generations,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Derive only complete retained outcomes. No missing row is interpreted as a
-- skipped/failed producer, and an immutable final outcome is revalidated at seal.
create or replace function public.shadow_finalize_retained_inventory_v1(p_member public.document_index_generations)
returns void language plpgsql security definer set search_path = '' as $$
declare v_unit public.document_generation_inventory%rowtype;v_projection public.document_generation_projections%rowtype;v_job public.ingestion_jobs%rowtype;
  v_declaration jsonb;v_batch jsonb;v_planned jsonb;v_rows jsonb;v_row jsonb;v_payload jsonb;v_ref jsonb;v_outcome jsonb;
  v_outcomes jsonb:='[]'::jsonb;v_raw jsonb;v_capture jsonb;v_group text;v_table text;v_owner text;v_slot text;
  v_digest text;v_native text;v_representation text;v_text text;v_count bigint;v_d uuid;v_item_id jsonb;
begin
  if p_member.state<>'building' or p_member.expected_inventory_digest is null or p_member.first_lease_token is null
    or p_member.control_snapshot is distinct from public.shadow_control_snapshot_v1(p_member.job_id,p_member.control_revision)
    or pg_catalog.jsonb_path_exists(p_member.inventory_manifest,'$.families[*].groups[*] ? (@.state == "pending")')
    then raise exception 'shadow_final_inventory_not_ready'; end if;
  select * into strict v_job from public.ingestion_jobs where id=p_member.job_id for update;
  if v_job.status<>'processing' or v_job.attempt_count<>1 or v_job.max_attempts<>1 or v_job.batch_id is not null
    or v_job.operation<>'shadow_reindex' or v_job.document_id is distinct from p_member.document_id
    or v_job.lease_token is distinct from p_member.first_lease_token or v_job.locked_by is null or v_job.locked_at is null
    or v_job.lease_expected_generation_id is distinct from p_member.baseline_generation_id
    or v_job.lease_write_generation_id is distinct from p_member.index_generation_id
    or v_job.requested_generation_id is distinct from p_member.index_generation_id
    or v_job.lease_authority_digest is distinct from p_member.authority_digest
    or v_job.lease_expires_at is null or v_job.lease_expires_at<=pg_catalog.clock_timestamp()
    then raise exception 'shadow_final_attempt_not_current'; end if;
  select * into strict v_projection from public.document_generation_projections
    where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id for update;
  if v_projection.sealed_at is not null then raise exception 'shadow_final_projection_already_sealed'; end if;
  perform public.shadow_validate_projection_components_v1(p_member,v_projection);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',table_name,'row',row_payload)),'[]'::jsonb)
    into v_rows from public.shadow_capture_rows_v1(array[p_member.document_id],array[]::uuid[])
    where table_name in ('document_pages','document_chunks','document_images','document_table_facts','document_embedding_fields',
      'document_index_units','document_sections','document_memory_cards')
      and row_payload->>'index_generation_id'=p_member.index_generation_id::text;
  for v_unit in select * from public.document_generation_inventory where document_id=p_member.document_id
    and index_generation_id=p_member.index_generation_id
    order by public.shadow_utf16_order_v1(family),public.shadow_utf16_order_v1(unit_key) for update loop
    if v_unit.disposition<>'pending' then
      v_outcome:=public.shadow_inventory_outcome_v1(v_unit);
      perform public.shadow_reconcile_final_disposition_v1(p_member,p_member.inventory_manifest,v_outcome);
      v_outcomes:=v_outcomes||pg_catalog.jsonb_build_array(v_outcome);
      continue;
    end if;
    select count(*),pg_catalog.jsonb_agg(s->'declaration')->0,min(s->>'groupKey') into v_count,v_declaration,v_group
      from pg_catalog.jsonb_array_elements(p_member.inventory_manifest->'families') f
      cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
      where f->>'family'=v_unit.family and s->>'state'='declared' and s->'declaration'->'population'->>'tag'='known'
      and s->'declaration'->'population'->'expectedUnits' @>
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('family',v_unit.family,'key',v_unit.unit_key));
    if v_count<>1 then raise exception 'shadow_final_declaration_population'; end if;
    v_batch:=public.shadow_inventory_envelope_payload_v1(v_declaration->'outputManifestEnvelope');
    select count(*),pg_catalog.jsonb_agg(value->'output')->0 into v_count,v_planned from pg_catalog.jsonb_array_elements(v_batch->'units')
      where value->>'family'=v_unit.family and value->>'key'=v_unit.unit_key;
    if v_count<>1 then raise exception 'shadow_final_planned_population'; end if;
    v_d:=(v_declaration->>'artifactGenerationId')::uuid;
    v_outcome:=pg_catalog.jsonb_build_object('family',v_unit.family,'unitKey',v_unit.unit_key,'disposition','retained',
      'reasonCode',null,'limitations','[]'::jsonb,'artifactRef',null,'contentDigest',null,'relationships','[]'::jsonb,
      'retainedEvidenceText',null,'retainedNativePayload',null,'representationVersion',null,'transformVersion',null);
    if v_unit.family in ('native_structure','cache_inputs','attempt_control','repair_audit_inputs') then
      v_raw:=v_planned;v_payload:=public.shadow_inventory_envelope_payload_v1(v_raw);v_digest:=v_raw->>'digest';
      v_representation:=case v_unit.family when 'cache_inputs' then 'cache_input' when 'attempt_control' then 'control_checkpoint'
        when 'repair_audit_inputs' then 'repair_audit_input' else 'producer_json' end;
      v_ref:=pg_catalog.jsonb_build_object('tag','retained_payload','envelopeDigest',v_digest,'representation',v_representation,
        'mediaType','application/json','byteLength',pg_catalog.octet_length(pg_catalog.convert_to(v_raw->>'canonicalPayload','UTF8')));
      v_native:=v_raw->>'canonicalPayload';
    elsif v_unit.family='private_objects' then
      v_payload:=v_planned;v_ref:=v_planned->'ref';v_digest:=v_ref->>'sha256';v_native:=v_planned->'bytes'->>'content';
    else
      -- Reconstruct only the wrapper of the exact planned value; original nested
      -- envelopes and own-undefined capture bytes remain unchanged inside it.
      v_text:=public.shadow_node_value_text_v1(v_planned);
      v_raw:=pg_catalog.jsonb_build_object('version',1,'domain','u04-retained-evidence-v1','encoding','node-json-v1',
        'canonicalPayload',v_text,'digest','sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          E'U04-SHADOW/1\nu04-retained-evidence-v1\nnode-json-v1\n'||pg_catalog.octet_length(pg_catalog.convert_to(v_text,'UTF8'))::text||E'\n'||v_text,'UTF8'),'sha256'),'hex'));
      v_native:=public.shadow_node_value_text_v1(v_raw);
      if v_unit.family in ('summary','generated_labels','quality','document_metadata','producer_aliases') then
        v_slot:=case v_unit.family when 'document_metadata' then 'worker_metadata' else v_unit.family end;
        v_item_id:='null'::jsonb;
        if v_unit.family='generated_labels' then
          select count(*),pg_catalog.jsonb_agg(value)->0 into v_count,v_payload from pg_catalog.jsonb_array_elements(v_projection.generated_labels)
            where public.shadow_node_value_text_v1(pg_catalog.jsonb_build_object('label',value->'label','label_type',value->'label_type'))=v_unit.unit_key;
          if v_count<>1 then raise exception 'shadow_final_projection_population'; end if;
          v_item_id:=v_payload->'id';
        elsif v_unit.family='producer_aliases' then
          select count(*),pg_catalog.jsonb_agg(value)->0 into v_count,v_payload
            from pg_catalog.jsonb_array_elements(v_projection.producer_aliases) with ordinality a(value,ord)
            where 'deep:'||(ord-1)::text=v_unit.unit_key;
          if v_count<>1 then raise exception 'shadow_final_projection_population'; end if;
          v_item_id:=v_payload->'id';
        else
          v_payload:=case v_unit.family when 'summary' then v_projection.summary when 'quality' then v_projection.quality else v_projection.worker_metadata end;
        end if;
        if v_payload is null or v_payload='null'::jsonb then raise exception 'shadow_final_projection_required'; end if;
        v_digest:=public.shadow_pg_bundle_v1(v_payload,'projection')->>'digest';
        v_ref:=pg_catalog.jsonb_build_object('tag','candidate_projection','slot',v_slot,'itemId',v_item_id,'payloadDigest',v_digest);
      else
        v_table:=case v_unit.family when 'pages' then 'document_pages' when 'chunks' then 'document_chunks' when 'images' then 'document_images'
          when 'table_facts' then 'document_table_facts' when 'embedding_fields' then 'document_embedding_fields' when 'index_units' then 'document_index_units'
          when 'sections' then 'document_sections' when 'memory_cards' then 'document_memory_cards' end;
        v_owner:=case v_unit.family when 'pages' then 'page' when 'chunks' then 'chunk' when 'images' then 'image'
          when 'table_facts' then 'table_fact' when 'embedding_fields' then 'embedding_field' when 'index_units' then 'index_unit'
          when 'sections' then 'section' when 'memory_cards' then 'memory_card' end;
        if v_table is null then raise exception 'shadow_final_owner_unavailable'; end if;
        select count(*),pg_catalog.jsonb_agg(value->'row')->0 into v_count,v_row from pg_catalog.jsonb_array_elements(v_rows)
          where value->>'table'=v_table and case when v_unit.family='pages' then value->'row'->>'page_number'=v_unit.unit_key
            when v_d is not null then public.shadow_deep_row_key_v1(p_member,v_unit.family,value->'row')=v_unit.unit_key
            else value->'row'->>'id'=v_unit.unit_key end;
        if v_count<>1 then raise exception 'shadow_final_candidate_population'; end if;
        v_payload:=v_row;v_digest:=public.shadow_capture_envelope_v1(v_row)->>'digest';
        v_ref:=pg_catalog.jsonb_build_object('tag','candidate_row','owner',v_owner,'rowId',v_row->'id','rowDigest',v_digest);
      end if;
    end if;
    v_outcome:=v_outcome||pg_catalog.jsonb_build_object('artifactRef',v_ref,'contentDigest',v_digest,'retainedNativePayload',v_native);
    v_outcome:=v_outcome||pg_catalog.jsonb_build_object('relationships',
      public.shadow_inventory_relationships_v1(p_member,p_member.inventory_manifest,v_outcome,v_payload));
    perform public.shadow_reconcile_final_disposition_v1(p_member,p_member.inventory_manifest,v_outcome);
    v_outcomes:=v_outcomes||pg_catalog.jsonb_build_array(v_outcome);
  end loop;
  -- Complete preflight precedes every effect; the enclosing fixed seal is atomic.
  for v_outcome in select value from pg_catalog.jsonb_array_elements(v_outcomes) loop
    perform public.shadow_finalize_inventory_unit_v1(p_member,v_outcome);
  end loop;
end $$;
alter function public.shadow_finalize_retained_inventory_v1(public.document_index_generations) owner to postgres;
revoke all on function public.shadow_finalize_retained_inventory_v1(public.document_index_generations) from public,anon,authenticated,service_role;


create or replace function public.write_shadow_generation_pages(p_fence jsonb,p_generation uuid,p_pages jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.document_index_generations%rowtype;v_profile jsonb;v_page jsonb;v_metadata jsonb;v_existing public.document_pages%rowtype;v_count bigint;v_bytes bigint;v_output jsonb;v_declaration jsonb;
begin
  v_member:=public.shadow_assert_attempt_v1(p_fence,p_generation,null);
  v_profile:=public.shadow_profile_capture_v1((v_member.original_origin_envelope->>'canonicalPayload')::jsonb->'executionProfileEnvelope');
  if pg_catalog.jsonb_typeof(p_pages) is distinct from 'array' then raise exception 'invalid_shadow_pages'; end if;
  v_count:=pg_catalog.jsonb_array_length(p_pages);v_bytes:=pg_catalog.octet_length(pg_catalog.convert_to(p_pages::text,'UTF8'));
  if v_count>least(2000,(v_profile->'limits'->>'maxAppendRows')::bigint) or v_bytes>least(16777216,(v_profile->'limits'->>'maxAppendBytes')::bigint) then raise exception 'shadow_append_too_large'; end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_pages))<>(select count(distinct value->'page_number') from pg_catalog.jsonb_array_elements(p_pages)) then raise exception 'shadow_duplicate_page'; end if;
  for v_page in select value from pg_catalog.jsonb_array_elements(p_pages) loop
    if not public.shadow_keys_v1(v_page,array['document_id','page_number','text','ocr_used','metadata'])
      or v_page->>'document_id' is distinct from v_member.document_id::text or pg_catalog.jsonb_typeof(v_page->'page_number') is distinct from 'number'
      or v_page->>'page_number' !~ '^[1-9][0-9]*$' or (v_page->>'page_number')::numeric>2147483647
      or pg_catalog.jsonb_typeof(v_page->'text') is distinct from 'string' or pg_catalog.jsonb_typeof(v_page->'ocr_used') is distinct from 'boolean'
      or pg_catalog.jsonb_typeof(v_page->'metadata') is distinct from 'object' then raise exception 'invalid_shadow_page'; end if;
    if not exists(select 1 from public.document_generation_inventory i where i.document_id=v_member.document_id and i.index_generation_id=p_generation
      and i.family='pages' and i.unit_key=v_page->>'page_number' and i.disposition='pending' and i.artifact_generation_id is null and i.lease_token=v_member.first_lease_token) then raise exception 'shadow_page_declaration_required'; end if;
    select s->'declaration' into v_declaration from pg_catalog.jsonb_array_elements(v_member.inventory_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
      where f->>'family'='pages' and s->>'groupKey'='worker_core' and s->>'state'='declared';
    if not found then raise exception 'shadow_page_declaration_required'; end if;
    select u->'output' into v_output from pg_catalog.jsonb_array_elements(public.shadow_inventory_envelope_payload_v1(v_declaration->'outputManifestEnvelope')->'units') u
      where u->>'family'='pages' and u->>'key'=v_page->>'page_number';
    if not found or public.shadow_page_producer_input_v1(v_output,v_member.document_id) is distinct from v_page then raise exception 'shadow_page_planned_input_mismatch'; end if;
    v_metadata:=v_page->'metadata'||pg_catalog.jsonb_build_object('index_generation_id',p_generation,'ingestion_job_kind','node','ingestion_job_id',v_member.job_id,'ingestion_lease_token',v_member.first_lease_token);
    select * into v_existing from public.document_pages where document_id=v_member.document_id and index_generation_id=p_generation and page_number=(v_page->>'page_number')::integer;
    if found and (v_existing.text is distinct from v_page->>'text' or v_existing.ocr_used is distinct from (v_page->>'ocr_used')::boolean or v_existing.metadata is distinct from v_metadata) then raise exception 'shadow_page_changed'; end if;
  end loop;
  insert into public.document_pages(document_id,index_generation_id,page_number,text,ocr_used,metadata)
    select v_member.document_id,p_generation,(p->>'page_number')::integer,p->>'text',(p->>'ocr_used')::boolean,
      p->'metadata'||pg_catalog.jsonb_build_object('index_generation_id',p_generation,'ingestion_job_kind','node','ingestion_job_id',v_member.job_id,'ingestion_lease_token',v_member.first_lease_token)
    from pg_catalog.jsonb_array_elements(p_pages) p where not exists(select 1 from public.document_pages old where old.document_id=v_member.document_id and old.index_generation_id=p_generation and old.page_number=(p->>'page_number')::integer);
  return pg_catalog.jsonb_build_object('ok',true,'index_generation_id',p_generation,'terminal_acceptance','unavailable');
exception when others then raise exception 'invalid_shadow_page_write' using errcode='22023';
end $$;
alter function public.write_shadow_generation_pages(jsonb,uuid,jsonb) owner to postgres;
revoke all on function public.write_shadow_generation_pages(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;

-- Exact existing worker page input plus complete ExtractedPage. Server-generated
-- id/created_at and owned fencing stamps are a separate captured row witness.
create or replace function public.shadow_page_producer_input_v1(p_output jsonb,p_document uuid)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_input jsonb;v_native jsonb;v_key text;
begin
  if not public.shadow_keys_v1(p_output,array['input','extractedPage']) then raise exception 'shadow_full_native_page_required'; end if;
  v_input:=p_output->'input';v_native:=p_output->'extractedPage';
  if not public.shadow_keys_v1(v_input,array['document_id','page_number','text','ocr_used','metadata'])
    or v_input->>'document_id' is distinct from p_document::text or pg_catalog.jsonb_typeof(v_input->'page_number') is distinct from 'number'
    or v_input->>'page_number' !~ '^[1-9][0-9]*$' or (v_input->>'page_number')::numeric>2147483647
    or pg_catalog.jsonb_typeof(v_input->'text') is distinct from 'string' or pg_catalog.jsonb_typeof(v_input->'ocr_used') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(v_input->'metadata') is distinct from 'object' then raise exception 'invalid_shadow_page_input'; end if;
  if pg_catalog.jsonb_typeof(v_native) is distinct from 'object' or not (v_native ?& array['pageNumber','text'])
    or v_native-array['pageNumber','text','ocrUsed','needsOcr']<>'{}'::jsonb or v_native->'pageNumber' is distinct from v_input->'page_number'
    or pg_catalog.jsonb_typeof(v_native->'text') is distinct from 'string' then raise exception 'invalid_shadow_native_page'; end if;
  foreach v_key in array array['ocrUsed','needsOcr'] loop
    if v_native ? v_key and pg_catalog.jsonb_typeof(v_native->v_key) is distinct from 'boolean' then raise exception 'invalid_shadow_native_page'; end if;
  end loop;
  -- Node cleanString removes literal backslash-u0000; actual U+0000 or invalid
  -- Unicode cannot enter PostgreSQL JSONB and therefore refuses, without losing
  -- or rewriting the original full envelope to manufacture representability.
  if v_input->>'text' is distinct from pg_catalog.replace(v_native->>'text',E'\\u0000','')
    or v_input->'ocr_used' is distinct from coalesce(v_native->'ocrUsed','false'::jsonb) then raise exception 'shadow_page_input_transform_mismatch'; end if;
  return v_input;
end $$;
alter function public.shadow_page_producer_input_v1(jsonb,uuid) owner to postgres;
revoke all on function public.shadow_page_producer_input_v1(jsonb,uuid) from public,anon,authenticated,service_role;

-- Narrow global D serialization, shared with the invoker artifact trigger.
-- A collision in the fixed advisory hash can only refuse/serialize extra work.
create or replace function public.shadow_reserve_producer_d_v1(p_member public.document_index_generations,p_declaration jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_d uuid;v_existing jsonb;v_row jsonb;v_reuse boolean:=false;
begin
  v_d:=(p_declaration->>'artifactGenerationId')::uuid;
  if v_d is null then return; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('u04-artifact-generation:'||v_d::text,0)) then raise exception 'shadow_producer_generation_busy'; end if;
  if p_declaration->'producer'->>'name' is distinct from 'local-worker' then raise exception 'shadow_producer_generation_identity'; end if;
  if exists(select 1 from public.ingestion_job_stages st join public.document_index_generations g
    on g.job_id=st.job_id and g.document_id=st.document_id
    where public.shadow_failed_artifact_generation_v1(st,g,1)=v_d)
    then raise exception 'shadow_producer_generation_owned'; end if;
  for v_existing in select pg_catalog.jsonb_build_object('documentId',g.document_id,'candidateGenerationId',g.index_generation_id,'declaration',s->'declaration')
    from public.document_index_generations g cross join lateral pg_catalog.jsonb_array_elements(g.inventory_manifest->'families') f
      cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where s->'declaration'->>'artifactGenerationId'=v_d::text loop
    if v_existing->>'documentId' is distinct from p_member.document_id::text or v_existing->>'candidateGenerationId' is distinct from p_member.index_generation_id::text
      or v_existing->'declaration'->'producer' is distinct from p_declaration->'producer'
      or v_existing->'declaration'->'outputManifestEnvelope' is distinct from p_declaration->'outputManifestEnvelope'
      or v_existing->'declaration'->'firstLeaseToken' is distinct from p_declaration->'firstLeaseToken' then raise exception 'shadow_producer_generation_owned'; end if;
    v_reuse:=true;
  end loop;
  if exists(select 1 from public.document_index_generations where index_generation_id=v_d or baseline_generation_id=v_d)
    or exists(select 1 from public.documents where index_generation_id=v_d) then raise exception 'shadow_producer_generation_occupied'; end if;
  -- Every actual stored generation namespace is covered. This is fixed SQL,
  -- without an append-wide relation barrier or caller-supplied table dispatch.
  for v_row in
    select pg_catalog.to_jsonb(r) from public.document_pages r where r.index_generation_id=v_d
    union all select pg_catalog.to_jsonb(r) from public.document_chunks r where r.index_generation_id=v_d
    union all select pg_catalog.to_jsonb(r) from public.document_images r where r.index_generation_id=v_d
    union all select pg_catalog.to_jsonb(r) from public.document_table_facts r where r.index_generation_id=v_d
    union all select pg_catalog.to_jsonb(r) from public.document_embedding_fields r where r.index_generation_id=v_d
    union all select pg_catalog.to_jsonb(r) from public.document_index_units r where r.index_generation_id=v_d or r.artifact_generation_id=v_d
    union all select pg_catalog.to_jsonb(r) from public.document_sections r where r.index_generation_id=v_d or r.artifact_generation_id=v_d
    union all select pg_catalog.to_jsonb(r) from public.document_memory_cards r where r.index_generation_id=v_d or r.artifact_generation_id=v_d loop
    if not v_reuse or v_row->>'document_id' is distinct from p_member.document_id::text or v_row->>'producer' is distinct from 'local-worker'
      or v_row->>'artifact_generation_id' is distinct from v_d::text or v_row->'metadata'->>'artifact_generation_id' is distinct from v_d::text
      or v_row->'metadata'->>'ingestion_lease_token' is distinct from p_member.first_lease_token::text then raise exception 'shadow_producer_generation_occupied'; end if;
  end loop;
end $$;
alter function public.shadow_reserve_producer_d_v1(public.document_index_generations,jsonb) owner to postgres;
revoke all on function public.shadow_reserve_producer_d_v1(public.document_index_generations,jsonb) from public,anon,authenticated,service_role;

-- Supported limitation evidence is the exact retained full producer batch.
-- Other existing reference variants remain representable but require their
-- owner resolver; accepting a shape alone would make fabricated facts immutable.
create or replace function public.shadow_resolve_batch_pointer_v1(p_pointer jsonb,p_envelope jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_value jsonb;v_component jsonb;v_ref jsonb;
begin
  perform public.shadow_inventory_pointer_v1(p_pointer);v_ref:=p_pointer->'ref';
  v_value:=public.shadow_inventory_envelope_payload_v1(p_envelope);
  if v_ref->>'tag' is distinct from 'retained_payload' or v_ref->'envelopeDigest' is distinct from p_envelope->'digest'
    or v_ref->>'representation' is distinct from 'producer_json'
    or (v_ref->>'byteLength')::numeric<>pg_catalog.octet_length(pg_catalog.convert_to(p_envelope->>'canonicalPayload','UTF8')) then raise exception 'shadow_limitation_evidence_unavailable'; end if;
  for v_component in select value from pg_catalog.jsonb_array_elements(p_pointer->'path') loop
    if pg_catalog.jsonb_typeof(v_component)='number' and pg_catalog.jsonb_typeof(v_value)='array' then
      if v_component::text::numeric>=pg_catalog.jsonb_array_length(v_value) then raise exception 'shadow_limitation_path_unavailable'; end if;
      v_value:=v_value->(v_component::text::integer);
    elsif pg_catalog.jsonb_typeof(v_component)='string' and pg_catalog.jsonb_typeof(v_value)='object' then v_value:=v_value->(v_component#>>'{}');
    else raise exception 'shadow_limitation_path_unavailable'; end if;
    if v_value is null then raise exception 'shadow_limitation_path_unavailable'; end if;
  end loop;
  return v_value;
end $$;
alter function public.shadow_resolve_batch_pointer_v1(jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_resolve_batch_pointer_v1(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_candidate_image_attachment_v1(p_member public.document_index_generations,p_ref jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row jsonb;v_count integer;
begin
  select count(*),pg_catalog.jsonb_agg(row_payload)->0 into v_count,v_row from public.shadow_capture_rows_v1(array[p_member.document_id],array[]::uuid[])
    where table_name='document_images' and row_payload->'storage_path'=p_ref->'objectPath';
  if v_count<>1 or v_row->>'document_id' is distinct from p_member.document_id::text or v_row->>'index_generation_id' is distinct from p_member.index_generation_id::text
    or v_row->'metadata'->>'index_generation_id' is distinct from p_member.index_generation_id::text
    or v_row->'metadata'->>'ingestion_job_kind' is distinct from 'node' or v_row->'metadata'->>'ingestion_job_id' is distinct from p_member.job_id::text
    or v_row->'metadata'->>'ingestion_lease_token' is distinct from p_member.first_lease_token::text
    or pg_catalog.jsonb_typeof(v_row->'image_hash') is distinct from 'string' or pg_catalog.length(v_row->>'image_hash')<>64 or v_row->>'image_hash' !~ '^[0-9a-f]{64}$'
    or v_row->'metadata'->>'extractor' is distinct from 'local-worker' or v_row->'metadata'->'image_hash' is distinct from v_row->'image_hash'
    or p_ref->'mediaType' is distinct from v_row->'mime_type' or p_ref->>'sha256' is distinct from 'sha256:'||(v_row->>'image_hash') then raise exception 'shadow_object_attachment_unavailable'; end if;
  if not exists(select 1 from public.document_generation_inventory i where i.document_id=p_member.document_id and i.index_generation_id=p_member.index_generation_id
    and i.family='images' and i.unit_key=v_row->>'id' and i.lease_token=p_member.first_lease_token and i.source_binding->'source'=p_member.source_binding)
    then raise exception 'shadow_object_attachment_undeclared'; end if;
  return v_row;
end $$;
alter function public.shadow_candidate_image_attachment_v1(public.document_index_generations,jsonb) owner to postgres;
revoke all on function public.shadow_candidate_image_attachment_v1(public.document_index_generations,jsonb) from public,anon,authenticated,service_role;

-- U04 immutable expired-wave restart. These helpers confer no caller authority.
create or replace function public.shadow_queue_complete_v1(p_job uuid)
returns public.document_index_generations language plpgsql volatile set search_path = '' as $$
declare j public.ingestion_jobs%rowtype; g public.document_index_generations%rowtype; w public.shadow_reindex_waves%rowtype;
  b public.document_generation_baselines%rowtype; pr public.document_generation_projections%rowtype;
  p jsonb; s jsonb; r jsonb; f jsonb; v_preseal jsonb; v_terminal jsonb; v_dispositions jsonb; v_limitations jsonb;
  v_status boolean; v_expected_count bigint; v_actual_count bigint;
begin
  select * into strict j from public.ingestion_jobs where id=p_job;
  select * into strict g from public.document_index_generations where job_id=p_job;
  select * into strict w from public.shadow_reindex_waves where candidate_generation_id=g.index_generation_id;
  select * into strict b from public.document_generation_baselines where document_id=g.document_id and candidate_generation_id=g.index_generation_id;
  p:=public.validate_shadow_plan_v1(w.plan_payload);
  select value into strict s from pg_catalog.jsonb_array_elements((public.shadow_node_payload_v1(w.baseline_report,'evaluation_report'))->'sourceBindings')
    where value->>'documentId'=g.document_id::text;
  if j.operation is distinct from 'shadow_reindex' or j.document_id is distinct from g.document_id or j.requested_generation_id is distinct from g.index_generation_id
    or j.shadow_plan_digest is distinct from w.plan_digest or j.batch_id is not null or j.max_attempts is distinct from 1
    or w.plan_payload->>'digest' is distinct from w.plan_digest or p->'plan'->>'candidateGenerationId' is distinct from g.index_generation_id::text
    or g.source_binding is distinct from s or s->>'ownerId' is distinct from g.owner_id::text
    or s->>'baselineGenerationId' is distinct from g.baseline_generation_id::text or s->>'authorityDigest' is distinct from g.authority_digest
    or g.original_origin_envelope is distinct from p->'audit'->'input'->'originEnvelope'
    or g.expected_state_digest is distinct from pg_catalog.substr(g.original_origin_envelope->>'digest',8)
    or b.baseline_generation_id is distinct from g.baseline_generation_id or b.expected_state_digest is distinct from g.expected_state_digest
    or b.bundle_digest is distinct from g.baseline_bundle_digest or b.bundle_payload->>'digest' is distinct from b.bundle_digest
    or not coalesce(public.shadow_generation_envelope_valid(b.bundle_payload,'baseline','pg-jsonb-text-v1'),false)
    or (b.bundle_payload->>'canonicalPayload')::jsonb->'parameters'->'p_plan' is distinct from w.plan_payload
    or (b.bundle_payload->>'canonicalPayload')::jsonb->'parameters'->'p_baseline_evaluation' is distinct from w.baseline_report
    or g.control_snapshot is distinct from public.shadow_control_snapshot_v1(j.id,g.control_revision) then raise exception 'shadow_queue_incomplete'; end if;
  v_status:=false;
  if g.state='reserved' then
    v_status:=j.status='pending' and j.stage='queued' and j.progress=0 and j.attempt_count=0 and g.control_revision=0
      and g.first_lease_token is null and g.claimed_at is null and j.lease_token is null and j.locked_by is null and j.locked_at is null
      and j.lease_expected_generation_id is null and j.lease_write_generation_id is null and j.lease_authority_digest is null
      and j.lease_expires_at is null and j.lease_duration_seconds is null and j.next_run_at is not null and pg_catalog.isfinite(j.next_run_at)
      and j.completed_at is null and g.control_snapshot->'ownStages'='[]'::jsonb
      and g.inventory_digest is null and g.candidate_projection_digest is null and g.stage_receipt is null
      and g.stage_receipt_digest is null and g.staged_at is null
      and not exists(select 1 from public.document_generation_projections where document_id=g.document_id
        and index_generation_id=g.index_generation_id and sealed_at is not null);
  elsif g.state='building' then
    v_status:=j.attempt_count=1 and g.control_revision>=1 and g.first_lease_token is not null and j.lease_token=g.first_lease_token
      and g.claimed_at is not null and pg_catalog.isfinite(g.claimed_at) and j.lease_expected_generation_id is not distinct from g.baseline_generation_id
      and j.lease_write_generation_id=g.index_generation_id and j.lease_authority_digest=g.authority_digest
      and j.lease_expires_at is not null and pg_catalog.isfinite(j.lease_expires_at) and j.lease_duration_seconds>0 and j.next_run_at is null
      and ((j.status='processing' and j.locked_by is not null and j.locked_by<>'' and j.locked_at is not null and pg_catalog.isfinite(j.locked_at) and j.completed_at is null)
        or (j.status='failed' and j.stage='shadow_failed' and j.locked_by is null and j.locked_at is null and j.completed_at is not null and pg_catalog.isfinite(j.completed_at)
          and j.error_message is not null and pg_catalog.length(j.error_message)>0 and pg_catalog.octet_length(public.shadow_utf16_order_v1(j.error_message))/2<=65536))
      and g.inventory_digest is null and g.candidate_projection_digest is null and g.stage_receipt is null
      and g.stage_receipt_digest is null and g.staged_at is null
      and not exists(select 1 from public.document_generation_projections where document_id=g.document_id
        and index_generation_id=g.index_generation_id and sealed_at is not null);
  elsif g.state='staged' then
    select * into strict pr from public.document_generation_projections where document_id=g.document_id and index_generation_id=g.index_generation_id;
    r:=public.shadow_inventory_envelope_payload_v1(g.stage_receipt);
    f:=public.shadow_inventory_envelope_payload_v1(r->'finalInventoryEnvelope');
    v_preseal:=public.shadow_inventory_envelope_payload_v1(f->'preSealControlEnvelope');
    v_terminal:=public.shadow_inventory_envelope_payload_v1(r->'terminalControlEnvelope');
    select count(*) into v_expected_count from pg_catalog.jsonb_array_elements(g.inventory_manifest->'families') family
      cross join lateral pg_catalog.jsonb_array_elements(family->'groups') grp
      cross join lateral pg_catalog.jsonb_array_elements(case when grp->>'state'='declared' and grp->'declaration'->'population'->>'tag'='known'
        then grp->'declaration'->'population'->'expectedUnits' else '[]'::jsonb end) unit;
    select count(*),coalesce(pg_catalog.jsonb_agg(public.shadow_inventory_outcome_v1(i)
      order by public.shadow_utf16_order_v1(i.family),public.shadow_utf16_order_v1(i.unit_key)),'[]'::jsonb)
      into v_actual_count,v_dispositions from public.document_generation_inventory i
      where i.document_id=g.document_id and i.index_generation_id=g.index_generation_id;
    select coalesce(pg_catalog.jsonb_agg(l.value order by public.shadow_utf16_order_v1(i.family),
      public.shadow_utf16_order_v1(i.unit_key),l.ord),'[]'::jsonb) into v_limitations
      from public.document_generation_inventory i cross join lateral pg_catalog.jsonb_array_elements(i.limitations) with ordinality l(value,ord)
      where i.document_id=g.document_id and i.index_generation_id=g.index_generation_id;
    v_status:=j.status='completed' and j.stage='shadow_staged' and j.progress=100 and j.attempt_count=1
      and j.locked_by is null and j.locked_at is null and j.completed_at is not null and pg_catalog.isfinite(j.completed_at)
      and j.completed_at=g.staged_at and j.error_message is null and j.next_run_at is null
      and j.lease_token=g.first_lease_token and j.lease_expected_generation_id is not distinct from g.baseline_generation_id
      and j.lease_write_generation_id=g.index_generation_id and j.lease_authority_digest=g.authority_digest
      and j.lease_expires_at is not null and pg_catalog.isfinite(j.lease_expires_at) and j.lease_expires_at>j.completed_at
      and j.lease_duration_seconds>0 and g.claimed_at is not null and pg_catalog.isfinite(g.claimed_at)
      and g.staged_at is not null and pg_catalog.isfinite(g.staged_at) and pr.sealed_at=g.staged_at
      and pr.document_id=g.document_id and pr.index_generation_id=g.index_generation_id
      and pr.owner_id is not distinct from g.owner_id and pr.lease_token=g.first_lease_token
      and g.expected_inventory_digest is not null and g.inventory_digest is not null and g.candidate_projection_digest is not null
      and g.stage_receipt is not null and g.stage_receipt_digest is not null and g.stage_receipt->>'digest'=g.stage_receipt_digest
      and g.stage_receipt->>'domain'='member_receipt' and g.stage_receipt->>'encoding'='pg-jsonb-text-v1'
      and public.shadow_keys_v1(r,array['kind','version','binding','planDigest','preparedOriginDigest','executionProfileDigest','caseSetDigest',
        'expectedStateDigest','baselineBundleDigest','expectedInventoryDigest','finalInventoryEnvelope','candidateProjectionDigest',
        'terminalControlEnvelope','sealedAt','limitations'])
      and r->>'kind'='u04-member-seal-receipt-v1' and r->'version'='1'::jsonb
      and r->'binding'=public.shadow_projection_binding_v1(g,null) and r->>'planDigest'=w.plan_digest
      and r->>'preparedOriginDigest'=w.prepared_origin_digest and r->>'executionProfileDigest'=w.execution_profile_digest
      and r->>'caseSetDigest'=w.case_set_digest and r->>'expectedStateDigest'=g.expected_state_digest
      and r->>'baselineBundleDigest'=g.baseline_bundle_digest and r->>'expectedInventoryDigest'=g.expected_inventory_digest
      and r->'sealedAt'=pg_catalog.to_jsonb(g.staged_at) and r->'limitations'=v_limitations
      and r->'finalInventoryEnvelope'->>'digest'=g.inventory_digest and r->>'candidateProjectionDigest'=g.candidate_projection_digest
      and r->'finalInventoryEnvelope'->>'domain'='inventory' and r->'finalInventoryEnvelope'->>'encoding'='pg-jsonb-text-v1'
      and r->'terminalControlEnvelope'->>'domain'='control' and r->'terminalControlEnvelope'->>'encoding'='pg-jsonb-text-v1'
      and public.shadow_keys_v1(f,array['kind','version','binding','expectedInventoryEnvelope','finalDispositions','projectionEnvelope',
        'preSealControlEnvelope','candidateRows','retainedEvidence'])
      and f->>'kind'='u04-final-inventory-v1' and f->'version'='1'::jsonb and f->'binding'=public.shadow_projection_binding_v1(g,null)
      and f->'expectedInventoryEnvelope'->>'digest'=g.expected_inventory_digest and f->'finalDispositions'=v_dispositions
      and f->'expectedInventoryEnvelope'->>'domain'='inventory' and f->'expectedInventoryEnvelope'->>'encoding'='pg-jsonb-text-v1'
      and f->'projectionEnvelope'->>'digest'=g.candidate_projection_digest
      and f->'projectionEnvelope'->>'domain'='projection' and f->'projectionEnvelope'->>'encoding'='pg-jsonb-text-v1'
      and f->'preSealControlEnvelope'->>'domain'='control' and f->'preSealControlEnvelope'->>'encoding'='pg-jsonb-text-v1'
      and public.shadow_inventory_envelope_payload_v1(f->'projectionEnvelope')=pg_catalog.to_jsonb(pr)
      and v_preseal->>'controlRevision'=(g.control_revision-1)::text and v_preseal->'ownNodeJobs'->0->>'status'='processing'
      and v_preseal->'ownNodeJobs'->0->>'locked_by' is not null and pg_catalog.btrim(v_preseal->'ownNodeJobs'->0->>'locked_by')<>''
      and v_preseal->'ownNodeJobs'->0->'completed_at'='null'::jsonb
      and (v_preseal->'ownNodeJobs'->0->>'lease_expires_at')::timestamptz>g.staged_at
      and (v_preseal->'ownNodeJobs'->0)-array['status','stage','progress','locked_at','locked_by','completed_at','updated_at']
        =(v_terminal->'ownNodeJobs'->0)-array['status','stage','progress','locked_at','locked_by','completed_at','updated_at']
      and v_preseal->'ownStages'=v_terminal->'ownStages'
      and v_terminal=g.control_snapshot and v_terminal->>'controlRevision'=g.control_revision::text
      and v_expected_count=v_actual_count and not pg_catalog.jsonb_path_exists(g.inventory_manifest,'$.families[*].groups[*] ? (@.state == "pending")')
      and not exists(select 1 from public.document_generation_inventory where document_id=g.document_id and index_generation_id=g.index_generation_id
        and (disposition='pending' or required and disposition<>'retained'))
      and exists(select 1 from public.ingestion_job_stages where job_id=j.id)
      and not exists(select 1 from public.ingestion_job_stages st where st.job_id=j.id
        and (st.stage_status<>'completed' or st.finished_at is null));
  end if;
  if v_status is not true or exists(select 1 from public.ingestion_job_stages st where st.job_id=j.id and
    (st.job_kind is distinct from 'node' or st.document_id is distinct from g.document_id or st.lease_token is distinct from g.first_lease_token
      or st.index_generation_id is distinct from g.baseline_generation_id)) then raise exception 'shadow_queue_incomplete'; end if;
  return g;
end $$;
alter function public.shadow_queue_complete_v1(uuid) owner to postgres;
revoke all on function public.shadow_queue_complete_v1(uuid) from public,anon,authenticated,service_role;

-- Callers already hold the full original source/document/queue boundary. This
-- helper checks each predecessor against the admitted full original capture;
-- the complete capture comparison in enqueue/origin guard preserves all bytes.
create or replace function public.shadow_queue_history_v1(p_document uuid,p_job uuid,p_origin jsonb)
returns void language plpgsql volatile set search_path = '' as $$
declare j public.ingestion_jobs%rowtype; g public.document_index_generations%rowtype; v_now timestamptz; e jsonb;
begin
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' or p_document is null
    or pg_catalog.jsonb_typeof(p_origin->'rows'->'ingestion_jobs') is distinct from 'array' then raise exception 'shadow_queue_history_required'; end if;
  if exists(select 1 from public.indexing_v3_agent_jobs where document_id=p_document and status in ('pending','processing')) then raise exception 'shadow_reservation_conflict'; end if;
  for j in select * from public.ingestion_jobs where document_id=p_document and id is distinct from p_job and status in ('pending','processing') order by id for update nowait loop
    v_now:=pg_catalog.clock_timestamp();
    if j.operation is distinct from 'shadow_reindex' or j.status is distinct from 'processing' or j.lease_expires_at is null
      or not pg_catalog.isfinite(j.lease_expires_at) or j.lease_expires_at>v_now then raise exception 'shadow_reservation_conflict'; end if;
    g:=public.shadow_queue_complete_v1(j.id);
    if not exists(select 1 from pg_catalog.jsonb_array_elements(p_origin->'rows'->'ingestion_jobs') x
      where public.shadow_capture_raw_envelope_valid_v1(x) and (x->>'canonicalPayload')::jsonb=pg_catalog.to_jsonb(j))
      or not exists(select 1 from pg_catalog.jsonb_array_elements(p_origin->'rows'->'document_index_generations') x
        where public.shadow_capture_raw_envelope_valid_v1(x) and (x->>'canonicalPayload')::jsonb=pg_catalog.to_jsonb(g))
      then raise exception 'shadow_predecessor_not_admitted'; end if;
    for e in select pg_catalog.to_jsonb(st) from public.ingestion_job_stages st where st.job_id=j.id order by st.id loop
      if not exists(select 1 from pg_catalog.jsonb_array_elements(p_origin->'rows'->'ingestion_job_stages') x
        where public.shadow_capture_raw_envelope_valid_v1(x) and (x->>'canonicalPayload')::jsonb=e) then raise exception 'shadow_predecessor_changed'; end if;
    end loop;
  end loop;
end $$;
alter function public.shadow_queue_history_v1(uuid,uuid,jsonb) owner to postgres;
revoke all on function public.shadow_queue_history_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_queue_checkpoint_complete_v1()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if tg_table_schema<>'public' or tg_table_name<>'ingestion_jobs' or tg_op not in ('INSERT','UPDATE') then raise exception 'shadow_queue_guard_owner'; end if;
  if new.operation='shadow_reindex' then
    -- Latest persisted state, not queued NEW; elapsed time is not a mutation.
    perform public.shadow_queue_complete_v1(new.id);
  end if;
  return null;
end $$;
alter function public.shadow_queue_checkpoint_complete_v1() owner to postgres;
revoke all on function public.shadow_queue_checkpoint_complete_v1() from public,anon,authenticated,service_role;

create or replace function public.shadow_queue_scheduling_guard_v1()
returns trigger language plpgsql volatile security invoker set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_doc uuid; v_key text; v_after_key text; v_version uuid; v_after_version uuid; v_now timestamptz;
  v_document public.documents%rowtype; g public.document_index_generations%rowtype; w public.shadow_reindex_waves%rowtype;
  p jsonb; o jsonb; s jsonb; v_locked jsonb; v_current jsonb; v_w uuid[]; v_m uuid[]; v_jobs uuid[];
  v_columns text[]:=array['id','document_id','batch_id','operation','requested_generation_id','shadow_plan_digest','status','attempt_count','max_attempts',
    'next_run_at','locked_by','locked_at','lease_token','lease_expected_generation_id','lease_write_generation_id','lease_authority_digest','lease_expires_at','lease_duration_seconds'];
begin
  if tg_table_schema<>'public' or tg_table_name<>'ingestion_jobs' or tg_op not in ('INSERT','UPDATE') then raise exception 'shadow_queue_guard_owner'; end if;
  v_new:=pg_catalog.to_jsonb(new);
  if tg_op='UPDATE' then
    v_old:=pg_catalog.to_jsonb(old);
    if not exists(select 1 from pg_catalog.unnest(v_columns) k where v_old->k is distinct from v_new->k) then return new; end if;
  end if;
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then raise exception 'shadow_queue_read_committed_required'; end if;
  -- Other roles have no Node write policy; never classify an RLS-hidden scope.
  if current_user not in ('postgres','service_role') then raise exception 'shadow_queue_writer_required'; end if;
  if new.operation='shadow_reindex' and current_user<>'postgres' then raise exception 'shadow_fixed_writer_required'; end if;
  for v_doc in select distinct x from pg_catalog.unnest(array[(v_old->>'document_id')::uuid,new.document_id]) x where x is not null order by x loop
    select v.id,v.source_catalogue_key into v_version,v_key from public.public_source_versions v where v.staging_document_id=v_doc;
    if v_key is null then select metadata->>'source_catalogue_key' into v_key from public.documents where id=v_doc; end if;
    -- P05 tables are SELECT-only for service_role. The existing source namespace
    -- serializes their fixed writers; do not require their UPDATE privilege.
    if v_key is not null and not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('public_source:'||v_key,0)) then raise exception 'shadow_queue_source_busy'; end if;
    select * into strict v_document from public.documents where id=v_doc for update nowait;
    select v.id,v.source_catalogue_key into v_after_version,v_after_key from public.public_source_versions v where v.staging_document_id=v_doc;
    if v_after_key is null then v_after_key:=v_document.metadata->>'source_catalogue_key'; end if;
    if v_after_key is distinct from v_key or v_after_version is distinct from v_version then raise exception 'shadow_queue_source_changed'; end if;
    perform 1 from public.ingestion_jobs where document_id=v_doc order by id for update nowait;
    perform 1 from public.indexing_v3_agent_jobs where document_id=v_doc order by id for update nowait;
    -- Separate VOLATILE statements after locking, never the pre-lock snapshot.
    if new.operation is distinct from 'shadow_reindex' and new.status in ('pending','processing') then
      if exists(select 1 from public.ingestion_jobs where document_id=v_doc and id is distinct from new.id and status in ('pending','processing'))
        or exists(select 1 from public.indexing_v3_agent_jobs where document_id=v_doc and status in ('pending','processing')) then raise exception 'shadow_queue_conflict'; end if;
    end if;
  end loop;
  if new.operation is distinct from 'shadow_reindex' then return new; end if;
  v_now:=pg_catalog.clock_timestamp();
  if tg_op='INSERT' then
    if new.status is distinct from 'pending' or new.stage is distinct from 'queued' or new.progress is distinct from 0
      or new.attempt_count is distinct from 0 or new.max_attempts is distinct from 1 or new.batch_id is not null
      or new.requested_generation_id is null or new.shadow_plan_digest is null or new.lease_token is not null
      or new.locked_by is not null or new.locked_at is not null or new.lease_expected_generation_id is not null or new.lease_write_generation_id is not null
      or new.lease_authority_digest is not null or new.lease_expires_at is not null or new.lease_duration_seconds is not null
      or new.next_run_at is null or not pg_catalog.isfinite(new.next_run_at) or new.completed_at is not null
      or exists(select 1 from public.document_index_generations where document_id=new.document_id and index_generation_id=new.requested_generation_id)
      then raise exception 'shadow_queue_bootstrap_required'; end if;
    select * into strict w from public.shadow_reindex_waves where candidate_generation_id=new.requested_generation_id for update nowait;
    p:=public.validate_shadow_plan_v1(w.plan_payload); o:=(p->'audit'->'input'->'originEnvelope'->>'canonicalPayload')::jsonb;
    select value into strict s from pg_catalog.jsonb_array_elements((public.shadow_node_payload_v1(w.baseline_report,'evaluation_report'))->'sourceBindings')
      where value->>'documentId'=new.document_id::text;
    if w.plan_digest is distinct from new.shadow_plan_digest or w.plan_payload->>'digest' is distinct from w.plan_digest
      or p->'plan'->>'candidateGenerationId' is distinct from new.requested_generation_id::text
      or w.prepared_origin_digest is distinct from p->'audit'->'input'->'originEnvelope'->>'digest'
      or w.execution_profile_digest is distinct from o->'executionProfileEnvelope'->>'digest'
      or w.baseline_report is distinct from p->'audit'->'input'->'caseResultsEnvelope'
      or w.baseline_report_digest is distinct from w.baseline_report->>'digest'
      or not exists(select 1 from pg_catalog.jsonb_array_elements(p->'plan'->'documents') d where d->>'documentId'=new.document_id::text
        and d->>'baselineGenerationId' is not distinct from s->>'baselineGenerationId') then raise exception 'shadow_queue_bootstrap_required'; end if;
    v_locked:=public.lock_ingestion_document_authority(new.document_id,true);
    if v_locked is null or v_locked->>'authority_digest' is distinct from s->>'authorityDigest'
      or v_locked->'document'->'owner_id' is distinct from s->'ownerId' or v_locked->'document'->'index_generation_id' is distinct from s->'baselineGenerationId'
      or v_locked->'document'->'content_hash' is distinct from s->'contentHash' then raise exception 'shadow_queue_source_changed'; end if;
    select pg_catalog.array_agg(value::uuid order by ord) into v_w from pg_catalog.jsonb_array_elements_text(o->'documentIds') with ordinality a(value,ord);
    select coalesce(pg_catalog.array_agg(value::uuid order by ord),array[]::uuid[]) into v_m from pg_catalog.jsonb_array_elements_text(o->'manualAliasIds') with ordinality a(value,ord);
    select coalesce(pg_catalog.array_agg(id order by id),array[]::uuid[]) into v_jobs from public.ingestion_jobs where operation='shadow_reindex' and requested_generation_id=new.requested_generation_id;
    v_current:=(public.capture_shadow_reindex_origin(v_w,o->>'sourcePolicyVersion',v_m,o->'executionProfileEnvelope')->>'canonicalPayload')::jsonb;
    if v_current-array['capturedAt','rows'] is distinct from o-array['capturedAt','rows']
      or public.shadow_state_rows_v1(v_current->'rows',new.requested_generation_id,v_jobs) is distinct from public.shadow_state_rows_v1(o->'rows',new.requested_generation_id,v_jobs)
      then raise exception 'shadow_predecessor_changed'; end if;
    perform public.shadow_queue_history_v1(new.document_id,new.id,o);
  else
    -- Complete OLD is authoritative while fixed claim writes provisional NEW.
    g:=public.shadow_queue_complete_v1(old.id);
    if old.id is distinct from new.id or old.document_id is distinct from new.document_id or old.operation is distinct from new.operation
      or old.requested_generation_id is distinct from new.requested_generation_id or old.shadow_plan_digest is distinct from new.shadow_plan_digest
      or new.batch_id is not null or new.max_attempts is distinct from 1 then raise exception 'shadow_queue_identity'; end if;
    perform public.shadow_assert_origin_unchanged_v1(g);
    v_now:=pg_catalog.clock_timestamp();
    if old.status='pending' then
      if g.state is distinct from 'reserved' or g.first_lease_token is not null or g.claimed_at is not null or old.attempt_count is distinct from 0
        or new.status is distinct from 'processing' or new.attempt_count is distinct from 1 or new.lease_token is null
        or new.locked_by is null or pg_catalog.btrim(new.locked_by)='' or new.locked_at is null or not pg_catalog.isfinite(new.locked_at) or new.locked_at>v_now
        or new.lease_expected_generation_id is distinct from g.baseline_generation_id or new.lease_write_generation_id is distinct from g.index_generation_id
        or new.lease_authority_digest is distinct from g.authority_digest or new.lease_expires_at is null or not pg_catalog.isfinite(new.lease_expires_at)
        or new.lease_expires_at<=v_now or new.lease_duration_seconds is null or new.lease_duration_seconds<=0 or new.next_run_at is not null
        or new.lease_expires_at-new.locked_at is distinct from pg_catalog.make_interval(secs=>new.lease_duration_seconds)
        or v_old-array['status','attempt_count','next_run_at','locked_by','locked_at','lease_token','lease_expected_generation_id','lease_write_generation_id','lease_authority_digest','lease_expires_at','lease_duration_seconds','updated_at']
          is distinct from v_new-array['status','attempt_count','next_run_at','locked_by','locked_at','lease_token','lease_expected_generation_id','lease_write_generation_id','lease_authority_digest','lease_expires_at','lease_duration_seconds','updated_at']
        then raise exception 'shadow_queue_first_claim_required'; end if;
    elsif new.status='completed' then
      if g.state is distinct from 'building' or old.status is distinct from 'processing' or old.attempt_count is distinct from 1
        or old.locked_by is null or pg_catalog.btrim(old.locked_by)='' or old.locked_at is null or not pg_catalog.isfinite(old.locked_at)
        or old.lease_token is distinct from g.first_lease_token or old.lease_expected_generation_id is distinct from g.baseline_generation_id
        or old.lease_write_generation_id is distinct from g.index_generation_id or old.lease_authority_digest is distinct from g.authority_digest
        or old.lease_expires_at is null or not pg_catalog.isfinite(old.lease_expires_at)
        or new.stage is distinct from 'shadow_staged' or new.progress is distinct from 100 or new.locked_by is not null or new.locked_at is not null
        or new.completed_at is null or not pg_catalog.isfinite(new.completed_at) or new.completed_at>v_now or old.lease_expires_at<=new.completed_at
        or v_old-array['status','stage','progress','locked_by','locked_at','completed_at','updated_at'] is distinct from
          v_new-array['status','stage','progress','locked_by','locked_at','completed_at','updated_at']
        then raise exception 'shadow_queue_terminal_transition'; end if;
    else
      if old.status is distinct from 'processing' or old.lease_expires_at is null or old.lease_expires_at<=v_now
        or (new.status in ('processing','failed')) is not true or new.attempt_count is distinct from 1 or new.lease_token is distinct from g.first_lease_token
        or new.lease_expected_generation_id is distinct from g.baseline_generation_id or new.lease_write_generation_id is distinct from g.index_generation_id
        or new.lease_authority_digest is distinct from g.authority_digest or new.lease_duration_seconds is distinct from old.lease_duration_seconds
        then raise exception 'shadow_queue_stale_attempt'; end if;
    end if;
  end if;
  return new;
end $$;
alter function public.shadow_queue_scheduling_guard_v1() owner to postgres;
revoke all on function public.shadow_queue_scheduling_guard_v1() from public,anon,authenticated,service_role;

-- Guards, validation and physical-index replacement form one atomic statement.
-- No time predicate or private-table subquery appears in the index itself.
do $u04_restart_index$
declare j public.ingestion_jobs%rowtype;
begin
  lock table public.ingestion_jobs,public.indexing_v3_agent_jobs,public.document_index_generations,
    public.shadow_reindex_waves,public.document_generation_baselines,public.ingestion_job_stages in share row exclusive mode nowait;
  for j in select * from public.ingestion_jobs where operation='shadow_reindex' and status='processing' order by id loop
    perform public.shadow_queue_complete_v1(j.id);
  end loop;
  create trigger ingestion_jobs_shadow_scheduling before insert or update on public.ingestion_jobs
    for each row execute function public.shadow_queue_scheduling_guard_v1();
  create constraint trigger ingestion_jobs_shadow_checkpoint_complete after insert or update on public.ingestion_jobs
    deferrable initially deferred for each row execute function public.shadow_queue_checkpoint_complete_v1();
  drop index public.ingestion_jobs_one_open_per_document_uidx;
  create unique index ingestion_jobs_one_open_per_document_uidx on public.ingestion_jobs(document_id)
    where (status in ('pending', 'processing')) is not false
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
      ) is true);
end $u04_restart_index$;

-- U04 actual producer/terminal integration: fixed private projection identities.
-- These helpers remain ungranted; no client assertion supplies source authority.
create or replace function public.shadow_projection_binding_v1(p_member public.document_index_generations,p_artifact uuid default null)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('tag','candidate','source',p_member.source_binding,
    'candidateGenerationId',p_member.index_generation_id,'jobId',p_member.job_id,
    'firstLeaseToken',p_member.first_lease_token,'artifactGenerationId',p_artifact)
$$;
alter function public.shadow_projection_binding_v1(public.document_index_generations,uuid) owner to postgres;
revoke all on function public.shadow_projection_binding_v1(public.document_index_generations,uuid) from public,anon,authenticated,service_role;

create or replace function public.shadow_projection_batch_v1(p_member public.document_index_generations,p_group text,p_envelope jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_family jsonb;v_slot jsonb;v_count integer:=0;v_expected integer;v_payload jsonb;v_d uuid;v_binding jsonb;
begin
  if p_group is null or (p_group in ('enrichment','deep_memory','projection_aggregate','worker_core')) is not true
    then raise exception 'shadow_projection_group_invalid'; end if;
  v_payload:=public.shadow_inventory_envelope_payload_v1(p_envelope);
  v_expected:=case p_group when 'enrichment' then 2 when 'deep_memory' then 4 when 'projection_aggregate' then 1 else 1 end;
  for v_family in select value from pg_catalog.jsonb_array_elements(p_member.inventory_manifest->'families') loop
    if (p_group='enrichment' and v_family->>'family' not in ('summary','generated_labels'))
      or (p_group='deep_memory' and v_family->>'family' not in ('sections','memory_cards','index_units','producer_aliases'))
      or (p_group='projection_aggregate' and v_family->>'family'<>'document_metadata')
      or (p_group='worker_core' and v_family->>'family'<>'quality') then continue; end if;
    select value into v_slot from pg_catalog.jsonb_array_elements(v_family->'groups') where value->>'groupKey'=p_group;
    if not found or v_slot->>'state' is distinct from 'declared'
      or v_slot->'declaration'->'outputManifestEnvelope' is distinct from p_envelope
      or v_slot->'declaration'->'producer'->>'name' is distinct from 'local-worker'
      then raise exception 'shadow_projection_declaration_required'; end if;
    v_d:=(v_slot->'declaration'->>'artifactGenerationId')::uuid;
    v_binding:=public.shadow_projection_binding_v1(p_member,v_d);
    perform public.shadow_validate_producer_declaration_v1(v_slot->'declaration',v_family->>'family',p_group,
      p_member.first_lease_token,p_member.index_generation_id,p_member.baseline_generation_id);
    perform public.shadow_validate_planned_batch_v1(v_slot->'declaration',v_family->>'family',v_binding);
    v_count:=v_count+1;
  end loop;
  if v_count<>v_expected then raise exception 'shadow_projection_population_incomplete'; end if;
  return v_payload;
end $$;
alter function public.shadow_projection_batch_v1(public.document_index_generations,text,jsonb) owner to postgres;
revoke all on function public.shadow_projection_batch_v1(public.document_index_generations,text,jsonb) from public,anon,authenticated,service_role;

-- Required before using any projection component, including an empty label set.
create or replace function public.shadow_projection_planned_unit_v1(p_batch jsonb,p_family text,p_key text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_unit jsonb;
begin
  if pg_catalog.jsonb_typeof(p_batch->'units') is distinct from 'array' or p_family is null or p_key is null
    or (select count(*) from pg_catalog.jsonb_array_elements(p_batch->'units') x where x->>'family'=p_family and x->>'key'=p_key)<>1
    then raise exception 'shadow_projection_planned_unit_required'; end if;
  select value->'output' into v_unit from pg_catalog.jsonb_array_elements(p_batch->'units') where value->>'family'=p_family and value->>'key'=p_key;
  return v_unit;
end $$;
alter function public.shadow_projection_planned_unit_v1(jsonb,text,text) owner to postgres;
revoke all on function public.shadow_projection_planned_unit_v1(jsonb,text,text) from public,anon,authenticated,service_role;

create or replace function public.shadow_summary_input_v1(p_member public.document_index_generations,p_summary jsonb,p_labels jsonb,p_metadata jsonb,p_output jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare v_batch jsonb;v_payload jsonb;v_profile jsonb;v_configuration jsonb;v_claim jsonb;v_key text;v_label jsonb;v_native jsonb;
  v_label_key text;v_claims jsonb;v_sources jsonb;v_projection jsonb;v_expected jsonb;v_pages jsonb;v_id jsonb;v_n integer;v_profile_keys text[]:=array[
    'applies_to','key_clinical_actions','medication_dose_monitoring','thresholds_timing','escalation_risk_warnings',
    'required_forms_documentation','not_covered','important_tables_images','best_questions','source_quality_notes'];
begin
  v_batch:=public.shadow_projection_batch_v1(p_member,'enrichment',p_output);
  if public.shadow_projection_planned_unit_v1(v_batch,'summary','singleton') is distinct from
    pg_catalog.jsonb_build_object('summary',p_summary,'enrichment_metadata',p_metadata) then raise exception 'shadow_summary_original_changed'; end if;
  if not public.shadow_keys_v1(p_summary,array['document_id','owner_id','summary','clinical_specifics','source_chunk_ids','source_image_ids','model','generated_at','updated_at','metadata'])
    or p_summary->>'document_id' is distinct from p_member.document_id::text
    or p_summary->'owner_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.owner_id),'null'::jsonb)
    or not public.shadow_keys_v1(p_summary->'metadata',array['generated_by','index_generation_id','rag_enrichment_version','rag_indexing_version','rag_memory_version',
      'clinical_profile_version','coverage_profile','enrichment_prompt_strategy','enrichment_prompt_chunk_ids','label_count','source_anchored_summary_v1','source_anchored_summary_projection_complete_v1'])
    or p_summary->'metadata'->>'generated_by' is distinct from 'local-worker'
    or p_summary->'metadata'->>'index_generation_id' is distinct from p_member.index_generation_id::text
    or p_summary->'metadata'->'source_anchored_summary_projection_complete_v1' is distinct from 'true'::jsonb
    or not public.shadow_keys_v1(p_metadata,array['rag_enrichment_version','rag_indexing_version','rag_memory_version','rag_enrichment_updated_at','generated_label_count'])
    or pg_catalog.jsonb_typeof(p_labels) is distinct from 'array' then raise exception 'shadow_summary_input_invalid'; end if;
  v_payload:=p_summary->'metadata'->'source_anchored_summary_v1';
  if not public.shadow_keys_v1(v_payload,array['summary_kind','summary_version','document_id','index_generation_id','model','model_version','generated_at','source_chunk_ids','source_image_ids','summary','clinical_specifics','labels','heuristic_fallback'])
    or v_payload->>'summary_kind' is distinct from 'structured' or v_payload->'heuristic_fallback' is distinct from 'false'::jsonb
    or v_payload->>'summary_version' is distinct from 'source-anchored-summary-v1'
    or v_payload->>'document_id' is distinct from p_member.document_id::text or v_payload->>'index_generation_id' is distinct from p_member.index_generation_id::text
    or pg_catalog.jsonb_typeof(v_payload->'labels') is distinct from 'array' or pg_catalog.jsonb_array_length(v_payload->'labels')>32
    or pg_catalog.jsonb_array_length(v_payload->'labels')<>pg_catalog.jsonb_array_length(p_labels)
    or pg_catalog.jsonb_typeof(v_payload->'source_chunk_ids') is distinct from 'array' or pg_catalog.jsonb_typeof(v_payload->'source_image_ids') is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_payload->'source_chunk_ids')+pg_catalog.jsonb_array_length(v_payload->'source_image_ids')=0
    or p_summary->'metadata'->'enrichment_prompt_chunk_ids' is distinct from v_payload->'source_chunk_ids'
    then raise exception 'shadow_summary_payload_invalid'; end if;
  foreach v_key in array array['summary','clinical_specifics','source_chunk_ids','source_image_ids','model','generated_at'] loop
    if p_summary->v_key is distinct from v_payload->v_key then raise exception 'shadow_summary_projection_mismatch'; end if;
  end loop;
  perform public.shadow_audit_timestamp_v1(v_payload->'generated_at');
  if p_summary->'updated_at' is distinct from v_payload->'generated_at' or p_metadata->'rag_enrichment_updated_at' is distinct from v_payload->'generated_at'
    or p_metadata->'generated_label_count' is distinct from pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(p_labels))
    or p_summary->'metadata'->'label_count' is distinct from p_metadata->'generated_label_count' then raise exception 'shadow_summary_projection_mismatch'; end if;
  foreach v_key in array array['rag_enrichment_version','rag_indexing_version','rag_memory_version'] loop
    if p_metadata->>v_key is distinct from 'rag-deep-memory-v1' or p_summary->'metadata'->v_key is distinct from p_metadata->v_key then raise exception 'shadow_summary_version_mismatch'; end if;
  end loop;
  v_profile:=public.shadow_profile_capture_v1((p_member.original_origin_envelope->>'canonicalPayload')::jsonb->'executionProfileEnvelope');
  v_configuration:=public.shadow_node_payload_v1(v_profile->'configuration','u04-engine-config-v1');
  if v_payload->'model' is distinct from v_configuration->'generation'->'indexingModel' or v_payload->>'model_version' is distinct from 'rag-deep-memory-v1'
    then raise exception 'shadow_summary_model_mismatch'; end if;
  perform public.assert_ingestion_artifact_sources(p_summary,p_member.document_id,p_member.index_generation_id,null);
  if (select count(*) from pg_catalog.jsonb_array_elements(v_payload->'source_chunk_ids'))<>(select count(distinct value) from pg_catalog.jsonb_array_elements(v_payload->'source_chunk_ids'))
    or (select count(*) from pg_catalog.jsonb_array_elements(v_payload->'source_image_ids'))<>(select count(distinct value) from pg_catalog.jsonb_array_elements(v_payload->'source_image_ids')) then raise exception 'shadow_summary_source_duplicate'; end if;
  if not public.shadow_keys_v1(v_payload->'clinical_specifics',array['profile','actions','thresholds_timing','medication_monitoring','risk_escalation','documentation_forms','exceptions_gaps'])
    or not public.shadow_keys_v1(v_payload->'clinical_specifics'->'profile',array['overview']||v_profile_keys) then raise exception 'shadow_summary_profile_invalid'; end if;
  v_profile:=v_payload->'clinical_specifics'->'profile';v_claims:='[]'::jsonb;v_projection:='[]'::jsonb;
  foreach v_key in array v_profile_keys loop
    if pg_catalog.jsonb_typeof(v_profile->v_key) is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_profile->v_key)>(case when v_key='best_questions' then 8 else 6 end) then raise exception 'shadow_summary_profile_invalid'; end if;
    for v_claim in select value from pg_catalog.jsonb_array_elements(v_profile->v_key) loop
      if not public.shadow_keys_v1(v_claim,array['text','source_chunk_ids','source_image_ids','pages','evidence_type','support'])
        or pg_catalog.jsonb_typeof(v_claim->'text') is distinct from 'string' or pg_catalog.length(v_claim->>'text')=0
        or pg_catalog.octet_length(public.shadow_utf16_order_v1(v_claim->>'text'))/2>600
        or (v_claim->>'evidence_type' in ('text','table','image','mixed','metadata')) is not true
        or (v_claim->>'support' in ('direct','partial','not_found')) is not true
        or pg_catalog.jsonb_typeof(v_claim->'source_chunk_ids') is distinct from 'array' or pg_catalog.jsonb_typeof(v_claim->'source_image_ids') is distinct from 'array'
        or pg_catalog.jsonb_typeof(v_claim->'pages') is distinct from 'array' then raise exception 'shadow_summary_claim_invalid'; end if;
      if v_claim->>'support'='not_found' then
        if v_key not in ('not_covered','source_quality_notes') or not pg_catalog.starts_with(v_claim->>'text','Not established by selected source evidence:') then raise exception 'shadow_summary_not_found_invalid'; end if;
      elsif pg_catalog.jsonb_array_length(v_claim->'source_chunk_ids')+pg_catalog.jsonb_array_length(v_claim->'source_image_ids')=0 then raise exception 'shadow_summary_claim_anchor_required'; end if;
      foreach v_label_key in array array['source_chunk_ids','source_image_ids'] loop
        select coalesce(pg_catalog.jsonb_agg(value order by ord),'[]'::jsonb) into v_expected from pg_catalog.jsonb_array_elements(v_payload->v_label_key) with ordinality e(value,ord)
          where v_claim->v_label_key @> pg_catalog.jsonb_build_array(value);
        if v_expected is distinct from v_claim->v_label_key then raise exception 'shadow_summary_claim_source_order'; end if;
      end loop;
      select coalesce(pg_catalog.jsonb_agg(page_number order by page_number),'[]'::jsonb) into v_pages from (
        select c.page_number from public.document_chunks c where c.document_id=p_member.document_id and c.index_generation_id=p_member.index_generation_id
          and v_claim->'source_chunk_ids' @> pg_catalog.jsonb_build_array(c.id) and c.page_number>0
        union select i.page_number from public.document_images i where i.document_id=p_member.document_id and i.index_generation_id=p_member.index_generation_id
          and v_claim->'source_image_ids' @> pg_catalog.jsonb_build_array(i.id) and i.page_number>0
      ) pages;
      if v_claim->'pages' is distinct from v_pages then raise exception 'shadow_summary_claim_pages'; end if;
      if v_claim->>'support'<>'not_found' then
        v_claims:=v_claims||pg_catalog.jsonb_build_array(v_claim);
        if v_key in ('applies_to','key_clinical_actions','medication_dose_monitoring','thresholds_timing','escalation_risk_warnings','required_forms_documentation','important_tables_images')
          and pg_catalog.jsonb_array_length(v_projection)<8 then v_projection:=v_projection||pg_catalog.jsonb_build_array(v_claim->'text'); end if;
      end if;
    end loop;
  end loop;
  select pg_catalog.to_jsonb(pg_catalog.string_agg('- '||(value#>>'{}'),' ' order by ord)) into v_expected from pg_catalog.jsonb_array_elements(v_projection) with ordinality e(value,ord);
  if v_expected is null or v_payload->'summary' is distinct from v_expected or v_profile->'overview' is distinct from v_expected then raise exception 'shadow_summary_text_projection'; end if;
  for v_key,v_label_key in select * from (values ('actions','key_clinical_actions'),('thresholds_timing','thresholds_timing'),
    ('medication_monitoring','medication_dose_monitoring'),('risk_escalation','escalation_risk_warnings'),
    ('documentation_forms','required_forms_documentation'),('exceptions_gaps','not_covered')) x(a,b) loop
    select coalesce(pg_catalog.jsonb_agg(value->'text' order by ord),'[]'::jsonb) into v_expected from pg_catalog.jsonb_array_elements(v_profile->v_label_key) with ordinality e(value,ord);
    if v_payload->'clinical_specifics'->v_key is distinct from v_expected then raise exception 'shadow_summary_profile_projection'; end if;
  end loop;
  v_n:=0;
  for v_label in select value from pg_catalog.jsonb_array_elements(p_labels) loop
    if not public.shadow_keys_v1(v_label,array['document_id','owner_id','label','label_type','confidence','source','metadata'])
      or v_label->>'document_id' is distinct from p_member.document_id::text or v_label->'owner_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.owner_id),'null'::jsonb)
      or v_label->>'source' is distinct from 'generated' or pg_catalog.jsonb_typeof(v_label->'confidence') is distinct from 'number'
      or (v_label->>'confidence')::numeric not between 0 and 1
      or not public.shadow_keys_v1(v_label->'metadata',array['index_generation_id','summary_version','source_chunk_ids','source_image_ids','pages'])
      or v_label->'metadata'->>'index_generation_id' is distinct from p_member.index_generation_id::text
      or v_label->'metadata'->>'summary_version' is distinct from 'source-anchored-summary-v1'
      or v_payload->'labels'->v_n is distinct from pg_catalog.jsonb_build_object('label',v_label->'label','label_type',v_label->'label_type','confidence',v_label->'confidence')
      then raise exception 'shadow_summary_label_invalid'; end if;
    v_label_key:=public.shadow_node_value_text_v1(pg_catalog.jsonb_build_object('label',v_label->'label','label_type',v_label->'label_type'));
    v_native:=public.shadow_projection_planned_unit_v1(v_batch,'generated_labels',v_label_key);
    if v_native is distinct from v_label then raise exception 'shadow_summary_label_original_changed'; end if;
    if not exists(select 1 from pg_catalog.jsonb_array_elements(v_claims) c where c->'source_chunk_ids'=v_label->'metadata'->'source_chunk_ids'
      and c->'source_image_ids'=v_label->'metadata'->'source_image_ids' and c->'pages'=v_label->'metadata'->'pages') then raise exception 'shadow_summary_label_sources'; end if;
    perform public.assert_ingestion_artifact_sources(v_label->'metadata',p_member.document_id,p_member.index_generation_id,null);
    v_n:=v_n+1;
  end loop;
  if (select count(*) from pg_catalog.jsonb_array_elements(v_batch->'units') x where x->>'family'='generated_labels')<>v_n
    then raise exception 'shadow_summary_label_population'; end if;
end $$;
alter function public.shadow_summary_input_v1(public.document_index_generations,jsonb,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_summary_input_v1(public.document_index_generations,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.persist_shadow_summary_projection(p_fence jsonb,p_generation uuid,p_summary jsonb,p_labels jsonb,p_metadata jsonb,p_output_manifest jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.document_index_generations%rowtype;v_existing public.document_generation_projections%rowtype;
  v_summary public.document_summaries%rowtype;v_label public.document_labels%rowtype;v_input jsonb;v_labels jsonb:='[]'::jsonb;
  v_projection jsonb;v_digest text;v_now timestamptz;v_stamp jsonb;
begin
  v_member:=public.shadow_assert_attempt_v1(p_fence,p_generation,null);
  perform public.shadow_summary_input_v1(v_member,p_summary,p_labels,p_metadata,p_output_manifest);
  select * into v_existing from public.document_generation_projections where document_id=v_member.document_id and index_generation_id=p_generation for update;
  if found and v_existing.summary_digest is not null then
    v_projection:=pg_catalog.jsonb_build_object('kind','u04-summary-projection-v1','binding',public.shadow_projection_binding_v1(v_member),
      'outputManifestEnvelope',p_output_manifest,'summary',v_existing.summary,'generated_labels',v_existing.generated_labels,
      'summary_projection_complete',v_existing.summary_projection_complete,'enrichment_metadata',v_existing.enrichment_metadata);
    if public.shadow_pg_bundle_v1(v_projection,'projection')->>'digest' is distinct from v_existing.summary_digest
      then raise exception 'shadow_summary_replay_conflict'; end if;
    return pg_catalog.jsonb_build_object('ok',true,'kind','unchanged','summary',v_existing.summary,'projection_digest',v_existing.summary_digest);
  end if;
  v_now:=pg_catalog.clock_timestamp();
  v_stamp:=pg_catalog.jsonb_build_object('index_generation_id',p_generation,'ingestion_job_kind','node','ingestion_job_id',v_member.job_id,'ingestion_lease_token',v_member.first_lease_token);
  v_summary:=pg_catalog.jsonb_populate_record(null::public.document_summaries,p_summary);
  v_summary.id:=pg_catalog.gen_random_uuid();v_summary.created_at:=v_now;v_summary.updated_at:=v_now;
  v_summary.metadata:=p_summary->'metadata'||v_stamp;
  for v_input in select value from pg_catalog.jsonb_array_elements(p_labels) loop
    v_label:=pg_catalog.jsonb_populate_record(null::public.document_labels,v_input);
    v_label.id:=pg_catalog.gen_random_uuid();v_label.created_at:=v_now;v_label.updated_at:=v_now;
    v_label.metadata:=v_input->'metadata'||v_stamp;
    v_labels:=v_labels||pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(v_label));
  end loop;
  v_projection:=pg_catalog.jsonb_build_object('kind','u04-summary-projection-v1','binding',public.shadow_projection_binding_v1(v_member),
    'outputManifestEnvelope',p_output_manifest,'summary',pg_catalog.to_jsonb(v_summary),'generated_labels',v_labels,
    'summary_projection_complete',true,'enrichment_metadata',p_metadata);
  v_digest:=public.shadow_pg_bundle_v1(v_projection,'projection')->>'digest';
  insert into public.document_generation_projections(document_id,index_generation_id,lease_token,owner_id,summary,generated_labels,summary_projection_complete,enrichment_metadata,summary_digest)
    values(v_member.document_id,p_generation,v_member.first_lease_token,v_member.owner_id,pg_catalog.to_jsonb(v_summary),v_labels,true,p_metadata,v_digest)
    on conflict(document_id,index_generation_id) do update set summary=excluded.summary,generated_labels=excluded.generated_labels,
      summary_projection_complete=excluded.summary_projection_complete,enrichment_metadata=excluded.enrichment_metadata,summary_digest=excluded.summary_digest
      where public.document_generation_projections.summary_digest is null and public.document_generation_projections.sealed_at is null;
  if not found then raise exception 'shadow_summary_write_conflict'; end if;
  perform public.shadow_checkpoint_advance_v1(v_member.job_id);
  return pg_catalog.jsonb_build_object('ok',true,'kind','summary_projected','summary',pg_catalog.to_jsonb(v_summary),'projection_digest',v_digest);
exception when others then raise exception 'invalid_shadow_summary_projection' using errcode='22023';
end $$;
alter function public.persist_shadow_summary_projection(jsonb,uuid,jsonb,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.persist_shadow_summary_projection(jsonb,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Mechanical quality projection validation binds the complete actual worker output.
-- The unchanged Node assessment remains the semantic owner; this is no scoring port.
create or replace function public.shadow_quality_input_v1(p_member public.document_index_generations,p_quality jsonb,p_output jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare v_batch jsonb;v_metrics jsonb;v_key text;v_value jsonb;v_item jsonb;v_count bigint;v_fields jsonb;
  v_count_keys text[]:=array['page_count','ocr_page_count','needs_ocr_page_count','text_character_count','extracted_image_count','searchable_image_count','skipped_image_count','section_count','memory_card_count'];
  v_number_keys text[]:=array['avg_chunk_length','duplicate_chunk_ratio','heading_density','section_path_coverage','ocr_coverage','average_page_text_chars'];
  v_nullable_keys text[]:=array['table_extraction_coverage','searchable_image_coverage','visual_unit_coverage','average_image_quality_score','average_crop_completeness','average_structured_visual_confidence'];
begin
  v_batch:=public.shadow_projection_batch_v1(p_member,'worker_core',p_output);
  if public.shadow_projection_planned_unit_v1(v_batch,'quality','singleton') is distinct from p_quality
    then raise exception 'shadow_quality_original_changed'; end if;
  if not public.shadow_keys_v1(p_quality,array['document_id','owner_id','quality_score','extraction_quality','issues','metrics','updated_at'])
    or p_quality->>'document_id' is distinct from p_member.document_id::text
    or p_quality->'owner_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.owner_id),'null'::jsonb)
    or pg_catalog.jsonb_typeof(p_quality->'quality_score') is distinct from 'number'
    or (p_quality->>'quality_score')::numeric not between 0 and 1
    or (p_quality->>'extraction_quality' in ('good','partial','poor')) is not true
    or pg_catalog.jsonb_typeof(p_quality->'issues') is distinct from 'array'
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_quality->'issues') x where pg_catalog.jsonb_typeof(x) is distinct from 'string')
    then raise exception 'shadow_quality_input_invalid'; end if;
  perform public.shadow_audit_timestamp_v1(p_quality->'updated_at');
  v_metrics:=p_quality->'metrics';
  if not public.shadow_keys_v1(v_metrics,v_count_keys||v_number_keys||v_nullable_keys||array[
    'skipped_image_reasons','image_type_counts','extraction_warnings','document_embedding_field_types','optional_index_write_issues','search_eval_hit_rate'])
    or v_metrics->'search_eval_hit_rate' is distinct from 'null'::jsonb then raise exception 'shadow_quality_metrics_invalid'; end if;
  foreach v_key in array v_count_keys loop
    v_value:=v_metrics->v_key;
    if pg_catalog.jsonb_typeof(v_value) is distinct from 'number' or (v_value::text)::numeric not between 0 and 9007199254740991
      or (v_value::text)::numeric<>pg_catalog.trunc((v_value::text)::numeric) then raise exception 'shadow_quality_count_invalid'; end if;
  end loop;
  foreach v_key in array v_number_keys||v_nullable_keys loop
    v_value:=v_metrics->v_key;
    if v_key=any(v_nullable_keys) and v_value='null'::jsonb then continue; end if;
    if pg_catalog.jsonb_typeof(v_value) is distinct from 'number' or (v_value::text)::numeric<0
      then raise exception 'shadow_quality_metric_invalid'; end if;
    if v_key not in ('avg_chunk_length','average_page_text_chars') and (v_value::text)::numeric>1
      then raise exception 'shadow_quality_ratio_invalid'; end if;
  end loop;
  foreach v_key in array array['skipped_image_reasons','image_type_counts'] loop
    if pg_catalog.jsonb_typeof(v_metrics->v_key) is distinct from 'object' then raise exception 'shadow_quality_count_map_invalid'; end if;
    for v_value in select value from pg_catalog.jsonb_each(v_metrics->v_key) loop
      if pg_catalog.jsonb_typeof(v_value) is distinct from 'number' or (v_value::text)::numeric not between 0 and 9007199254740991
        or (v_value::text)::numeric<>pg_catalog.trunc((v_value::text)::numeric) then raise exception 'shadow_quality_count_map_invalid'; end if;
    end loop;
  end loop;
  foreach v_key in array array['extraction_warnings','document_embedding_field_types'] loop
    if pg_catalog.jsonb_typeof(v_metrics->v_key) is distinct from 'array'
      or exists(select 1 from pg_catalog.jsonb_array_elements(v_metrics->v_key) x where pg_catalog.jsonb_typeof(x) is distinct from 'string')
      then raise exception 'shadow_quality_string_array_invalid'; end if;
  end loop;
  if pg_catalog.jsonb_typeof(v_metrics->'optional_index_write_issues') is distinct from 'array' then raise exception 'shadow_quality_optional_issues_invalid'; end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_metrics->'optional_index_write_issues') loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' or not(v_item ?& array['stage','message'])
      or v_item-array['stage','message','code']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(v_item->'stage') is distinct from 'string' or pg_catalog.jsonb_typeof(v_item->'message') is distinct from 'string'
      or (v_item?'code' and (pg_catalog.jsonb_typeof(v_item->'code') in ('string','null')) is not true)
      then raise exception 'shadow_quality_optional_issue_invalid'; end if;
  end loop;
  select count(*) into v_count from public.document_pages where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  if v_metrics->'page_count' is distinct from pg_catalog.to_jsonb(v_count) then raise exception 'shadow_quality_page_population'; end if;
  select count(*) into v_count from public.document_images where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id and searchable;
  if v_metrics->'searchable_image_count' is distinct from pg_catalog.to_jsonb(v_count)
    then raise exception 'shadow_quality_image_population'; end if;
  -- View-only retained images are neither searchable nor skipped. Their full
  -- original extraction population is retained independently, never inferred by addition.
  if (v_metrics->>'ocr_page_count')::numeric>(v_metrics->>'page_count')::numeric
    or (v_metrics->>'needs_ocr_page_count')::numeric>(v_metrics->>'page_count')::numeric then raise exception 'shadow_quality_page_metrics'; end if;
  select count(*) into v_count from public.document_sections where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  if v_metrics->'section_count' is distinct from pg_catalog.to_jsonb(v_count) then raise exception 'shadow_quality_section_population'; end if;
  select count(*) into v_count from public.document_memory_cards where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  if v_metrics->'memory_card_count' is distinct from pg_catalog.to_jsonb(v_count) then raise exception 'shadow_quality_card_population'; end if;
  select coalesce(pg_catalog.jsonb_agg(field_type order by public.shadow_utf16_order_v1(field_type)),'[]'::jsonb) into v_fields from (
    select distinct field_type from public.document_embedding_fields where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id
      and field_type in ('document_title','document_summary')
  ) fields;
  if v_metrics->'document_embedding_field_types' is distinct from v_fields then raise exception 'shadow_quality_field_population'; end if;
end $$;
alter function public.shadow_quality_input_v1(public.document_index_generations,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_quality_input_v1(public.document_index_generations,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.persist_shadow_quality_projection(p_fence jsonb,p_generation uuid,p_quality jsonb,p_output_manifest jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.document_index_generations%rowtype;v_existing public.document_generation_projections%rowtype;
  v_quality public.document_index_quality%rowtype;v_projection jsonb;v_digest text;
begin
  v_member:=public.shadow_assert_attempt_v1(p_fence,p_generation,null);
  perform public.shadow_quality_input_v1(v_member,p_quality,p_output_manifest);
  v_quality:=pg_catalog.jsonb_populate_record(null::public.document_index_quality,p_quality);
  -- The actual worker does not emit these optional metric columns. Preserve typed
  -- nulls in the full row; no document's old live quality row supplies C values.
  v_projection:=pg_catalog.jsonb_build_object('kind','u04-quality-projection-v1','binding',public.shadow_projection_binding_v1(v_member),
    'outputManifestEnvelope',p_output_manifest,'quality',pg_catalog.to_jsonb(v_quality));
  v_digest:=public.shadow_pg_bundle_v1(v_projection,'projection')->>'digest';
  select * into v_existing from public.document_generation_projections where document_id=v_member.document_id and index_generation_id=p_generation for update;
  if found and v_existing.quality_digest is not null then
    if v_existing.quality_digest is distinct from v_digest or v_existing.quality is distinct from pg_catalog.to_jsonb(v_quality)
      then raise exception 'shadow_quality_replay_conflict'; end if;
    return pg_catalog.jsonb_build_object('ok',true,'kind','unchanged','projection_digest',v_digest);
  end if;
  insert into public.document_generation_projections(document_id,index_generation_id,lease_token,owner_id,quality,quality_digest)
    values(v_member.document_id,p_generation,v_member.first_lease_token,v_member.owner_id,pg_catalog.to_jsonb(v_quality),v_digest)
    on conflict(document_id,index_generation_id) do update set quality=excluded.quality,quality_digest=excluded.quality_digest
      where public.document_generation_projections.quality_digest is null and public.document_generation_projections.sealed_at is null;
  if not found then raise exception 'shadow_quality_write_conflict'; end if;
  perform public.shadow_checkpoint_advance_v1(v_member.job_id);
  return pg_catalog.jsonb_build_object('ok',true,'kind','quality_projected','projection_digest',v_digest);
exception when others then raise exception 'invalid_shadow_quality_projection' using errcode='22023';
end $$;
alter function public.persist_shadow_quality_projection(jsonb,uuid,jsonb,jsonb) owner to postgres;
revoke all on function public.persist_shadow_quality_projection(jsonb,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Native deep output uses the original producer's finite input shapes. Unit
-- keys are deep:<original ordinal>; generated SQL identifiers live only in the
-- separate after-image receipt. Section association is preserved before IDs exist.
create or replace function public.shadow_deep_native_v1(p_member public.document_index_generations,p_artifact uuid,p_family text,p_output jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_native jsonb:=p_output->'nativeInput';v_keys text[];v_key text;v_value jsonb;v_association jsonb;
begin
  if p_artifact is null or p_artifact=p_member.index_generation_id or p_artifact is not distinct from p_member.baseline_generation_id
    or (p_family in ('sections','memory_cards','index_units','producer_aliases')) is not true
    or pg_catalog.jsonb_typeof(p_output) is distinct from 'object' or not(p_output?'nativeInput')
    or p_output-array['nativeInput','sectionAssociation','producerContext']<>'{}'::jsonb then raise exception 'shadow_deep_native_invalid'; end if;
  if p_family='sections' then
    v_keys:=array['document_id','owner_id','section_index','heading','heading_path','page_start','page_end','chunk_ids','summary','tags','extraction_quality','producer','artifact_generation_id','index_generation_id','metadata'];
    if p_output?'sectionAssociation' then raise exception 'shadow_deep_association_invalid'; end if;
  elsif p_family='memory_cards' then
    v_keys:=array['document_id','owner_id','section_id','card_type','title','content','normalized_terms','page_number','source_chunk_ids','source_image_ids','confidence','producer','artifact_generation_id','index_generation_id','metadata','embedding'];
    if p_output?'producerContext' or v_native->'section_id' is distinct from 'null'::jsonb then raise exception 'shadow_deep_association_invalid'; end if;
    v_association:=p_output->'sectionAssociation';
    if v_association->>'tag'='index' then
      if not public.shadow_keys_v1(v_association,array['tag','index']) or pg_catalog.jsonb_typeof(v_association->'index') is distinct from 'number'
        or (v_association->>'index')::numeric not between 0 and 2147483647
        or (v_association->>'index')::numeric<>pg_catalog.trunc((v_association->>'index')::numeric) then raise exception 'shadow_deep_association_invalid'; end if;
    elsif not public.shadow_keys_v1(v_association,array['tag']) or (v_association->>'tag' in ('own_undefined','absent')) is not true
      then raise exception 'shadow_deep_association_invalid'; end if;
  elsif p_family='index_units' then
    v_keys:=array['owner_id','document_id','unit_type','source_chunk_id','source_image_id','page_start','page_end','heading_path','title','content','normalized_terms','source_span','quality_score','extraction_mode','metadata','producer','artifact_generation_id','index_generation_id','embedding'];
    if not public.shadow_keys_v1(p_output,array['nativeInput']) then raise exception 'shadow_deep_native_invalid'; end if;
  else
    v_keys:=array['alias','canonical','alias_type','weight','enabled','metadata'];
    if not public.shadow_keys_v1(p_output,array['nativeInput']) then raise exception 'shadow_deep_native_invalid'; end if;
  end if;
  if not public.shadow_keys_v1(v_native,v_keys) or pg_catalog.jsonb_typeof(v_native->'metadata') is distinct from 'object'
    or v_native->'metadata'->>'generated_by' is distinct from 'local-worker'
    or v_native->'metadata'->>'artifact_generation_id' is distinct from p_artifact::text then raise exception 'shadow_deep_native_identity'; end if;
  if p_family<>'producer_aliases' then
    if v_native->>'document_id' is distinct from p_member.document_id::text
      or v_native->'owner_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.owner_id),'null'::jsonb)
      or v_native->>'producer' is distinct from 'local-worker' or v_native->>'artifact_generation_id' is distinct from p_artifact::text
      or v_native->>'index_generation_id' is distinct from p_artifact::text
      or v_native->'metadata'->>'index_generation_id' is distinct from p_artifact::text
      or v_native->'metadata'->>'ingestion_lease_token' is distinct from p_member.first_lease_token::text then raise exception 'shadow_deep_native_identity'; end if;
  elsif v_native->'metadata'->>'document_id' is distinct from p_member.document_id::text
    or v_native->'metadata'->>'source' is distinct from 'model_index_profile'
    or v_native->'metadata'->>'model_index_version' is distinct from 'model-heavy-index-v1'
    or v_native->'enabled' is distinct from 'true'::jsonb then raise exception 'shadow_deep_alias_identity'; end if;
  foreach v_key in array array['section_index','page_start','page_end','page_number'] loop
    if not(v_native?v_key) then continue; end if;
    v_value:=v_native->v_key;
    if v_value='null'::jsonb and v_key<>'section_index' then continue; end if;
    if pg_catalog.jsonb_typeof(v_value) is distinct from 'number' or (v_value::text)::numeric not between 0 and 2147483647
      or (v_value::text)::numeric<>pg_catalog.trunc((v_value::text)::numeric) then raise exception 'shadow_deep_native_integer'; end if;
  end loop;
  foreach v_key in array array['heading','summary','title','content','card_type','unit_type','extraction_quality','extraction_mode','alias','canonical','alias_type'] loop
    if v_native?v_key and pg_catalog.jsonb_typeof(v_native->v_key) is distinct from 'string' then raise exception 'shadow_deep_native_text'; end if;
  end loop;
  foreach v_key in array array['heading_path','chunk_ids','tags','normalized_terms','source_chunk_ids','source_image_ids'] loop
    if not(v_native?v_key) then continue; end if;
    if pg_catalog.jsonb_typeof(v_native->v_key) is distinct from 'array'
      or exists(select 1 from pg_catalog.jsonb_array_elements(v_native->v_key) x where pg_catalog.jsonb_typeof(x) is distinct from 'string')
      then raise exception 'shadow_deep_native_array'; end if;
  end loop;
  foreach v_key in array array['confidence','quality_score','weight'] loop
    if not(v_native?v_key) then continue; end if;
    if pg_catalog.jsonb_typeof(v_native->v_key) is distinct from 'number' or (v_native->>v_key)::numeric<0
      or (v_native->>v_key)::numeric>(case when v_key='weight' then 1.5 else 1 end) then raise exception 'shadow_deep_native_score'; end if;
  end loop;
  if p_family in ('memory_cards','index_units') then
    if pg_catalog.jsonb_typeof(v_native->'embedding') is distinct from 'array' or pg_catalog.jsonb_array_length(v_native->'embedding')<>1536
      or exists(select 1 from pg_catalog.jsonb_array_elements(v_native->'embedding') x where pg_catalog.jsonb_typeof(x) is distinct from 'number') then raise exception 'shadow_deep_native_vector'; end if;
  end if;
  if p_family='sections' then
    perform public.assert_ingestion_artifact_sources(pg_catalog.jsonb_build_object('source_chunk_ids',v_native->'chunk_ids'),p_member.document_id,p_member.index_generation_id,null);
  elsif p_family='producer_aliases' then
    perform public.assert_ingestion_artifact_sources(v_native->'metadata',p_member.document_id,p_member.index_generation_id,null);
  else
    perform public.assert_ingestion_artifact_sources(v_native,p_member.document_id,p_member.index_generation_id,null);
  end if;
  return v_native;
end $$;
alter function public.shadow_deep_native_v1(public.document_index_generations,uuid,text,jsonb) owner to postgres;
revoke all on function public.shadow_deep_native_v1(public.document_index_generations,uuid,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_deep_batch_v1(p_member public.document_index_generations,p_artifact uuid,p_output jsonb,p_request jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_batch jsonb;v_unit jsonb;v_native jsonb;v_context jsonb;v_profile jsonb;v_family text;v_count integer;v_i integer;
  v_counts jsonb;v_aliases jsonb:='[]'::jsonb;v_anchor jsonb;v_fence jsonb;v_item jsonb;v_key text;
begin
  v_batch:=public.shadow_projection_batch_v1(p_member,'deep_memory',p_output);
  if v_batch->'binding' is distinct from public.shadow_projection_binding_v1(p_member,p_artifact)
    or not public.shadow_keys_v1(p_request,array['fence','artifact_generation','rag_memory_version','document_intelligence_version','section_count','memory_card_count','index_unit_counts_by_type','anchors','aliases'])
    or p_request->>'artifact_generation' is distinct from p_artifact::text
    or p_request->>'rag_memory_version' is distinct from 'rag-deep-memory-v1'
    or p_request->>'document_intelligence_version' is distinct from 'document-intelligence-v2'
    then raise exception 'shadow_deep_request_invalid'; end if;
  v_fence:=p_request->'fence';
  if not public.shadow_keys_v1(v_fence,array['job_kind','job_id','document_id','worker_id','lease_token','expected_generation_id','authority_digest'])
    or v_fence->>'job_kind' is distinct from 'node' or v_fence->>'job_id' is distinct from p_member.job_id::text
    or v_fence->>'document_id' is distinct from p_member.document_id::text or v_fence->>'lease_token' is distinct from p_member.first_lease_token::text
    or v_fence->'expected_generation_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.baseline_generation_id),'null'::jsonb)
    or v_fence->>'authority_digest' is distinct from p_member.authority_digest then raise exception 'shadow_deep_request_fence'; end if;
  foreach v_family in array array['sections','memory_cards','index_units','producer_aliases'] loop
    select count(*) into v_count from pg_catalog.jsonb_array_elements(v_batch->'units') x where x->>'family'=v_family;
    if v_family in ('sections','memory_cards') and (v_count=0 or p_request->(case when v_family='sections' then 'section_count' else 'memory_card_count' end) is distinct from pg_catalog.to_jsonb(v_count))
      then raise exception 'shadow_deep_request_population'; end if;
    for v_i in 0..v_count-1 loop
      select value into v_unit from pg_catalog.jsonb_array_elements(v_batch->'units') where value->>'family'=v_family and value->>'key'='deep:'||v_i::text;
      if not found then raise exception 'shadow_deep_planned_ordinal'; end if;
      v_native:=public.shadow_deep_native_v1(p_member,p_artifact,v_family,v_unit->'output');
      if v_family='sections' then
        if v_native->>'section_index' is distinct from v_i::text then raise exception 'shadow_deep_section_index'; end if;
        if v_i=0 then v_context:=v_unit->'output'->'producerContext';
        elsif v_unit->'output'?'producerContext' then raise exception 'shadow_deep_context_duplicate'; end if;
      elsif v_family='memory_cards' and v_unit->'output'->'sectionAssociation'->>'tag'='index' then
        if (v_unit->'output'->'sectionAssociation'->>'index')::integer>=(p_request->>'section_count')::integer then raise exception 'shadow_deep_section_membership'; end if;
      elsif v_family='producer_aliases' then v_aliases:=v_aliases||pg_catalog.jsonb_build_array(v_native); end if;
    end loop;
  end loop;
  if not public.shadow_keys_v1(v_context,array['modelProfile','request']) or v_context->'request' is distinct from p_request
    or v_aliases is distinct from p_request->'aliases' then raise exception 'shadow_deep_original_context'; end if;
  select coalesce(pg_catalog.jsonb_object_agg(unit_type,unit_count),'{}'::jsonb) into v_counts from (
    select value->'output'->'nativeInput'->>'unit_type' unit_type,count(*) unit_count from pg_catalog.jsonb_array_elements(v_batch->'units')
      where value->>'family'='index_units' group by value->'output'->'nativeInput'->>'unit_type'
  ) counts;
  if v_counts is distinct from p_request->'index_unit_counts_by_type' then raise exception 'shadow_deep_unit_counts'; end if;
  if pg_catalog.jsonb_typeof(p_request->'anchors') is distinct from 'array' or pg_catalog.jsonb_array_length(p_request->'anchors')>100000
    or pg_catalog.jsonb_array_length(v_aliases)>500 then raise exception 'shadow_deep_request_limit'; end if;
  for v_anchor in select value from pg_catalog.jsonb_array_elements(p_request->'anchors') loop
    if not public.shadow_keys_v1(v_anchor,array['id','anchor_id']) or pg_catalog.jsonb_typeof(v_anchor->'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_anchor->'anchor_id') is distinct from 'string' or pg_catalog.length(v_anchor->>'anchor_id')=0
      or not exists(select 1 from public.document_chunks c where c.id=(v_anchor->>'id')::uuid and c.document_id=p_member.document_id and c.index_generation_id=p_member.index_generation_id
        and (c.anchor_id is null or c.anchor_id=v_anchor->>'anchor_id')) then raise exception 'shadow_deep_anchor_membership'; end if;
  end loop;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_request->'anchors'))<>(select count(distinct value->'id') from pg_catalog.jsonb_array_elements(p_request->'anchors')) then raise exception 'shadow_deep_anchor_duplicate'; end if;
  v_profile:=v_context->'modelProfile';
  if not public.shadow_keys_v1(v_profile,array['sections','askable_questions','clinical_facts','table_facts','aliases','quality_issues','model','version'])
    or v_profile->>'version' is distinct from 'model-heavy-index-v1' or (pg_catalog.jsonb_typeof(v_profile->'model') in ('string','null')) is not true then raise exception 'shadow_deep_model_profile'; end if;
  foreach v_key in array array['sections','askable_questions','clinical_facts','table_facts','aliases','quality_issues'] loop
    if pg_catalog.jsonb_typeof(v_profile->v_key) is distinct from 'array' then raise exception 'shadow_deep_model_profile'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_profile->v_key) loop
      if v_key='quality_issues' then
        if pg_catalog.jsonb_typeof(v_item) is distinct from 'string' then raise exception 'shadow_deep_model_issue'; end if;
        continue;
      elsif v_key='aliases' then
        if not public.shadow_keys_v1(v_item,array['alias','canonical','alias_type','source_chunk_ids','confidence'])
          or pg_catalog.jsonb_typeof(v_item->'alias') is distinct from 'string' or pg_catalog.jsonb_typeof(v_item->'canonical') is distinct from 'string'
          or pg_catalog.jsonb_typeof(v_item->'alias_type') is distinct from 'string' then raise exception 'shadow_deep_model_alias'; end if;
      else
        if not public.shadow_keys_v1(v_item,array['title','content','source_chunk_ids','source_image_ids','confidence']||
          case when v_key='table_facts' then array['table_title','clinical_parameter','threshold_value','action'] else array[]::text[] end)
          or pg_catalog.jsonb_typeof(v_item->'title') is distinct from 'string' or pg_catalog.jsonb_typeof(v_item->'content') is distinct from 'string'
          then raise exception 'shadow_deep_model_item'; end if;
        if v_key='table_facts' and exists(select 1 from pg_catalog.unnest(array['table_title','clinical_parameter','threshold_value','action']) k
          where (pg_catalog.jsonb_typeof(v_item->k) in ('string','null')) is not true) then raise exception 'shadow_deep_model_table'; end if;
      end if;
      if pg_catalog.jsonb_typeof(v_item->'confidence') is distinct from 'number' or (v_item->>'confidence')::numeric not between 0 and 1
        or pg_catalog.jsonb_typeof(v_item->'source_chunk_ids') is distinct from 'array'
        or exists(select 1 from pg_catalog.jsonb_array_elements(v_item->'source_chunk_ids') x where pg_catalog.jsonb_typeof(x) is distinct from 'string')
        or (v_key<>'aliases' and (pg_catalog.jsonb_typeof(v_item->'source_image_ids') is distinct from 'array'
          or exists(select 1 from pg_catalog.jsonb_array_elements(v_item->'source_image_ids') x where pg_catalog.jsonb_typeof(x) is distinct from 'string')))
        then raise exception 'shadow_deep_model_sources'; end if;
      perform public.assert_ingestion_artifact_sources(v_item,p_member.document_id,p_member.index_generation_id,null);
    end loop;
  end loop;
  return v_batch;
end $$;
alter function public.shadow_deep_batch_v1(public.document_index_generations,uuid,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_deep_batch_v1(public.document_index_generations,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Match actual server rows to original native deep inputs. Generated identifiers,
-- times, section-id resolution, typed SQL/vector storage and the single D -> C
-- generation change are explicit; original native JSON remains untouched.
create or replace function public.shadow_deep_row_matches_v1(p_member public.document_index_generations,p_family text,p_key text,p_row jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare v_declaration jsonb;v_batch jsonb;v_output jsonb;v_native jsonb;v_expected jsonb;v_d uuid;v_section uuid;v_generation uuid;
begin
  select s->'declaration' into v_declaration from pg_catalog.jsonb_array_elements(p_member.inventory_manifest->'families') f
    cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where f->>'family'=p_family and s->>'groupKey'='deep_memory' and s->>'state'='declared';
  if not found then return false; end if;
  v_d:=(v_declaration->>'artifactGenerationId')::uuid;
  v_batch:=public.shadow_inventory_envelope_payload_v1(v_declaration->'outputManifestEnvelope');
  select value->'output' into v_output from pg_catalog.jsonb_array_elements(v_batch->'units') where value->>'family'=p_family and value->>'key'=p_key;
  if not found then return false; end if;
  v_native:=public.shadow_deep_native_v1(p_member,v_d,p_family,v_output);
  if p_family='producer_aliases' then return false; end if;
  v_generation:=(p_row->>'index_generation_id')::uuid;
  if (v_generation in (v_d,p_member.index_generation_id)) is not true or p_row->>'artifact_generation_id' is distinct from v_d::text
    or p_row->>'producer' is distinct from 'local-worker' or pg_catalog.jsonb_typeof(p_row->'id') is distinct from 'string' or (p_row->>'id')::uuid is null
    or public.shadow_audit_timestamp_v1(p_row->'created_at') is null or public.shadow_audit_timestamp_v1(p_row->'updated_at') is null then return false; end if;
  v_native:=v_native||pg_catalog.jsonb_build_object('id',p_row->'id','created_at',p_row->'created_at','updated_at',p_row->'updated_at',
    'index_generation_id',v_generation,'metadata',v_native->'metadata'||pg_catalog.jsonb_build_object('index_generation_id',v_generation,
      'ingestion_job_kind','node','ingestion_job_id',p_member.job_id,'ingestion_lease_token',p_member.first_lease_token));
  if p_family='sections' then
    v_expected:=pg_catalog.to_jsonb(pg_catalog.jsonb_populate_record(null::public.document_sections,v_native));
  elsif p_family='memory_cards' then
    if v_output->'sectionAssociation'->>'tag'='index' then
      select id into v_section from public.document_sections where document_id=p_member.document_id and artifact_generation_id=v_d and producer='local-worker'
        and section_index=(v_output->'sectionAssociation'->>'index')::integer
        and metadata->>'ingestion_lease_token'=p_member.first_lease_token::text;
      if not found then return false; end if;
    end if;
    v_native:=v_native||pg_catalog.jsonb_build_object('section_id',v_section);
    v_expected:=pg_catalog.to_jsonb(pg_catalog.jsonb_populate_record(null::public.document_memory_cards,v_native));
  elsif p_family='index_units' then
    v_expected:=pg_catalog.to_jsonb(pg_catalog.jsonb_populate_record(null::public.document_index_units,v_native));
  else return false; end if;
  -- search_tsv is a generated column, whose defining table expression is fixed.
  -- It is not supplied by the producer or available in a BEFORE INSERT trigger;
  -- the complete final value remains in the independently framed captured row.
  return v_expected-'search_tsv'=p_row-'search_tsv';
end $$;
alter function public.shadow_deep_row_matches_v1(public.document_index_generations,text,text,jsonb) owner to postgres;
revoke all on function public.shadow_deep_row_matches_v1(public.document_index_generations,text,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_deep_row_key_v1(p_member public.document_index_generations,p_family text,p_row jsonb)
returns text language plpgsql stable set search_path = '' as $$
declare v_unit record;v_key text;v_count integer:=0;
begin
  for v_unit in select unit_key from public.document_generation_inventory where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id
    and family=p_family and producer='local-worker' and artifact_generation_id=(p_row->>'artifact_generation_id')::uuid loop
    if public.shadow_deep_row_matches_v1(p_member,p_family,v_unit.unit_key,p_row) then v_count:=v_count+1;v_key:=v_unit.unit_key;end if;
  end loop;
  if v_count<>1 then raise exception 'shadow_deep_row_original_ambiguous'; end if;
  return v_key;
end $$;
alter function public.shadow_deep_row_key_v1(public.document_index_generations,text,jsonb) owner to postgres;
revoke all on function public.shadow_deep_row_key_v1(public.document_index_generations,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_candidate_anchor_update_v1(p_member public.document_index_generations,p_old jsonb,p_new jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare v_declaration jsonb;v_batch jsonb;v_request jsonb;
begin
  if p_old->'anchor_id' is distinct from 'null'::jsonb or pg_catalog.jsonb_typeof(p_new->'anchor_id') is distinct from 'string'
    or p_old-array['anchor_id','metadata'] is distinct from p_new-array['anchor_id','metadata'] then return false; end if;
  select s->'declaration' into v_declaration from pg_catalog.jsonb_array_elements(p_member.inventory_manifest->'families') f
    cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where f->>'family'='sections' and s->>'groupKey'='deep_memory' and s->>'state'='declared';
  if not found then return false; end if;
  v_batch:=public.shadow_inventory_envelope_payload_v1(v_declaration->'outputManifestEnvelope');
  select value->'output'->'producerContext'->'request' into v_request from pg_catalog.jsonb_array_elements(v_batch->'units') where value->>'family'='sections' and value->>'key'='deep:0';
  if not found or pg_catalog.jsonb_typeof(v_request->'anchors') is distinct from 'array' then return false; end if;
  return exists(select 1 from pg_catalog.jsonb_array_elements(v_request->'anchors') a where a->'id'=p_new->'id' and a->'anchor_id'=p_new->'anchor_id')
    and p_new->'metadata'=p_old->'metadata'||pg_catalog.jsonb_build_object('anchor_id',p_new->'anchor_id','anchor_repaired_by',v_request->'document_intelligence_version');
end $$;
alter function public.shadow_candidate_anchor_update_v1(public.document_index_generations,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_candidate_anchor_update_v1(public.document_index_generations,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.persist_shadow_deep_memory_projection(p_fence jsonb,p_generation uuid,p_artifact_generation uuid,p_output_manifest jsonb,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.document_index_generations%rowtype;v_existing public.document_generation_projections%rowtype;
  v_batch jsonb;v_output jsonb;v_native jsonb;v_family text;v_count integer;v_i integer;v_now timestamptz;v_stamp jsonb;
  v_section public.document_sections%rowtype;v_card public.document_memory_cards%rowtype;v_index_unit public.document_index_units%rowtype;v_alias public.rag_aliases%rowtype;
v_section_id uuid;v_aliases jsonb:='[]'::jsonb;v_anchor jsonb;v_repaired integer:=0;v_row record;v_rows jsonb;v_receipt jsonb;v_metadata jsonb;v_result jsonb;v_projection jsonb;v_digest text;v_total bigint;v_finalized timestamptz;
begin
  v_member:=public.shadow_assert_attempt_v1(p_fence,p_generation,null);
  if p_request->'fence' is distinct from p_fence then raise exception 'shadow_deep_request_fence'; end if;
  v_batch:=public.shadow_deep_batch_v1(v_member,p_artifact_generation,p_output_manifest,p_request);
  select * into v_existing from public.document_generation_projections where document_id=v_member.document_id and index_generation_id=p_generation for update;
  if found and v_existing.deep_memory_digest is not null then
    if v_existing.deep_memory_artifact_generation_id is distinct from p_artifact_generation
      or (v_existing.deep_memory_receipt->>'canonicalPayload')::jsonb->'request' is distinct from p_request
      or (v_existing.deep_memory_receipt->>'canonicalPayload')::jsonb->'outputManifestEnvelope' is distinct from p_output_manifest then raise exception 'shadow_deep_replay_conflict'; end if;
    return pg_catalog.jsonb_build_object('ok',true,'kind','unchanged','projection_digest',v_existing.deep_memory_digest,'receipt',v_existing.deep_memory_receipt);
  end if;
  if exists(select 1 from public.document_sections where artifact_generation_id=p_artifact_generation)
    or exists(select 1 from public.document_memory_cards where artifact_generation_id=p_artifact_generation)
    or exists(select 1 from public.document_index_units where artifact_generation_id=p_artifact_generation) then raise exception 'shadow_deep_existing_attempt_rows'; end if;
  v_now:=pg_catalog.clock_timestamp();
  v_stamp:=pg_catalog.jsonb_build_object('index_generation_id',p_artifact_generation,'ingestion_job_kind','node','ingestion_job_id',v_member.job_id,'ingestion_lease_token',v_member.first_lease_token);
  -- Every native input and all source/association/request populations were checked
  -- above. No ordinary staging cleanup, live singleton or producer replacement runs.
  foreach v_family in array array['sections','memory_cards','index_units'] loop
    select count(*) into v_count from pg_catalog.jsonb_array_elements(v_batch->'units') x where x->>'family'=v_family;
    for v_i in 0..v_count-1 loop
      v_output:=public.shadow_projection_planned_unit_v1(v_batch,v_family,'deep:'||v_i::text);
      v_native:=v_output->'nativeInput';
      v_native:=v_native||pg_catalog.jsonb_build_object('id',pg_catalog.gen_random_uuid(),'created_at',v_now,'updated_at',v_now,'metadata',v_native->'metadata'||v_stamp);
      if v_family='sections' then
        v_section:=pg_catalog.jsonb_populate_record(null::public.document_sections,v_native);
        insert into public.document_sections(id,document_id,owner_id,section_index,heading,heading_path,page_start,page_end,chunk_ids,summary,tags,extraction_quality,index_generation_id,producer,artifact_generation_id,metadata,created_at,updated_at)
          values(v_section.id,v_section.document_id,v_section.owner_id,v_section.section_index,v_section.heading,v_section.heading_path,v_section.page_start,v_section.page_end,v_section.chunk_ids,v_section.summary,v_section.tags,v_section.extraction_quality,v_section.index_generation_id,v_section.producer,v_section.artifact_generation_id,v_section.metadata,v_section.created_at,v_section.updated_at);
      elsif v_family='memory_cards' then
        v_section_id:=null;
        if v_output->'sectionAssociation'->>'tag'='index' then
          select id into strict v_section_id from public.document_sections where document_id=v_member.document_id and artifact_generation_id=p_artifact_generation and producer='local-worker'
            and section_index=(v_output->'sectionAssociation'->>'index')::integer;
        end if;
        v_card:=pg_catalog.jsonb_populate_record(null::public.document_memory_cards,v_native||pg_catalog.jsonb_build_object('section_id',v_section_id));
        insert into public.document_memory_cards(id,document_id,owner_id,section_id,card_type,title,content,normalized_terms,page_number,source_chunk_ids,source_image_ids,confidence,index_generation_id,producer,artifact_generation_id,metadata,embedding,created_at,updated_at)
          values(v_card.id,v_card.document_id,v_card.owner_id,v_card.section_id,v_card.card_type,v_card.title,v_card.content,v_card.normalized_terms,v_card.page_number,v_card.source_chunk_ids,v_card.source_image_ids,v_card.confidence,v_card.index_generation_id,v_card.producer,v_card.artifact_generation_id,v_card.metadata,v_card.embedding,v_card.created_at,v_card.updated_at);
      else
        v_index_unit:=pg_catalog.jsonb_populate_record(null::public.document_index_units,v_native);
        insert into public.document_index_units(id,owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,producer,artifact_generation_id,embedding,metadata,created_at,updated_at)
          values(v_index_unit.id,v_index_unit.owner_id,v_index_unit.document_id,v_index_unit.unit_type,v_index_unit.source_chunk_id,v_index_unit.source_image_id,v_index_unit.page_start,v_index_unit.page_end,v_index_unit.heading_path,v_index_unit.title,v_index_unit.content,v_index_unit.normalized_terms,v_index_unit.source_span,v_index_unit.quality_score,v_index_unit.extraction_mode,v_index_unit.index_generation_id,v_index_unit.producer,v_index_unit.artifact_generation_id,v_index_unit.embedding,v_index_unit.metadata,v_index_unit.created_at,v_index_unit.updated_at);
      end if;
    end loop;
  end loop;
  for v_anchor in select value from pg_catalog.jsonb_array_elements(p_request->'anchors') loop
    update public.document_chunks set anchor_id=v_anchor->>'anchor_id',metadata=metadata||pg_catalog.jsonb_build_object('anchor_id',v_anchor->'anchor_id','anchor_repaired_by',p_request->'document_intelligence_version')
      where id=(v_anchor->>'id')::uuid and document_id=v_member.document_id and index_generation_id=p_generation and anchor_id is null;
    if found then v_repaired:=v_repaired+1; end if;
  end loop;
  update public.document_sections set index_generation_id=p_generation,metadata=pg_catalog.jsonb_set(metadata,'{index_generation_id}',pg_catalog.to_jsonb(p_generation))
    where document_id=v_member.document_id and producer='local-worker' and artifact_generation_id=p_artifact_generation and index_generation_id=p_artifact_generation;
  get diagnostics v_count=row_count;
  if v_count<>(p_request->>'section_count')::integer then raise exception 'shadow_deep_section_finalization_count'; end if;
  update public.document_memory_cards set index_generation_id=p_generation,metadata=pg_catalog.jsonb_set(metadata,'{index_generation_id}',pg_catalog.to_jsonb(p_generation))
    where document_id=v_member.document_id and producer='local-worker' and artifact_generation_id=p_artifact_generation and index_generation_id=p_artifact_generation;
  get diagnostics v_count=row_count;
  if v_count<>(p_request->>'memory_card_count')::integer then raise exception 'shadow_deep_card_finalization_count'; end if;
  select coalesce(sum(value::text::bigint),0) into v_total from pg_catalog.jsonb_each(p_request->'index_unit_counts_by_type');
  update public.document_index_units set index_generation_id=p_generation,metadata=pg_catalog.jsonb_set(metadata,'{index_generation_id}',pg_catalog.to_jsonb(p_generation))
    where document_id=v_member.document_id and producer='local-worker' and artifact_generation_id=p_artifact_generation and index_generation_id=p_artifact_generation;
  get diagnostics v_count=row_count;
  if v_count<>v_total then raise exception 'shadow_deep_unit_finalization_count'; end if;
  for v_native in select value from pg_catalog.jsonb_array_elements(p_request->'aliases') loop
    -- Existing own producer aliases remain G0 evidence; foreign/manual collisions
    -- cannot be hidden by a candidate projection. Seal repeats the collision check.
    if exists(select 1 from public.rag_aliases a where a.owner_id is not distinct from v_member.owner_id and a.alias=v_native->>'alias' and a.alias_type=v_native->>'alias_type'
      and (a.metadata->>'generated_by' is distinct from 'local-worker' or a.metadata->>'document_id' is distinct from v_member.document_id::text)) then raise exception 'shadow_deep_alias_collision'; end if;
    v_alias:=pg_catalog.jsonb_populate_record(null::public.rag_aliases,v_native||pg_catalog.jsonb_build_object('id',pg_catalog.gen_random_uuid(),'owner_id',v_member.owner_id,'created_at',v_now,'updated_at',v_now,
      'metadata',v_native->'metadata'||v_stamp||pg_catalog.jsonb_build_object('index_generation_id',p_generation)));
    v_aliases:=v_aliases||pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(v_alias));
  end loop;
  v_rows:=pg_catalog.jsonb_build_object('sections','[]'::jsonb,'cards','[]'::jsonb,'units','[]'::jsonb,'aliases','[]'::jsonb);
  for v_row in select * from public.shadow_capture_rows_v1(array[v_member.document_id],array[]::uuid[]) where table_name in ('document_sections','document_memory_cards','document_index_units')
    and row_payload->>'artifact_generation_id'=p_artifact_generation::text order by table_name,row_order loop
    v_family:=case v_row.table_name when 'document_sections' then 'sections' when 'document_memory_cards' then 'cards' else 'units' end;
    v_rows:=pg_catalog.jsonb_set(v_rows,array[v_family],v_rows->v_family||pg_catalog.jsonb_build_array(public.shadow_capture_envelope_v1(v_row.row_payload)));
  end loop;
  for v_native in select value from pg_catalog.jsonb_array_elements(v_aliases) order by public.shadow_utf16_order_v1(value->>'id') loop
    v_rows:=pg_catalog.jsonb_set(v_rows,'{aliases}',v_rows->'aliases'||pg_catalog.jsonb_build_array(public.shadow_capture_envelope_v1(v_native)));
  end loop;
  -- Table UPDATE triggers own updated_at; preserve their actual values above.
  v_finalized:=pg_catalog.clock_timestamp();
  v_receipt:=public.shadow_pg_bundle_v1(pg_catalog.jsonb_build_object('kind','u04-deep-memory-receipt-v1','binding',public.shadow_projection_binding_v1(v_member,p_artifact_generation),
    'producer','local-worker','outputManifestEnvelope',p_output_manifest,'request',p_request,'rows',v_rows,'finalizedAt',v_finalized),'projection');
  v_result:=pg_catalog.jsonb_build_object('document_id',v_member.document_id,'producer','local-worker','artifact_generation_id',p_artifact_generation,
    'index_generation_id',p_generation,'section_count',p_request->'section_count','memory_card_count',p_request->'memory_card_count','index_unit_count',v_total);
  v_metadata:=pg_catalog.jsonb_build_object('rag_indexing_version',p_request->'rag_memory_version','rag_memory_version',p_request->'rag_memory_version','rag_memory_updated_at',v_finalized,
    'document_intelligence_version',p_request->'document_intelligence_version','document_intelligence_updated_at',v_finalized,'section_count',p_request->'section_count',
    'memory_card_count',p_request->'memory_card_count','index_unit_count',v_total,'index_unit_counts_by_type',p_request->'index_unit_counts_by_type','repaired_anchor_count',v_repaired,
    'deep_memory_generations',pg_catalog.jsonb_build_object('local-worker',p_artifact_generation),
    'deep_memory_commit_receipts',pg_catalog.jsonb_build_object('local-worker',pg_catalog.jsonb_build_object('request',p_request,'result',v_result)));
  v_projection:=pg_catalog.jsonb_build_object('kind','u04-deep-projection-v1','binding',public.shadow_projection_binding_v1(v_member,p_artifact_generation),
    'outputManifestEnvelope',p_output_manifest,'deep_memory_receipt',v_receipt,'deep_memory_metadata',v_metadata,'producer_aliases',v_aliases);
  v_digest:=public.shadow_pg_bundle_v1(v_projection,'projection')->>'digest';
  insert into public.document_generation_projections(document_id,index_generation_id,lease_token,owner_id,deep_memory_artifact_generation_id,deep_memory_receipt,deep_memory_metadata,producer_aliases,deep_memory_digest)
    values(v_member.document_id,p_generation,v_member.first_lease_token,v_member.owner_id,p_artifact_generation,v_receipt,v_metadata,v_aliases,v_digest)
    on conflict(document_id,index_generation_id) do update set deep_memory_artifact_generation_id=excluded.deep_memory_artifact_generation_id,
      deep_memory_receipt=excluded.deep_memory_receipt,deep_memory_metadata=excluded.deep_memory_metadata,producer_aliases=excluded.producer_aliases,deep_memory_digest=excluded.deep_memory_digest
      where public.document_generation_projections.deep_memory_digest is null and public.document_generation_projections.sealed_at is null;
  if not found then raise exception 'shadow_deep_projection_conflict'; end if;
  perform public.shadow_checkpoint_advance_v1(v_member.job_id);
  return pg_catalog.jsonb_build_object('ok',true,'kind','deep_memory_projected','projection_digest',v_digest,'receipt',v_receipt);
exception when others then raise exception 'invalid_shadow_deep_memory_projection' using errcode='22023';
end $$;
alter function public.persist_shadow_deep_memory_projection(jsonb,uuid,uuid,jsonb,jsonb) owner to postgres;
revoke all on function public.persist_shadow_deep_memory_projection(jsonb,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Complete component reconciliation for private projection writes. A validated
-- component still grants no terminal/member acceptance; the late seal is separate.
create or replace function public.shadow_validate_projection_components_v1(p_member public.document_index_generations,p_row public.document_generation_projections)
returns void language plpgsql stable set search_path = '' as $$
declare v_slot jsonb;v_output jsonb;v_batch jsonb;v_native jsonb;v_projection jsonb;v_stamp jsonb;v_labels jsonb;v_label jsonb;
  v_summary public.document_summaries%rowtype;v_typed_label public.document_labels%rowtype;v_quality public.document_index_quality%rowtype;
  v_receipt jsonb;v_request jsonb;v_rows jsonb;v_actual jsonb;v_aliases jsonb;v_alias public.rag_aliases%rowtype;
  v_item record;v_family text;v_key text;v_count bigint;v_total bigint;v_now timestamptz;v_created timestamptz;v_result jsonb;v_metadata jsonb;v_d uuid;
begin
  if p_row.document_id is distinct from p_member.document_id or p_row.index_generation_id is distinct from p_member.index_generation_id
    or p_row.owner_id is distinct from p_member.owner_id or p_row.lease_token is distinct from p_member.first_lease_token
    then raise exception 'shadow_projection_identity'; end if;
  v_stamp:=pg_catalog.jsonb_build_object('index_generation_id',p_member.index_generation_id,'ingestion_job_kind','node',
    'ingestion_job_id',p_member.job_id,'ingestion_lease_token',p_member.first_lease_token);
  if p_row.summary_digest is null then
    if p_row.summary is not null or p_row.generated_labels is not null or p_row.summary_projection_complete is not null or p_row.enrichment_metadata is not null
      then raise exception 'shadow_summary_component_incomplete'; end if;
  else
    select s->'declaration'->'outputManifestEnvelope' into v_output from pg_catalog.jsonb_array_elements(p_member.inventory_manifest->'families') f
      cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where f->>'family'='summary' and s->>'groupKey'='enrichment' and s->>'state'='declared';
    if not found then raise exception 'shadow_summary_declaration_required'; end if;
    v_batch:=public.shadow_projection_batch_v1(p_member,'enrichment',v_output);
    v_native:=public.shadow_projection_planned_unit_v1(v_batch,'summary','singleton');
    v_labels:='[]'::jsonb;
    for v_item in select value->'output' as label from pg_catalog.jsonb_array_elements(v_batch->'units') where value->>'family'='generated_labels' loop
      v_labels:=v_labels||pg_catalog.jsonb_build_array(v_item.label);
    end loop;
    perform public.shadow_summary_input_v1(p_member,v_native->'summary',v_labels,v_native->'enrichment_metadata',v_output);
    if p_row.summary_projection_complete is distinct from true or p_row.enrichment_metadata is distinct from v_native->'enrichment_metadata'
      or pg_catalog.jsonb_typeof(p_row.generated_labels) is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_row.generated_labels)<>pg_catalog.jsonb_array_length(v_labels) then raise exception 'shadow_summary_projection_population'; end if;
    v_summary:=pg_catalog.jsonb_populate_record(null::public.document_summaries,v_native->'summary');
    v_summary.id:=(p_row.summary->>'id')::uuid;v_summary.created_at:=(p_row.summary->>'created_at')::timestamptz;
    v_summary.updated_at:=v_summary.created_at;v_summary.metadata:=v_summary.metadata||v_stamp;
    if v_summary.id is null or v_summary.created_at is null or pg_catalog.to_jsonb(v_summary) is distinct from p_row.summary then raise exception 'shadow_summary_after_image'; end if;
    for v_label in select value from pg_catalog.jsonb_array_elements(p_row.generated_labels) loop
      select value into v_native from pg_catalog.jsonb_array_elements(v_labels) where value->'label'=v_label->'label' and value->'label_type'=v_label->'label_type';
      if not found then raise exception 'shadow_label_original_missing'; end if;
      v_typed_label:=pg_catalog.jsonb_populate_record(null::public.document_labels,v_native);
      v_typed_label.id:=(v_label->>'id')::uuid;v_typed_label.created_at:=v_summary.created_at;v_typed_label.updated_at:=v_summary.created_at;
      v_typed_label.metadata:=v_typed_label.metadata||v_stamp;
      if v_typed_label.id is null or v_typed_label.id=v_summary.id or pg_catalog.to_jsonb(v_typed_label) is distinct from v_label then raise exception 'shadow_label_after_image'; end if;
    end loop;
    if (select count(distinct value->'id') from pg_catalog.jsonb_array_elements(p_row.generated_labels))<>pg_catalog.jsonb_array_length(v_labels)
      or (select count(distinct (value->'label',value->'label_type')) from pg_catalog.jsonb_array_elements(p_row.generated_labels))<>pg_catalog.jsonb_array_length(v_labels)
      then raise exception 'shadow_label_duplicate'; end if;
    v_projection:=pg_catalog.jsonb_build_object('kind','u04-summary-projection-v1','binding',public.shadow_projection_binding_v1(p_member),
      'outputManifestEnvelope',v_output,'summary',p_row.summary,'generated_labels',p_row.generated_labels,
      'summary_projection_complete',p_row.summary_projection_complete,'enrichment_metadata',p_row.enrichment_metadata);
    if public.shadow_pg_bundle_v1(v_projection,'projection')->>'digest' is distinct from p_row.summary_digest then raise exception 'shadow_summary_projection_digest'; end if;
  end if;
  if p_row.quality_digest is null then
    if p_row.quality is not null then raise exception 'shadow_quality_component_incomplete'; end if;
  else
    select s->'declaration'->'outputManifestEnvelope' into v_output from pg_catalog.jsonb_array_elements(p_member.inventory_manifest->'families') f
      cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where f->>'family'='quality' and s->>'groupKey'='worker_core' and s->>'state'='declared';
    if not found then raise exception 'shadow_quality_declaration_required'; end if;
    v_batch:=public.shadow_projection_batch_v1(p_member,'worker_core',v_output);
    v_native:=public.shadow_projection_planned_unit_v1(v_batch,'quality','singleton');
    perform public.shadow_quality_input_v1(p_member,v_native,v_output);
    v_quality:=pg_catalog.jsonb_populate_record(null::public.document_index_quality,v_native);
    if pg_catalog.to_jsonb(v_quality) is distinct from p_row.quality then raise exception 'shadow_quality_after_image'; end if;
    v_projection:=pg_catalog.jsonb_build_object('kind','u04-quality-projection-v1','binding',public.shadow_projection_binding_v1(p_member),
      'outputManifestEnvelope',v_output,'quality',p_row.quality);
    if public.shadow_pg_bundle_v1(v_projection,'projection')->>'digest' is distinct from p_row.quality_digest then raise exception 'shadow_quality_projection_digest'; end if;
  end if;
  if p_row.deep_memory_digest is null then
    if p_row.deep_memory_artifact_generation_id is not null or p_row.deep_memory_receipt is not null
      or p_row.deep_memory_metadata is not null or p_row.producer_aliases is not null then raise exception 'shadow_deep_component_incomplete'; end if;
  else
    v_d:=p_row.deep_memory_artifact_generation_id;
    if v_d is null or not public.shadow_capture_raw_envelope_valid_v1(p_row.deep_memory_receipt)
      or p_row.deep_memory_receipt->>'domain' is distinct from 'projection' or p_row.deep_memory_receipt->>'encoding' is distinct from 'pg-jsonb-text-v1'
      then raise exception 'shadow_deep_receipt_envelope'; end if;
    v_receipt:=(p_row.deep_memory_receipt->>'canonicalPayload')::jsonb;
    if not public.shadow_keys_v1(v_receipt,array['kind','binding','producer','outputManifestEnvelope','request','rows','finalizedAt'])
      or v_receipt->>'kind' is distinct from 'u04-deep-memory-receipt-v1' or v_receipt->>'producer' is distinct from 'local-worker'
      or v_receipt->'binding' is distinct from public.shadow_projection_binding_v1(p_member,v_d) then raise exception 'shadow_deep_receipt_identity'; end if;
    v_output:=v_receipt->'outputManifestEnvelope';v_request:=v_receipt->'request';
    v_batch:=public.shadow_deep_batch_v1(p_member,v_d,v_output,v_request);
    v_now:=public.shadow_audit_timestamp_v1(v_receipt->'finalizedAt');
    if v_now is null then raise exception 'shadow_deep_receipt_timestamp'; end if;
    v_rows:=pg_catalog.jsonb_build_object('sections','[]'::jsonb,'cards','[]'::jsonb,'units','[]'::jsonb,'aliases','[]'::jsonb);
    for v_item in select * from public.shadow_capture_rows_v1(array[p_member.document_id],array[]::uuid[])
      where table_name in ('document_sections','document_memory_cards','document_index_units') and row_payload->>'artifact_generation_id'=v_d::text order by table_name,row_order loop
      v_family:=case v_item.table_name when 'document_sections' then 'sections' when 'document_memory_cards' then 'memory_cards' else 'index_units' end;
      if v_item.row_payload->>'index_generation_id' is distinct from p_member.index_generation_id::text
        or public.shadow_audit_timestamp_v1(v_item.row_payload->'created_at')>v_now or public.shadow_audit_timestamp_v1(v_item.row_payload->'updated_at')>v_now
        then raise exception 'shadow_deep_final_row_identity'; end if;
      if v_created is null then v_created:=public.shadow_audit_timestamp_v1(v_item.row_payload->'created_at');
      elsif v_created is distinct from public.shadow_audit_timestamp_v1(v_item.row_payload->'created_at') then raise exception 'shadow_deep_created_at_changed'; end if;
      perform public.shadow_deep_row_key_v1(p_member,v_family,v_item.row_payload);
      v_key:=case v_family when 'memory_cards' then 'cards' when 'index_units' then 'units' else 'sections' end;
      v_rows:=pg_catalog.jsonb_set(v_rows,array[v_key],v_rows->v_key||pg_catalog.jsonb_build_array(public.shadow_capture_envelope_v1(v_item.row_payload)));
    end loop;
    if pg_catalog.jsonb_array_length(v_rows->'sections')<>(v_request->>'section_count')::integer
      or pg_catalog.jsonb_array_length(v_rows->'cards')<>(v_request->>'memory_card_count')::integer then raise exception 'shadow_deep_final_population'; end if;
    select coalesce(sum(value::text::bigint),0) into v_total from pg_catalog.jsonb_each(v_request->'index_unit_counts_by_type');
    if pg_catalog.jsonb_array_length(v_rows->'units')<>v_total or pg_catalog.jsonb_typeof(p_row.producer_aliases) is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_row.producer_aliases)<>pg_catalog.jsonb_array_length(v_request->'aliases') then raise exception 'shadow_deep_alias_population'; end if;
    for v_item in select value as native,ord from pg_catalog.jsonb_array_elements(v_request->'aliases') with ordinality a(value,ord) loop
      v_native:=v_item.native;v_label:=p_row.producer_aliases->((v_item.ord-1)::integer);
      v_alias:=pg_catalog.jsonb_populate_record(null::public.rag_aliases,v_native||pg_catalog.jsonb_build_object('id',v_label->'id','owner_id',p_member.owner_id,
        'created_at',v_created,'updated_at',v_created,'metadata',v_native->'metadata'||v_stamp));
      if v_alias.id is null or pg_catalog.to_jsonb(v_alias) is distinct from v_label then raise exception 'shadow_deep_alias_after_image'; end if;
      if exists(select 1 from public.rag_aliases a where a.owner_id is not distinct from p_member.owner_id and a.alias=v_alias.alias and a.alias_type=v_alias.alias_type
        and (a.metadata->>'generated_by' is distinct from 'local-worker' or a.metadata->>'document_id' is distinct from p_member.document_id::text))
        then raise exception 'shadow_deep_alias_collision'; end if;
    end loop;
    if (select count(distinct value->'id') from pg_catalog.jsonb_array_elements(p_row.producer_aliases))<>pg_catalog.jsonb_array_length(p_row.producer_aliases)
      then raise exception 'shadow_deep_alias_duplicate'; end if;
    for v_label in select value from pg_catalog.jsonb_array_elements(p_row.producer_aliases) order by public.shadow_utf16_order_v1(value->>'id') loop
      v_rows:=pg_catalog.jsonb_set(v_rows,'{aliases}',v_rows->'aliases'||pg_catalog.jsonb_build_array(public.shadow_capture_envelope_v1(v_label)));
    end loop;
    if v_receipt->'rows' is distinct from v_rows then raise exception 'shadow_deep_receipt_row_population'; end if;
    for v_native in select value from pg_catalog.jsonb_array_elements(v_request->'anchors') loop
      if not exists(select 1 from public.document_chunks c where c.id=(v_native->>'id')::uuid and c.document_id=p_member.document_id and c.index_generation_id=p_member.index_generation_id
        and c.anchor_id=v_native->>'anchor_id' and c.metadata->>'anchor_id'=v_native->>'anchor_id'
        and c.metadata->'anchor_repaired_by'=v_request->'document_intelligence_version') then raise exception 'shadow_deep_anchor_after_image'; end if;
    end loop;
    v_result:=pg_catalog.jsonb_build_object('document_id',p_member.document_id,'producer','local-worker','artifact_generation_id',v_d,'index_generation_id',p_member.index_generation_id,
      'section_count',v_request->'section_count','memory_card_count',v_request->'memory_card_count','index_unit_count',v_total);
    v_metadata:=pg_catalog.jsonb_build_object('rag_indexing_version',v_request->'rag_memory_version','rag_memory_version',v_request->'rag_memory_version','rag_memory_updated_at',v_now,
      'document_intelligence_version',v_request->'document_intelligence_version','document_intelligence_updated_at',v_now,'section_count',v_request->'section_count',
      'memory_card_count',v_request->'memory_card_count','index_unit_count',v_total,'index_unit_counts_by_type',v_request->'index_unit_counts_by_type',
      'repaired_anchor_count',pg_catalog.jsonb_array_length(v_request->'anchors'),'deep_memory_generations',pg_catalog.jsonb_build_object('local-worker',v_d),
      'deep_memory_commit_receipts',pg_catalog.jsonb_build_object('local-worker',pg_catalog.jsonb_build_object('request',v_request,'result',v_result)));
    if p_row.deep_memory_metadata is distinct from v_metadata then raise exception 'shadow_deep_metadata_after_image'; end if;
    v_projection:=pg_catalog.jsonb_build_object('kind','u04-deep-projection-v1','binding',public.shadow_projection_binding_v1(p_member,v_d),
      'outputManifestEnvelope',v_output,'deep_memory_receipt',p_row.deep_memory_receipt,'deep_memory_metadata',p_row.deep_memory_metadata,'producer_aliases',p_row.producer_aliases);
    if public.shadow_pg_bundle_v1(v_projection,'projection')->>'digest' is distinct from p_row.deep_memory_digest then raise exception 'shadow_deep_projection_digest'; end if;
  end if;
  if p_row.worker_state_digest is null then
    if p_row.worker_metadata is not null or p_row.document_counts is not null then raise exception 'shadow_worker_component_incomplete'; end if;
  else
    select s->'declaration'->'outputManifestEnvelope' into v_output from pg_catalog.jsonb_array_elements(p_member.inventory_manifest->'families') f
      cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s where f->>'family'='document_metadata' and s->>'groupKey'='projection_aggregate' and s->>'state'='declared';
    if not found then raise exception 'shadow_worker_declaration_required'; end if;
    perform public.shadow_worker_projection_input_v1(p_member,p_row.worker_metadata,p_row.document_counts,v_output);
    v_projection:=pg_catalog.jsonb_build_object('kind','u04-worker-projection-v1','binding',public.shadow_projection_binding_v1(p_member),
      'outputManifestEnvelope',v_output,'worker_metadata',p_row.worker_metadata,'document_counts',p_row.document_counts);
    if public.shadow_pg_bundle_v1(v_projection,'projection')->>'digest' is distinct from p_row.worker_state_digest then raise exception 'shadow_worker_projection_digest'; end if;
  end if;
end $$;
alter function public.shadow_validate_projection_components_v1(public.document_index_generations,public.document_generation_projections) owner to postgres;
revoke all on function public.shadow_validate_projection_components_v1(public.document_index_generations,public.document_generation_projections) from public,anon,authenticated,service_role;

-- Fixed worker metadata projection; JSON metadata keys are data, never authority.
create or replace function public.shadow_worker_projection_input_v1(p_member public.document_index_generations,p_metadata jsonb,p_counts jsonb,p_output jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare v_batch jsonb;v_profile jsonb;v_projection public.document_generation_projections%rowtype;v_key text;v_value jsonb;v_count bigint;
  v_allowed text[]:=array['indexed_at','cover_image_id','rag_enrichment_version','rag_indexing_version','rag_memory_version','rag_memory_updated_at','rag_enrichment_updated_at','enrichment_status','enrichment_error','section_count','memory_card_count','extraction_quality','index_quality_score','index_quality_issues','index_quality_metrics','optional_index_write_issues','indexing_v3_agent_status','indexing_v3_agent_last_error','indexing_v3_agent_repair_reason','indexing_v3_agent_updated_at','completion_gate_missing','embedding_model','page_count','ocr_page_count','needs_ocr_page_count','text_character_count','extracted_image_count','searchable_image_count','skipped_image_count','skipped_image_reasons','image_type_counts','extraction_warnings','document_embedding_field_types','shadow_extraction','index_generation_id'];
begin
  v_batch:=public.shadow_projection_batch_v1(p_member,'projection_aggregate',p_output);
  if public.shadow_projection_planned_unit_v1(v_batch,'document_metadata','singleton') is distinct from
    pg_catalog.jsonb_build_object('worker_metadata',p_metadata,'document_counts',p_counts) then raise exception 'shadow_worker_original_changed'; end if;
  if pg_catalog.jsonb_typeof(p_metadata) is distinct from 'object' or p_metadata-v_allowed<>'{}'::jsonb
    or p_metadata->>'index_generation_id' is distinct from p_member.index_generation_id::text
    or not public.shadow_keys_v1(p_counts,array['page_count','chunk_count','image_count','status','error_message'])
    or (p_counts->>'status' in ('queued','processing','indexed','failed')) is not true
    or (pg_catalog.jsonb_typeof(p_counts->'error_message') in ('string','null')) is not true then raise exception 'shadow_worker_input_invalid'; end if;
  foreach v_key in array array['page_count','chunk_count','image_count'] loop
    v_value:=p_counts->v_key;
    if pg_catalog.jsonb_typeof(v_value) is distinct from 'number' or (v_value::text)::numeric not between 0 and 9007199254740991
      or (v_value::text)::numeric<>pg_catalog.trunc((v_value::text)::numeric) then raise exception 'shadow_worker_count_invalid'; end if;
  end loop;
  select count(*) into v_count from public.document_pages where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  if p_counts->'page_count' is distinct from pg_catalog.to_jsonb(v_count) then raise exception 'shadow_worker_page_population'; end if;
  select count(*) into v_count from public.document_chunks where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  if p_counts->'chunk_count' is distinct from pg_catalog.to_jsonb(v_count) then raise exception 'shadow_worker_chunk_population'; end if;
  select count(*) into v_count from public.document_images where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id and searchable;
  if p_counts->'image_count' is distinct from pg_catalog.to_jsonb(v_count) then raise exception 'shadow_worker_image_population'; end if;
  select * into v_projection from public.document_generation_projections where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  if not found or v_projection.quality_digest is null then raise exception 'shadow_worker_quality_required'; end if;
  if p_metadata->'extraction_quality' is distinct from v_projection.quality->'extraction_quality'
    or p_metadata->'index_quality_score' is distinct from v_projection.quality->'quality_score'
    or p_metadata->'index_quality_issues' is distinct from v_projection.quality->'issues'
    or p_metadata->'index_quality_metrics' is distinct from v_projection.quality->'metrics'
    or p_metadata->'optional_index_write_issues' is distinct from v_projection.quality->'metrics'->'optional_index_write_issues'
    then raise exception 'shadow_worker_quality_mismatch'; end if;
  foreach v_key in array array['page_count','ocr_page_count','needs_ocr_page_count','text_character_count','extracted_image_count','searchable_image_count','skipped_image_count',
    'section_count','memory_card_count','skipped_image_reasons','image_type_counts','extraction_warnings','document_embedding_field_types'] loop
    if p_metadata?v_key and p_metadata->v_key is distinct from v_projection.quality->'metrics'->v_key then raise exception 'shadow_worker_metrics_mismatch'; end if;
  end loop;
  foreach v_key in array array['rag_enrichment_version','rag_indexing_version','rag_memory_version'] loop
    if p_metadata?v_key and p_metadata->>v_key is distinct from 'rag-deep-memory-v1' then raise exception 'shadow_worker_version'; end if;
  end loop;
  foreach v_key in array array['indexed_at','rag_memory_updated_at','rag_enrichment_updated_at','indexing_v3_agent_updated_at'] loop
    if p_metadata?v_key and p_metadata->v_key<>'null'::jsonb then perform public.shadow_audit_timestamp_v1(p_metadata->v_key); end if;
  end loop;
  foreach v_key in array array['enrichment_error','indexing_v3_agent_last_error','indexing_v3_agent_repair_reason'] loop
    if p_metadata?v_key and (pg_catalog.jsonb_typeof(p_metadata->v_key) in ('string','null')) is not true then raise exception 'shadow_worker_error_type'; end if;
  end loop;
  if p_metadata?'enrichment_status' and (p_metadata->>'enrichment_status' in ('pending','completed','failed')) is not true
    or p_metadata?'indexing_v3_agent_status' and (p_metadata->>'indexing_v3_agent_status' in ('pending','completed')) is not true then raise exception 'shadow_worker_status'; end if;
  if p_metadata?'completion_gate_missing' and p_metadata->'completion_gate_missing'<>'null'::jsonb and
    (pg_catalog.jsonb_typeof(p_metadata->'completion_gate_missing') is distinct from 'array'
      or exists(select 1 from pg_catalog.jsonb_array_elements(p_metadata->'completion_gate_missing') x where pg_catalog.jsonb_typeof(x) is distinct from 'string'))
    then raise exception 'shadow_worker_completion_details'; end if;
  v_profile:=public.shadow_profile_capture_v1((p_member.original_origin_envelope->>'canonicalPayload')::jsonb->'executionProfileEnvelope');
  if p_metadata?'embedding_model' and p_metadata->'embedding_model' is distinct from
    public.shadow_node_payload_v1(v_profile->'configuration','u04-engine-config-v1')->'generation'->'embeddingModel' then raise exception 'shadow_worker_embedding_model'; end if;
  if p_metadata?'cover_image_id' and p_metadata->'cover_image_id'<>'null'::jsonb and not exists(select 1 from public.document_images i
    where i.id=(p_metadata->>'cover_image_id')::uuid and i.document_id=p_member.document_id and i.index_generation_id=p_member.index_generation_id
      and i.metadata->>'ingestion_lease_token'=p_member.first_lease_token::text) then raise exception 'shadow_worker_cover_image'; end if;
  if p_metadata?'shadow_extraction' then perform public.shadow_worker_extraction_metadata_v1(p_metadata->'shadow_extraction',p_member.index_generation_id); end if;
end $$;
alter function public.shadow_worker_projection_input_v1(public.document_index_generations,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_worker_projection_input_v1(public.document_index_generations,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_worker_extraction_metadata_v1(p_value jsonb,p_generation uuid)
returns void language plpgsql immutable set search_path = '' as $$
declare v_key text;v_part jsonb;v_field text;v_number jsonb;
begin
  if not public.shadow_keys_v1(p_value,array['version','extractor','mode','index_generation_id','cohort_percent','cohort_bucket','cohort_signals','outcome','error_kind','measured_at','docling_version','wall_ms','peak_rss_bytes','exit_code','docling','legacy','delta'])
    or p_value->'version' is distinct from '1'::jsonb or p_value->>'extractor' is distinct from 'docling' or p_value->>'mode' is distinct from 'shadow'
    or p_value->>'index_generation_id' is distinct from p_generation::text
    or (p_value->>'outcome' in ('ok','extraction_failed','timeout','runtime_unavailable','process_error','skipped_page_cap','skipped_concurrent')) is not true
    or (pg_catalog.jsonb_typeof(p_value->'error_kind') in ('string','null')) is not true
    or (pg_catalog.jsonb_typeof(p_value->'docling_version') in ('string','null')) is not true
    or pg_catalog.jsonb_typeof(p_value->'cohort_signals') is distinct from 'array'
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_value->'cohort_signals') x where (x#>>'{}' in ('tables','ocr','layout')) is not true)
    then raise exception 'shadow_worker_extraction_metadata'; end if;
  perform public.shadow_audit_timestamp_v1(p_value->'measured_at');
  foreach v_key in array array['cohort_percent','cohort_bucket','wall_ms','peak_rss_bytes','exit_code'] loop
    v_number:=p_value->v_key;
    if v_number='null'::jsonb and v_key not in ('cohort_percent','cohort_bucket') then continue; end if;
    if pg_catalog.jsonb_typeof(v_number) is distinct from 'number' or (v_number::text)::numeric<0
      or (v_key in ('cohort_percent','cohort_bucket','peak_rss_bytes','exit_code') and (v_number::text)::numeric<>pg_catalog.trunc((v_number::text)::numeric))
      then raise exception 'shadow_worker_extraction_number'; end if;
  end loop;
  if (p_value->>'cohort_percent')::numeric not between 1 and 5 or (p_value->>'cohort_bucket')::numeric not between 0 and 99 then raise exception 'shadow_worker_extraction_cohort'; end if;
  foreach v_key in array array['legacy','docling','delta'] loop
    v_part:=p_value->v_key;
    if v_part='null'::jsonb and v_key<>'legacy' then continue; end if;
    if not public.shadow_keys_v1(v_part,case v_key
      when 'legacy' then array['page_count','text_character_count','ocr_page_count','table_count','table_row_count','numeric_token_count','wall_ms']
      when 'docling' then array['page_count','text_character_count','table_count','table_cell_count','numeric_token_count']
      else array['page_count','text_character_ratio','table_count','numeric_token_ratio'] end) then raise exception 'shadow_worker_extraction_shape'; end if;
    for v_field,v_number in select key,value from pg_catalog.jsonb_each(v_part) loop
      if v_number='null'::jsonb and v_field in ('wall_ms','text_character_ratio','numeric_token_ratio') then continue; end if;
      if pg_catalog.jsonb_typeof(v_number) is distinct from 'number'
        or (v_key<>'delta' and (v_number::text)::numeric<0)
        or (v_field not in ('wall_ms','text_character_ratio','numeric_token_ratio') and (v_number::text)::numeric<>pg_catalog.trunc((v_number::text)::numeric))
        then raise exception 'shadow_worker_extraction_value'; end if;
    end loop;
  end loop;
  if (p_value->>'outcome'='ok') is distinct from (p_value->'docling'<>'null'::jsonb and p_value->'delta'<>'null'::jsonb)
    then raise exception 'shadow_worker_extraction_outcome'; end if;
end $$;
alter function public.shadow_worker_extraction_metadata_v1(jsonb,uuid) owner to postgres;
revoke all on function public.shadow_worker_extraction_metadata_v1(jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function public.persist_shadow_worker_projection(p_fence jsonb,p_generation uuid,p_metadata jsonb,p_counts jsonb,p_output_manifest jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.document_index_generations%rowtype;v_existing public.document_generation_projections%rowtype;v_projection jsonb;v_digest text;
begin
  v_member:=public.shadow_assert_attempt_v1(p_fence,p_generation,null);
  perform public.shadow_worker_projection_input_v1(v_member,p_metadata,p_counts,p_output_manifest);
  v_projection:=pg_catalog.jsonb_build_object('kind','u04-worker-projection-v1','binding',public.shadow_projection_binding_v1(v_member),
    'outputManifestEnvelope',p_output_manifest,'worker_metadata',p_metadata,'document_counts',p_counts);
  v_digest:=public.shadow_pg_bundle_v1(v_projection,'projection')->>'digest';
  select * into v_existing from public.document_generation_projections where document_id=v_member.document_id and index_generation_id=p_generation for update;
  if found and v_existing.worker_state_digest is not null then
    if v_existing.worker_state_digest is distinct from v_digest or v_existing.worker_metadata is distinct from p_metadata or v_existing.document_counts is distinct from p_counts
      then raise exception 'shadow_worker_replay_conflict'; end if;
    return pg_catalog.jsonb_build_object('ok',true,'kind','unchanged','projection_digest',v_digest);
  end if;
  insert into public.document_generation_projections(document_id,index_generation_id,lease_token,owner_id,worker_metadata,document_counts,worker_state_digest)
    values(v_member.document_id,p_generation,v_member.first_lease_token,v_member.owner_id,p_metadata,p_counts,v_digest)
    on conflict(document_id,index_generation_id) do update set worker_metadata=excluded.worker_metadata,document_counts=excluded.document_counts,worker_state_digest=excluded.worker_state_digest
      where public.document_generation_projections.worker_state_digest is null and public.document_generation_projections.sealed_at is null;
  if not found then raise exception 'shadow_worker_projection_conflict'; end if;
  perform public.shadow_checkpoint_advance_v1(v_member.job_id);
  return pg_catalog.jsonb_build_object('ok',true,'kind','worker_projected','projection_digest',v_digest);
exception when others then raise exception 'invalid_shadow_worker_projection' using errcode='22023';
end $$;
alter function public.persist_shadow_worker_projection(jsonb,uuid,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.persist_shadow_worker_projection(jsonb,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- U04 atomic private seal and complete wave readback.
create or replace function public.shadow_final_candidate_rows_v1(p_member public.document_index_generations)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_unit public.document_generation_inventory%rowtype;v_table text;v_row jsonb;v_count bigint;v_rows jsonb:='[]'::jsonb;v_seen jsonb:='[]'::jsonb;
begin
  for v_unit in select * from public.document_generation_inventory where document_id=p_member.document_id
    and index_generation_id=p_member.index_generation_id and disposition='retained' and artifact_ref->>'tag'='candidate_row'
    order by public.shadow_utf16_order_v1(family),public.shadow_utf16_order_v1(unit_key) loop
    v_table:=case v_unit.artifact_ref->>'owner' when 'page' then 'document_pages' when 'chunk' then 'document_chunks'
      when 'image' then 'document_images' when 'table_fact' then 'document_table_facts'
      when 'embedding_field' then 'document_embedding_fields' when 'index_unit' then 'document_index_units'
      when 'section' then 'document_sections' when 'memory_card' then 'document_memory_cards' end;
    if v_table is null or v_seen @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(v_table,v_unit.artifact_ref->'rowId'))
      then raise exception 'shadow_candidate_row_not_unique'; end if;
    select count(*),pg_catalog.jsonb_agg(row_payload)->0 into v_count,v_row
      from public.shadow_capture_rows_v1(array[p_member.document_id],array[]::uuid[])
      where table_name=v_table and row_payload->'id'=v_unit.artifact_ref->'rowId'
        and public.shadow_capture_envelope_v1(row_payload)->'digest'=v_unit.artifact_ref->'rowDigest';
    if v_count<>1 or v_unit.content_digest is distinct from v_unit.artifact_ref->>'rowDigest'
      then raise exception 'shadow_candidate_row_unavailable'; end if;
    v_rows:=v_rows||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'table',v_table,'rowEnvelope',public.shadow_capture_envelope_v1(v_row)));
    v_seen:=v_seen||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(v_table,v_unit.artifact_ref->'rowId'));
  end loop;
  select coalesce(pg_catalog.jsonb_agg(value order by public.shadow_utf16_order_v1(value->>'table'),
    public.shadow_utf16_order_v1((value->'rowEnvelope'->>'canonicalPayload')::jsonb->>'id')),'[]'::jsonb) into v_rows
    from pg_catalog.jsonb_array_elements(v_rows);
  return v_rows;
end $$;
alter function public.shadow_final_candidate_rows_v1(public.document_index_generations) owner to postgres;
revoke all on function public.shadow_final_candidate_rows_v1(public.document_index_generations) from public,anon,authenticated,service_role;

create or replace function public.shadow_final_retained_evidence_v1(p_member public.document_index_generations)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_family jsonb;v_group jsonb;v_declaration jsonb;v_batch jsonb;v_unit jsonb;v_envelope jsonb;v_entry jsonb;
  v_result jsonb:='[]'::jsonb;v_seen jsonb:='{}'::jsonb;v_representation text;v_digest text;
begin
  for v_family in select value from pg_catalog.jsonb_array_elements(p_member.inventory_manifest->'families') loop
    for v_group in select value from pg_catalog.jsonb_array_elements(v_family->'groups') loop
      if v_group->>'state'<>'declared' then raise exception 'shadow_manifest_incomplete'; end if;
      v_declaration:=v_group->'declaration';v_envelope:=v_declaration->'outputManifestEnvelope';
      v_digest:=v_envelope->>'digest';v_representation:='producer_json';
      v_entry:=pg_catalog.jsonb_build_object('tag','payload','envelope',v_envelope,'representation',v_representation,
        'mediaType','application/json','byteLength',pg_catalog.octet_length(pg_catalog.convert_to(v_envelope->>'canonicalPayload','UTF8')));
      if v_seen ? v_digest then
        if v_seen->v_digest is distinct from v_entry then raise exception 'shadow_retained_payload_conflict'; end if;
      else v_seen:=v_seen||pg_catalog.jsonb_build_object(v_digest,v_entry);v_result:=v_result||pg_catalog.jsonb_build_array(v_entry);end if;
      v_batch:=public.shadow_inventory_envelope_payload_v1(v_envelope);
      for v_unit in select value from pg_catalog.jsonb_array_elements(v_batch->'units')
        where value->>'family' in ('native_structure','cache_inputs','attempt_control','repair_audit_inputs')
        order by public.shadow_utf16_order_v1(value->>'family'),public.shadow_utf16_order_v1(value->>'key') loop
        v_envelope:=v_unit->'output';v_digest:=v_envelope->>'digest';
        v_representation:=case v_unit->>'family' when 'cache_inputs' then 'cache_input'
          when 'attempt_control' then 'control_checkpoint' when 'repair_audit_inputs' then 'repair_audit_input'
          else 'producer_json' end;
        if public.shadow_capture_raw_envelope_valid_v1(v_envelope) is not true then raise exception 'shadow_retained_payload_invalid'; end if;
        v_entry:=pg_catalog.jsonb_build_object('tag','payload','envelope',v_envelope,'representation',v_representation,
          'mediaType','application/json','byteLength',pg_catalog.octet_length(pg_catalog.convert_to(v_envelope->>'canonicalPayload','UTF8')));
        if v_seen ? v_digest then
          if v_seen->v_digest is distinct from v_entry then raise exception 'shadow_retained_payload_conflict'; end if;
        else v_seen:=v_seen||pg_catalog.jsonb_build_object(v_digest,v_entry);v_result:=v_result||pg_catalog.jsonb_build_array(v_entry);end if;
      end loop;
      for v_unit in select value from pg_catalog.jsonb_array_elements(v_batch->'units')
        where value->>'family'='private_objects' order by public.shadow_utf16_order_v1(value->>'key') loop
        v_entry:=v_unit->'output';
        if v_entry->>'tag'<>'private_object' or not public.shadow_keys_v1(v_entry,array['tag','ref','bytes'])
          then raise exception 'shadow_private_evidence_invalid'; end if;
        v_digest:=public.shadow_node_value_text_v1(v_entry->'ref');
        if v_seen ? v_digest then
          if v_seen->v_digest is distinct from v_entry then raise exception 'shadow_private_evidence_conflict'; end if;
        else v_seen:=v_seen||pg_catalog.jsonb_build_object(v_digest,v_entry);v_result:=v_result||pg_catalog.jsonb_build_array(v_entry);end if;
      end loop;
    end loop;
  end loop;
  return v_result;
end $$;
alter function public.shadow_final_retained_evidence_v1(public.document_index_generations) owner to postgres;
revoke all on function public.shadow_final_retained_evidence_v1(public.document_index_generations) from public,anon,authenticated,service_role;

create or replace function public.shadow_final_inventory_v1(p_member public.document_index_generations,p_sealed_at timestamptz,p_preseal_control jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_projection public.document_generation_projections%rowtype;v_profile jsonb;v_declarations jsonb;v_dispositions jsonb;
  v_expected jsonb;v_projection_envelope jsonb;v_result jsonb;v_unit public.document_generation_inventory%rowtype;v_expected_count bigint;v_actual_count bigint;
begin
  if p_member.state<>'building' or p_member.expected_inventory_digest is null or p_member.inventory_digest is not null
    or p_member.stage_receipt is not null or p_member.stage_receipt_digest is not null or p_member.staged_at is not null
    or pg_catalog.jsonb_path_exists(p_member.inventory_manifest,'$.families[*].groups[*] ? (@.state == "pending")')
    or p_preseal_control is distinct from p_member.control_snapshot then raise exception 'shadow_preseal_member_invalid'; end if;
  if not public.shadow_generation_manifest_shape(p_member.inventory_manifest,p_member.first_lease_token)
    then raise exception 'shadow_manifest_invalid'; end if;
  select * into strict v_projection from public.document_generation_projections where document_id=p_member.document_id
    and index_generation_id=p_member.index_generation_id for update;
  if v_projection.sealed_at is not null or v_projection.owner_id is distinct from p_member.owner_id
    or v_projection.lease_token is distinct from p_member.first_lease_token then raise exception 'shadow_projection_presealed'; end if;
  perform public.shadow_validate_projection_components_v1(p_member,v_projection);
  select count(*) into v_expected_count from pg_catalog.jsonb_array_elements(p_member.inventory_manifest->'families') f
    cross join lateral pg_catalog.jsonb_array_elements(f->'groups') g
    cross join lateral pg_catalog.jsonb_array_elements(case when g->>'state'='declared' and g->'declaration'->'population'->>'tag'='known'
      then g->'declaration'->'population'->'expectedUnits' else '[]'::jsonb end) u;
  select count(*) into v_actual_count from public.document_generation_inventory where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  if v_actual_count<>v_expected_count or exists(select 1 from public.document_generation_inventory where document_id=p_member.document_id
      and index_generation_id=p_member.index_generation_id and (disposition='pending' or required and disposition<>'retained'))
    then raise exception 'shadow_inventory_incomplete'; end if;
  for v_unit in select * from public.document_generation_inventory where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id
    order by public.shadow_utf16_order_v1(family),public.shadow_utf16_order_v1(unit_key) loop
    perform public.shadow_validate_final_disposition_v1(p_member,p_member.inventory_manifest,public.shadow_inventory_outcome_v1(v_unit));
  end loop;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('family',family,'unitKey',unit_key,'expected',expected,
    'required',required,'producer',producer,'sourceBinding',source_binding)
    order by public.shadow_utf16_order_v1(family),public.shadow_utf16_order_v1(unit_key)),'[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(public.shadow_inventory_outcome_v1(i)
    order by public.shadow_utf16_order_v1(family),public.shadow_utf16_order_v1(unit_key)),'[]'::jsonb)
    into v_declarations,v_dispositions from public.document_generation_inventory i
    where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  v_expected:=public.shadow_pg_bundle_v1(pg_catalog.jsonb_build_object('manifest',p_member.inventory_manifest,'declarations',v_declarations),'inventory');
  if v_expected->>'digest' is distinct from p_member.expected_inventory_digest then raise exception 'shadow_expected_inventory_changed'; end if;
  v_projection.sealed_at:=p_sealed_at;
  v_projection_envelope:=public.shadow_pg_bundle_v1(pg_catalog.to_jsonb(v_projection),'projection');
  v_result:=public.shadow_pg_bundle_v1(pg_catalog.jsonb_build_object('kind','u04-final-inventory-v1','version',1,
    'binding',public.shadow_projection_binding_v1(p_member,null),'expectedInventoryEnvelope',v_expected,
    'finalDispositions',v_dispositions,'projectionEnvelope',v_projection_envelope,
    'preSealControlEnvelope',public.shadow_pg_bundle_v1(p_preseal_control,'control'),
    'candidateRows',public.shadow_final_candidate_rows_v1(p_member),
    'retainedEvidence',public.shadow_final_retained_evidence_v1(p_member)),'inventory');
  v_profile:=public.shadow_profile_capture_v1((p_member.original_origin_envelope->>'canonicalPayload')::jsonb->'executionProfileEnvelope');
  if pg_catalog.octet_length(pg_catalog.convert_to(v_result->>'canonicalPayload','UTF8'))>(v_profile->'limits'->>'maxOriginBundleBytes')::bigint
    then raise exception 'shadow_final_inventory_too_large'; end if;
  return v_result;
end $$;
alter function public.shadow_final_inventory_v1(public.document_index_generations,timestamptz,jsonb) owner to postgres;
revoke all on function public.shadow_final_inventory_v1(public.document_index_generations,timestamptz,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_terminal_consistency_v1()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare v_job uuid;
begin
  if tg_table_schema<>'public' or tg_table_name not in ('ingestion_jobs','document_index_generations','document_generation_projections')
    then raise exception 'shadow_terminal_guard_owner'; end if;
  if tg_table_name='ingestion_jobs' then
    if new.operation<>'shadow_reindex' then return null; end if;v_job:=new.id;
  elsif tg_table_name='document_index_generations' then v_job:=new.job_id;
  else select job_id into v_job from public.document_index_generations where document_id=new.document_id and index_generation_id=new.index_generation_id;
  end if;
  if v_job is not null then perform public.shadow_queue_complete_v1(v_job); end if;
  return null;
end $$;
alter function public.shadow_terminal_consistency_v1() owner to postgres;
revoke all on function public.shadow_terminal_consistency_v1() from public,anon,authenticated,service_role;

create constraint trigger document_index_generations_shadow_terminal_complete after insert or update on public.document_index_generations
  deferrable initially deferred for each row execute function public.shadow_terminal_consistency_v1();
create constraint trigger document_generation_projections_shadow_terminal_complete after insert or update on public.document_generation_projections
  deferrable initially deferred for each row execute function public.shadow_terminal_consistency_v1();

create or replace function public.shadow_member_stage_response_v1(p_member public.document_index_generations)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_wave public.shadow_reindex_waves%rowtype;v_origin jsonb;v_profile_envelope jsonb;v_profile jsonb;v_inventory jsonb;v_context jsonb;v_result jsonb;
begin
  if p_member.state<>'staged' or p_member.stage_receipt is null then raise exception 'shadow_member_not_staged'; end if;
  select * into strict v_wave from public.shadow_reindex_waves where candidate_generation_id=p_member.index_generation_id;
  v_origin:=(p_member.original_origin_envelope->>'canonicalPayload')::jsonb;
  v_profile_envelope:=v_origin->'executionProfileEnvelope';v_profile:=public.shadow_profile_capture_v1(v_profile_envelope);
  select coalesce(pg_catalog.jsonb_agg(public.shadow_capture_envelope_v1(pg_catalog.to_jsonb(i))
    order by public.shadow_utf16_order_v1(i.family),public.shadow_utf16_order_v1(i.unit_key)),'[]'::jsonb)
    into v_inventory from public.document_generation_inventory i where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  v_context:=pg_catalog.jsonb_build_object('memberRowEnvelope',public.shadow_capture_envelope_v1(pg_catalog.to_jsonb(p_member)),
    'profileEnvelope',v_profile_envelope,'inventoryRowEnvelopes',v_inventory,
    'originalOriginEnvelope',p_member.original_origin_envelope,'planDigest',v_wave.plan_digest);
  v_result:=pg_catalog.jsonb_build_object('ok',true,'kind','shadow_staged',
    'memberReceiptEnvelope',p_member.stage_receipt,'memberContext',v_context);
  if pg_catalog.octet_length(pg_catalog.convert_to(v_result::text,'UTF8'))>(v_profile->'limits'->>'maxOriginBundleBytes')::bigint
    then raise exception 'shadow_member_response_too_large'; end if;
  return v_result;
end $$;
alter function public.shadow_member_stage_response_v1(public.document_index_generations) owner to postgres;
revoke all on function public.shadow_member_stage_response_v1(public.document_index_generations) from public,anon,authenticated,service_role;

create or replace function public.stage_document_index_generation(p_fence jsonb,p_generation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.document_index_generations%rowtype;v_projection public.document_generation_projections%rowtype;v_wave public.shadow_reindex_waves%rowtype;
  v_preseal jsonb;v_terminal jsonb;v_final jsonb;v_receipt jsonb;v_payload jsonb;v_limitations jsonb;v_sealed timestamptz;v_lock uuid;
begin
  if p_generation is null or not public.shadow_keys_v1(p_fence,array['job_kind','job_id','document_id','worker_id','lease_token','expected_generation_id','authority_digest'])
    or p_fence->>'job_kind' is distinct from 'node'
    or pg_catalog.jsonb_typeof(p_fence->'job_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_fence->'document_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_fence->'worker_id') is distinct from 'string' or pg_catalog.btrim(p_fence->>'worker_id')=''
    or pg_catalog.jsonb_typeof(p_fence->'lease_token') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_fence->'authority_digest') is distinct from 'string'
    or p_fence->>'job_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_fence->>'document_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_fence->>'lease_token' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_fence->>'authority_digest' !~ '^sha256:[0-9a-f]{64}$'
    or (p_fence->'expected_generation_id'<>'null'::jsonb and
      (pg_catalog.jsonb_typeof(p_fence->'expected_generation_id') is distinct from 'string'
       or p_fence->>'expected_generation_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    then raise exception 'shadow_attempt_required'; end if;
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'shadow_read_committed_required'; end if;
  if extract(epoch from pg_catalog.current_setting('statement_timeout')::interval)*1000 not between 1 and 15000
    or extract(epoch from pg_catalog.current_setting('lock_timeout')::interval)*1000 not between 1 and 2000 then raise exception 'shadow_deadline_not_effective'; end if;
  lock table public.document_chunks,public.document_embedding_fields,public.document_generation_baselines,
    public.document_generation_inventory,public.document_generation_projections,public.document_images,
    public.document_index_generations,public.document_index_quality,public.document_index_units,public.document_labels,
    public.document_memory_cards,public.document_pages,public.document_publication_approvals,public.document_sections,
    public.document_summaries,public.document_table_facts,public.document_title_words,public.documents,
    public.import_batches,public.indexing_v3_agent_jobs,public.ingestion_job_stages,public.ingestion_jobs,
    public.public_source_activation_events,public.public_source_serving_authority,public.public_source_versions,
    public.rag_aliases,public.shadow_reindex_waves in share row exclusive mode nowait;
  select * into v_member from public.document_index_generations where document_id=(p_fence->>'document_id')::uuid and index_generation_id=p_generation for update;
  if not found then raise exception 'shadow_member_required'; end if;
  if v_member.state='staged' then
    if p_fence->>'job_kind' is distinct from 'node' or p_fence->>'job_id' is distinct from v_member.job_id::text
      or p_fence->>'document_id' is distinct from v_member.document_id::text or p_fence->>'lease_token' is distinct from v_member.first_lease_token::text
      or p_fence->'expected_generation_id' is distinct from coalesce(pg_catalog.to_jsonb(v_member.baseline_generation_id),'null'::jsonb)
      or p_fence->>'authority_digest' is distinct from v_member.authority_digest or v_member.stage_receipt is null
      or p_fence->>'worker_id' is distinct from ((public.shadow_inventory_envelope_payload_v1(
        public.shadow_inventory_envelope_payload_v1(v_member.stage_receipt)->'finalInventoryEnvelope')
        ->'preSealControlEnvelope'->>'canonicalPayload')::jsonb->'ownNodeJobs'->0->>'locked_by')
      then raise exception 'shadow_stage_replay_mismatch'; end if;
    perform public.shadow_assert_origin_unchanged_v1(v_member);
    perform public.shadow_queue_complete_v1(v_member.job_id);
    return public.shadow_member_stage_response_v1(v_member);
  end if;
  for v_lock in select id from (select p_generation id union select v_member.baseline_generation_id
    union select (g->'declaration'->>'artifactGenerationId')::uuid from pg_catalog.jsonb_array_elements(v_member.inventory_manifest->'families') f
      cross join lateral pg_catalog.jsonb_array_elements(f->'groups') g where g->'declaration'->'artifactGenerationId'<>'null'::jsonb) locks
    where id is not null order by id::text loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('u04-artifact-generation:'||v_lock::text,0))
      then raise exception 'shadow_generation_busy'; end if;
  end loop;
  v_member:=public.shadow_assert_attempt_v1(p_fence,p_generation,null);
  perform public.shadow_finalize_retained_inventory_v1(v_member);
  perform public.shadow_checkpoint_advance_v1(v_member.job_id);
  select * into strict v_member from public.document_index_generations where document_id=v_member.document_id and index_generation_id=p_generation for update;
  perform public.shadow_assert_origin_unchanged_v1(v_member);
  if v_member.control_snapshot is distinct from public.shadow_control_snapshot_v1(v_member.job_id,v_member.control_revision)
    or v_member.control_revision>=9007199254740991 then raise exception 'shadow_preseal_control_changed'; end if;
  if exists(select 1 from public.ingestion_job_stages where job_id=v_member.job_id and
      (job_kind<>'node' or document_id<>v_member.document_id or lease_token<>v_member.first_lease_token
       or index_generation_id is distinct from v_member.baseline_generation_id or stage_status<>'completed' or finished_at is null))
    or not exists(select 1 from public.ingestion_job_stages where job_id=v_member.job_id)
    then raise exception 'shadow_stages_incomplete'; end if;
  v_preseal:=v_member.control_snapshot;v_sealed:=pg_catalog.clock_timestamp();
  v_final:=public.shadow_final_inventory_v1(v_member,v_sealed,v_preseal);
  update public.ingestion_jobs set status='completed',stage='shadow_staged',progress=100,locked_by=null,locked_at=null,completed_at=v_sealed
    where id=v_member.job_id and document_id=v_member.document_id and operation='shadow_reindex' and requested_generation_id=p_generation
      and status='processing' and attempt_count=1 and max_attempts=1 and batch_id is null and lease_token=v_member.first_lease_token
      and lease_write_generation_id=p_generation and lease_expected_generation_id is not distinct from v_member.baseline_generation_id
      and lease_authority_digest=v_member.authority_digest and lease_expires_at>v_sealed;
  if not found then raise exception 'shadow_terminal_claim_lost'; end if;
  v_terminal:=public.shadow_control_snapshot_v1(v_member.job_id,v_member.control_revision+1);
  if v_terminal->'ownNodeJobs'->0->>'completed_at' is distinct from (pg_catalog.to_jsonb(v_sealed)#>>'{}')
    then raise exception 'shadow_terminal_after_image_changed'; end if;
  select * into strict v_projection from public.document_generation_projections where document_id=v_member.document_id and index_generation_id=p_generation for update;
  update public.document_generation_projections set sealed_at=v_sealed where document_id=v_member.document_id and index_generation_id=p_generation and sealed_at is null;
  if not found then raise exception 'shadow_projection_seal_conflict'; end if;
  select coalesce(pg_catalog.jsonb_agg(l.value order by public.shadow_utf16_order_v1(i.family),public.shadow_utf16_order_v1(i.unit_key),l.ord),'[]'::jsonb)
    into v_limitations from public.document_generation_inventory i cross join lateral pg_catalog.jsonb_array_elements(i.limitations) with ordinality l(value,ord)
    where i.document_id=v_member.document_id and i.index_generation_id=p_generation;
  select * into strict v_wave from public.shadow_reindex_waves where candidate_generation_id=p_generation and plan_digest=(select shadow_plan_digest from public.ingestion_jobs where id=v_member.job_id);
  v_payload:=pg_catalog.jsonb_build_object('kind','u04-member-seal-receipt-v1','version',1,
    'binding',public.shadow_projection_binding_v1(v_member,null),'planDigest',v_wave.plan_digest,
    'preparedOriginDigest',v_wave.prepared_origin_digest,'executionProfileDigest',v_wave.execution_profile_digest,
    'caseSetDigest',v_wave.case_set_digest,'expectedStateDigest',v_member.expected_state_digest,
    'baselineBundleDigest',v_member.baseline_bundle_digest,'expectedInventoryDigest',v_member.expected_inventory_digest,
    'finalInventoryEnvelope',v_final,'candidateProjectionDigest',(public.shadow_inventory_envelope_payload_v1(v_final)->'projectionEnvelope'->>'digest'),
    'terminalControlEnvelope',public.shadow_pg_bundle_v1(v_terminal,'control'),'sealedAt',v_sealed,'limitations',v_limitations);
  v_receipt:=public.shadow_pg_bundle_v1(v_payload,'member_receipt');
  update public.document_index_generations set state='staged',inventory_digest=v_final->>'digest',
    candidate_projection_digest=v_payload->>'candidateProjectionDigest',stage_receipt=v_receipt,stage_receipt_digest=v_receipt->>'digest',
    staged_at=v_sealed,control_revision=control_revision+1,control_snapshot=v_terminal
    where document_id=v_member.document_id and index_generation_id=p_generation and state='building' and control_revision=v_member.control_revision;
  if not found then raise exception 'shadow_member_seal_conflict'; end if;
  perform public.shadow_queue_complete_v1(v_member.job_id);
  select * into strict v_member from public.document_index_generations where document_id=v_member.document_id and index_generation_id=p_generation;
  return public.shadow_member_stage_response_v1(v_member);
exception when others then
  if sqlerrm like 'shadow_%' or sqlerrm like 'invalid_shadow_%' then raise; end if;
  raise exception 'invalid_shadow_generation_stage' using errcode='22023';
end $$;
alter function public.stage_document_index_generation(jsonb,uuid) owner to postgres;
revoke all on function public.stage_document_index_generation(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.stage_document_index_generation(jsonb,uuid) to service_role;

create or replace function public.get_shadow_generation_receipt(p_plan_digest text,p_generation uuid,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_wave public.shadow_reindex_waves%rowtype;v_member public.document_index_generations%rowtype;v_origin jsonb;v_profile jsonb;
  v_w uuid[];v_m uuid[];v_b uuid[];v_job uuid;v_current jsonb;v_members jsonb;v_documents jsonb;v_baselines jsonb;v_receipt jsonb;v_result jsonb;v_max timestamptz;
begin
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'shadow_read_committed_required'; end if;
  if extract(epoch from pg_catalog.current_setting('statement_timeout')::interval)*1000 not between 1 and 15000
    or extract(epoch from pg_catalog.current_setting('lock_timeout')::interval)*1000 not between 1 and 2000 then raise exception 'shadow_deadline_not_effective'; end if;
  lock table public.document_chunks,public.document_embedding_fields,public.document_generation_baselines,
    public.document_generation_inventory,public.document_generation_projections,public.document_images,
    public.document_index_generations,public.document_index_quality,public.document_index_units,public.document_labels,
    public.document_memory_cards,public.document_pages,public.document_publication_approvals,public.document_sections,
    public.document_summaries,public.document_table_facts,public.document_title_words,public.documents,
    public.import_batches,public.indexing_v3_agent_jobs,public.ingestion_job_stages,public.ingestion_jobs,
    public.public_source_activation_events,public.public_source_serving_authority,public.public_source_versions,
    public.rag_aliases,public.shadow_reindex_waves in share row exclusive mode nowait;
  select * into v_wave from public.shadow_reindex_waves where candidate_generation_id=p_generation and plan_digest=p_plan_digest for update;
  if not found or not exists(select 1 from public.document_index_generations where document_id=p_document_id and index_generation_id=p_generation)
    then raise exception 'shadow_receipt_membership_required'; end if;
  select * into strict v_member from public.document_index_generations where document_id=p_document_id and index_generation_id=p_generation;
  v_origin:=(v_member.original_origin_envelope->>'canonicalPayload')::jsonb;v_profile:=public.shadow_profile_capture_v1(v_origin->'executionProfileEnvelope');
  select pg_catalog.array_agg(value::uuid order by ord) into v_w from pg_catalog.jsonb_array_elements_text(v_profile->'documentIds') with ordinality a(value,ord);
  select coalesce(pg_catalog.array_agg(value::uuid order by ord),array[]::uuid[]) into v_m from pg_catalog.jsonb_array_elements_text(v_profile->'manualAliasIds') with ordinality a(value,ord);
  if (select pg_catalog.jsonb_agg(document_id order by document_id) from public.document_index_generations where index_generation_id=p_generation)
      is distinct from pg_catalog.to_jsonb(v_w)
    or exists(select 1 from public.document_index_generations where index_generation_id=p_generation and
      (state<>'staged' or stage_receipt is null or stage_receipt_digest is null or staged_at is null))
    then raise exception 'shadow_wave_unsealed'; end if;
  for v_job in select job_id from public.document_index_generations where index_generation_id=p_generation order by document_id loop
    perform public.shadow_queue_complete_v1(v_job);
  end loop;
  perform public.shadow_assert_origin_unchanged_v1(v_member);
  v_current:=public.capture_shadow_reindex_origin(v_w,v_origin->>'sourcePolicyVersion',v_m,v_origin->'executionProfileEnvelope');
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('documentId',document_id,'memberReceiptEnvelope',stage_receipt) order by document_id),
    pg_catalog.jsonb_agg(document_id order by document_id),max(staged_at)
    into v_members,v_documents,v_max from public.document_index_generations where index_generation_id=p_generation;
  v_receipt:=public.shadow_pg_bundle_v1(pg_catalog.jsonb_build_object('kind','u04-wave-seal-receipt-v1','version',1,
    'candidateGenerationId',p_generation,'planDigest',v_wave.plan_digest,'preparedOriginDigest',v_wave.prepared_origin_digest,
    'executionProfileDigest',v_wave.execution_profile_digest,'caseSetDigest',v_wave.case_set_digest,
    'baselineReportDigest',v_wave.baseline_report_digest,'recoveryEvidenceDigest',v_wave.recovery_evidence_digest,
    'operationManifestDigest',v_wave.operation_manifest_digest,'documentIds',v_documents,'members',v_members,'sealedAt',v_max),'wave_receipt');
  select coalesce(pg_catalog.array_agg(document_id order by document_id),array[]::uuid[]),
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('documentId',document_id,
    'rowEnvelope',public.shadow_capture_envelope_v1(pg_catalog.to_jsonb(b))) order by document_id),'[]'::jsonb) into v_b,v_baselines
    from public.document_generation_baselines b where candidate_generation_id=p_generation;
  if v_b is distinct from v_w or pg_catalog.jsonb_array_length(v_baselines)<>pg_catalog.cardinality(v_w)
    then raise exception 'shadow_baseline_readback_incomplete'; end if;
  v_result:=pg_catalog.jsonb_build_object('version',1,'waveReceiptEnvelope',v_receipt,'baselineRows',v_baselines,'observedOriginEnvelope',v_current);
  if pg_catalog.octet_length(pg_catalog.convert_to(v_result::text,'UTF8'))>(v_profile->'limits'->>'maxOriginBundleBytes')::bigint
    then raise exception 'shadow_wave_readback_too_large'; end if;
  return v_result;
exception when others then
  if sqlerrm like 'shadow_%' or sqlerrm like 'invalid_shadow_%' then raise; end if;
  raise exception 'invalid_shadow_generation_receipt' using errcode='22023';
end $$;
alter function public.get_shadow_generation_receipt(text,uuid,uuid) owner to postgres;
revoke all on function public.get_shadow_generation_receipt(text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_shadow_generation_receipt(text,uuid,uuid) to service_role;

-- Preserve a failed producer's complete native inputs and partial outputs without a success declaration.
create or replace function public.record_shadow_producer_failure(p_fence jsonb,p_generation uuid,p_failure jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.document_index_generations%rowtype; v_payload jsonb; v_profile jsonb; v_stage uuid;
  v_revision bigint; v_at timestamptz; v_result jsonb; v_capture jsonb; v_artifact uuid; v_deadline bigint;
begin
  if not public.shadow_keys_v1(p_fence,array['job_kind','job_id','document_id','worker_id','lease_token','expected_generation_id','authority_digest'])
    or p_fence->>'job_kind' is distinct from 'node' or p_generation is null
    then raise exception 'shadow_attempt_required'; end if;
  v_payload:=public.shadow_node_payload_v1(p_failure,'u04-retained-evidence-v1');
  if not public.shadow_keys_v1(v_payload,array['kind','version','binding','expectedControlRevision','artifactGenerationId','phase','code','inputEnvelope','partialEnvelope'])
    or v_payload->>'kind' is distinct from 'u04-producer-failure-v1' or v_payload->'version' is distinct from '1'::jsonb
    or (v_payload->>'phase' in ('cache_lookup','image_bytes','image_classification','section_context','table_facts','visual_index_units',
      'supplemental_embedding_fields','enrichment_policy','summary_generation','document_embedding_fields','chunk_embeddings',
      'deep_sections','deep_model_profile','deep_cards',
      'deep_card_embeddings','deep_index_units','deep_index_embeddings','deep_persistence')) is not true
    or (v_payload->>'code' in ('producer_failed','producer_skipped')) is not true
    or (v_payload->>'code'='producer_skipped') is distinct from (v_payload->>'phase'='enrichment_policy')
    or pg_catalog.jsonb_typeof(v_payload->'expectedControlRevision') is distinct from 'number'
    or (v_payload->>'expectedControlRevision')::numeric<>pg_catalog.trunc((v_payload->>'expectedControlRevision')::numeric)
    or (v_payload->>'expectedControlRevision')::numeric not between 1 and 9007199254740990
    then raise exception 'invalid_shadow_producer_failure'; end if;
  v_revision:=(v_payload->>'expectedControlRevision')::bigint;
  select * into strict v_member from public.document_index_generations
    where document_id=(p_fence->>'document_id')::uuid and index_generation_id=p_generation;
  v_profile:=public.shadow_profile_capture_v1((v_member.original_origin_envelope->>'canonicalPayload')::jsonb->'executionProfileEnvelope');
  perform pg_catalog.set_config('lock_timeout',(v_profile->'limits'->>'lockTimeoutMs')||'ms',true);
  v_deadline:=extract(epoch from pg_catalog.current_setting('statement_timeout')::interval)*1000;
  if v_deadline<=0 or v_deadline>(v_profile->'limits'->>'serverRequestDeadlineMs')::bigint then raise exception 'shadow_deadline_not_effective'; end if;
  if pg_catalog.octet_length(pg_catalog.convert_to(p_failure::text,'UTF8'))>least(16777216,(v_profile->'limits'->>'maxAppendBytes')::bigint)
    then raise exception 'shadow_append_too_large'; end if;
  v_member:=public.shadow_assert_attempt_v1(p_fence,p_generation,v_revision);
  if v_payload->'binding' is distinct from public.shadow_projection_binding_v1(v_member,null)
    then raise exception 'shadow_failure_binding_mismatch'; end if;
  if v_payload->'artifactGenerationId' is distinct from 'null'::jsonb then
    if pg_catalog.jsonb_typeof(v_payload->'artifactGenerationId') is distinct from 'string'
      or v_payload->>'artifactGenerationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then raise exception 'shadow_failure_artifact_invalid'; end if;
    v_artifact:=(v_payload->>'artifactGenerationId')::uuid;
    if v_artifact=p_generation or v_artifact is not distinct from v_member.baseline_generation_id
      or exists(select 1 from pg_catalog.jsonb_array_elements(v_member.inventory_manifest->'families') f
        cross join lateral pg_catalog.jsonb_array_elements(f->'groups') g where g->>'groupKey'='deep_memory' and g->>'state'='declared'
          and g->'declaration'->'artifactGenerationId' is distinct from v_payload->'artifactGenerationId')
      then raise exception 'shadow_failure_artifact_invalid'; end if;
  end if;
  if (pg_catalog.left(v_payload->>'phase',5)='deep_') is distinct from (v_artifact is not null)
    then raise exception 'shadow_failure_artifact_invalid'; end if;
  perform public.shadow_producer_capture_v1(v_payload->'inputEnvelope');
  perform public.shadow_producer_capture_v1(v_payload->'partialEnvelope');
  v_at:=pg_catalog.clock_timestamp();
  insert into public.ingestion_job_stages(job_id,document_id,job_kind,lease_token,index_generation_id,stage_name,
    stage_status,started_at,finished_at,metadata,artifact_counts,error_message)
  values(v_member.job_id,v_member.document_id,'node',v_member.first_lease_token,v_member.baseline_generation_id,
    'shadow_producer_failure:'||(v_payload->>'phase'),'failed',v_at,v_at,
    pg_catalog.jsonb_build_object('u04_producer_failure_v1',p_failure),'{}'::jsonb,v_payload->>'code') returning id into v_stage;
  update public.ingestion_jobs set status='failed',stage='shadow_failed',error_message=v_payload->>'code',
    locked_by=null,locked_at=null,completed_at=v_at,next_run_at=null
    where id=v_member.job_id and status='processing' and lease_token=v_member.first_lease_token and lease_expires_at>pg_catalog.clock_timestamp();
  if not found then raise exception 'shadow_lease_lost'; end if;
  perform public.shadow_checkpoint_advance_v1(v_member.job_id);
  select * into strict v_member from public.document_index_generations where job_id=v_member.job_id;
  perform public.shadow_queue_complete_v1(v_member.job_id);
  -- Also enforce the complete captured wave budget; any refusal rolls both effects back.
  perform public.shadow_assert_origin_unchanged_v1(v_member);
  return pg_catalog.jsonb_build_object('ok',true,'kind','shadow_failed','stage_id',v_stage,
    'failure_digest',p_failure->>'digest','control_revision',v_member.control_revision);
exception when others then
  if sqlerrm like 'shadow_%' or sqlerrm like 'invalid_shadow_%' then raise; end if;
  raise exception 'invalid_shadow_producer_failure' using errcode='22023';
end $$;
alter function public.record_shadow_producer_failure(jsonb,uuid,jsonb) owner to postgres;
revoke all on function public.record_shadow_producer_failure(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_shadow_producer_failure(jsonb,uuid,jsonb) to service_role;


-- U04 evaluation side projections, candidate 1.
-- Outside-only candidate. Root owns shadow_eval_guard_v1 and
-- shadow_eval_result_v1. These helpers consume a guard already validated in
-- the same statement; none is granted to an API role.

create or replace function public.shadow_eval_documents_v1(p_guard jsonb)
returns setof public.documents
language plpgsql stable security definer set search_path = '' as $$
declare
  v_side text:=p_guard->>'side';
  v_operation text:=p_guard->>'operation';
  v_ids uuid[];
  v_expected integer;
  v_matched integer;
  v_unique integer;
begin
  if pg_catalog.jsonb_typeof(p_guard) is distinct from 'object'
    or (v_side in ('baseline','candidate')) is not true
    or pg_catalog.jsonb_typeof(p_guard->'documentIds') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_guard->'sourceBindings') is distinct from 'array'
    or (v_operation in (
      'corpus_terms','correct_terms','lookup_chunk_terms','lookup_chunk_prefix','lookup_document_terms',
      'memory_cards_lexical','chunks_by_ids','chunks_by_indexes','documents','images_by_ids','images_by_pages',
      'visual_rows','adjacent_chunks','text_chunks','hybrid_chunks','vector_chunks','lookup_chunks',
      'lookup_documents','ranking_metadata','related_documents','table_facts','embedding_fields','index_units','memory_cards_hybrid'
    )) is not true
    then raise exception 'invalid_shadow_eval_documents_guard' using errcode='22023';
  end if;
  v_ids:=array(select value::uuid from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds'));
  v_expected:=coalesce(pg_catalog.cardinality(v_ids),0);

  select pg_catalog.count(*),pg_catalog.count(distinct d.id)
    into v_matched,v_unique
  from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
  join public.documents d on d.id=(s.value->>'documentId')::uuid
  where d.id=any(v_ids)
    and d.owner_id is not distinct from (s.value->>'ownerId')::uuid
    and d.content_hash is not distinct from s.value->>'contentHash'
    and d.index_generation_id is not distinct from (s.value->>'baselineGenerationId')::uuid;
  if v_matched<>v_expected or v_unique<>v_expected then
    raise exception 'shadow_eval_document_source_population' using errcode='22023';
  end if;

  if v_side='baseline' then
    if p_guard->'candidateGenerationId' is distinct from 'null'::jsonb then
      raise exception 'shadow_eval_baseline_generation' using errcode='22023';
    end if;
    return query
      select d.*
      from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
      join public.documents d on d.id=(s.value->>'documentId')::uuid
      where d.id=any(v_ids)
        and d.owner_id is not distinct from (s.value->>'ownerId')::uuid
        and d.content_hash is not distinct from s.value->>'contentHash'
        and d.index_generation_id is not distinct from (s.value->>'baselineGenerationId')::uuid;
    return;
  end if;

  if pg_catalog.jsonb_typeof(p_guard->'candidateGenerationId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_guard->'comparisonClock') is distinct from 'string' then
    raise exception 'shadow_eval_candidate_generation' using errcode='22023';
  end if;
  select pg_catalog.count(*),pg_catalog.count(distinct m.document_id)
    into v_matched,v_unique
  from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
  join public.document_index_generations m
    on m.document_id=(s.value->>'documentId')::uuid
   and m.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
  join public.document_generation_projections p
    on p.document_id=m.document_id and p.index_generation_id=m.index_generation_id
  where m.document_id=any(v_ids)
    and m.owner_id is not distinct from (s.value->>'ownerId')::uuid
    and m.source_binding=s.value
    and m.state='staged'
    and m.stage_receipt is not null
    and p.owner_id is not distinct from m.owner_id
    and p.lease_token=m.first_lease_token
    and p.worker_state_digest is not null
    and p.worker_metadata is not null
    and p.document_counts is not null
    and p.sealed_at is not null
    and pg_catalog.jsonb_typeof(p.worker_metadata->'indexed_at')='string';
  if v_matched<>v_expected or v_unique<>v_expected then
    raise exception 'shadow_eval_candidate_document_population' using errcode='22023';
  end if;

  return query
    select (pg_catalog.jsonb_populate_record(
      d,
      pg_catalog.jsonb_build_object(
        'metadata',d.metadata||p.worker_metadata,
        'status',p.document_counts->'status',
        'page_count',p.document_counts->'page_count',
        'chunk_count',p.document_counts->'chunk_count',
        'image_count',p.document_counts->'image_count',
        'error_message',p.document_counts->'error_message',
        'index_generation_id',p.index_generation_id,
        -- Retained producer time, rather than a predicted database write time,
        -- is the candidate logical-view recency operand.
        'updated_at',p.worker_metadata->'indexed_at'
      )
    )).*
    from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
    join public.documents d on d.id=(s.value->>'documentId')::uuid
    join public.document_index_generations m
      on m.document_id=d.id and m.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
    join public.document_generation_projections p
      on p.document_id=m.document_id and p.index_generation_id=m.index_generation_id
    where d.id=any(v_ids)
      and d.owner_id is not distinct from (s.value->>'ownerId')::uuid
      and d.content_hash is not distinct from s.value->>'contentHash'
      and d.index_generation_id is not distinct from (s.value->>'baselineGenerationId')::uuid
      and m.owner_id is not distinct from d.owner_id
      and m.source_binding=s.value
      and m.state='staged' and m.stage_receipt is not null
      and p.lease_token=m.first_lease_token and p.worker_state_digest is not null and p.sealed_at is not null;
end $$;
alter function public.shadow_eval_documents_v1(jsonb) owner to postgres;
revoke all on function public.shadow_eval_documents_v1(jsonb) from public,anon,authenticated,service_role;


create or replace function public.shadow_eval_aliases_v1(p_guard jsonb)
returns setof public.rag_aliases
language plpgsql stable security definer set search_path = '' as $$
declare
  v_side text:=p_guard->>'side';
  v_operation text:=p_guard->>'operation';
  v_ids uuid[];
  v_manual_ids uuid[];
  v_expected integer;
  v_matched integer;
begin
  if (v_side in ('baseline','candidate')) is not true
    or (v_operation in ('aliases','correct_terms')) is not true
    or pg_catalog.jsonb_typeof(p_guard->'documentIds') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_guard->'sourceBindings') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_guard->'sourceBindings')=0
    or pg_catalog.jsonb_typeof(p_guard->'sourceBindings'->0->'manualAliasIds') is distinct from 'array'
    then raise exception 'invalid_shadow_eval_alias_guard' using errcode='22023';
  end if;
  v_ids:=array(select value::uuid from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds'));
  v_manual_ids:=array(select value::uuid from pg_catalog.jsonb_array_elements_text(p_guard->'sourceBindings'->0->'manualAliasIds'));

  if v_side='baseline' then
    if p_guard->'candidateGenerationId' is distinct from 'null'::jsonb then
      raise exception 'shadow_eval_baseline_alias_generation' using errcode='22023';
    end if;
    return query
      select a.*
      from public.rag_aliases a
      where (a.id=any(v_manual_ids) and exists(
        select 1 from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
        where (s.value->>'documentId')::uuid=any(v_ids)
          and exists(select 1 from pg_catalog.jsonb_array_elements_text(s.value->'manualAliasIds') x where x=a.id::text)
      ))
         or a.metadata->>'document_id'=any(array(select x.id::text from pg_catalog.unnest(v_ids) x(id)));
    return;
  end if;

  v_expected:=coalesce(pg_catalog.cardinality(v_ids),0);
  select pg_catalog.count(distinct p.document_id) into v_matched
  from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
  join public.document_index_generations m
    on m.document_id=(s.value->>'documentId')::uuid
   and m.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
  join public.document_generation_projections p
    on p.document_id=m.document_id and p.index_generation_id=m.index_generation_id
  where m.document_id=any(v_ids)
    and m.source_binding=s.value and m.state='staged' and m.stage_receipt is not null
    and p.lease_token=m.first_lease_token and p.sealed_at is not null
    and p.deep_memory_digest is not null
    and pg_catalog.jsonb_typeof(p.producer_aliases)='array';
  if v_matched<>v_expected then
    raise exception 'shadow_eval_candidate_alias_population' using errcode='22023';
  end if;

  return query
    select a.*
    from public.rag_aliases a
    where ((a.id=any(v_manual_ids) and exists(
        select 1 from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
        where (s.value->>'documentId')::uuid=any(v_ids)
          and exists(select 1 from pg_catalog.jsonb_array_elements_text(s.value->'manualAliasIds') x where x=a.id::text)
      ))
       or a.metadata->>'document_id'=any(array(select x.id::text from pg_catalog.unnest(v_ids) x(id))))
      and not exists(
        select 1 from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
        where a.metadata->>'generated_by'='local-worker'
          and s.value->>'documentId'=a.metadata->>'document_id'
          and (s.value->>'documentId')::uuid=any(v_ids)
          and a.metadata->>'index_generation_id' is not distinct from s.value->>'baselineGenerationId'
      )
    union all
    select (pg_catalog.jsonb_populate_record(null::public.rag_aliases,alias_item.value)).*
    from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
    join public.document_generation_projections p
      on p.document_id=(s.value->>'documentId')::uuid
     and p.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
    cross join lateral pg_catalog.jsonb_array_elements(p.producer_aliases) alias_item(value)
    where p.document_id=any(v_ids) and p.deep_memory_digest is not null and p.sealed_at is not null;
end $$;
alter function public.shadow_eval_aliases_v1(jsonb) owner to postgres;
revoke all on function public.shadow_eval_aliases_v1(jsonb) from public,anon,authenticated,service_role;


create or replace function public.shadow_eval_generation_matches_v1(
  p_guard jsonb,p_document uuid,p_generation uuid,p_family text
)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_side text:=p_guard->>'side';
  v_operation text:=p_guard->>'operation';
  v_source jsonb;
  v_member public.document_index_generations%rowtype;
  v_projection public.document_generation_projections%rowtype;
begin
  if p_document is null
    or p_family not in ('chunks','images','table_facts','embedding_fields','index_units','sections','memory_cards')
    or ((
      (p_family='chunks' and v_operation in ('corpus_terms','lookup_chunk_terms','lookup_chunk_prefix','chunks_by_ids',
        'chunks_by_indexes','adjacent_chunks','text_chunks','hybrid_chunks','vector_chunks','lookup_chunks'))
      or (p_family='images' and v_operation in ('images_by_ids','images_by_pages','visual_rows','text_chunks','hybrid_chunks'))
      or (p_family='table_facts' and v_operation='table_facts')
      or (p_family='embedding_fields' and v_operation='embedding_fields')
      or (p_family='index_units' and v_operation='index_units')
      or (p_family in ('sections','memory_cards') and v_operation in ('memory_cards_lexical','memory_cards_hybrid'))
    )) is not true then raise exception 'invalid_shadow_eval_generation_family' using errcode='22023';
  end if;
  select value into strict v_source
  from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings')
  where value->>'documentId'=p_document::text;
  if not exists(
    select 1 from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds') id
    where id=p_document::text
  ) then raise exception 'shadow_eval_generation_document_scope' using errcode='22023';
  end if;

  if v_side='baseline' then
    if p_guard->'candidateGenerationId' is distinct from 'null'::jsonb then
      raise exception 'shadow_eval_baseline_generation_binding' using errcode='22023';
    end if;
    return p_generation is not distinct from (v_source->>'baselineGenerationId')::uuid;
  end if;
  if v_side<>'candidate' or pg_catalog.jsonb_typeof(p_guard->'candidateGenerationId') is distinct from 'string' then
    raise exception 'shadow_eval_generation_side' using errcode='22023';
  end if;
  select * into strict v_member
  from public.document_index_generations
  where document_id=p_document and index_generation_id=(p_guard->>'candidateGenerationId')::uuid
    and source_binding=v_source and state='staged' and stage_receipt is not null;
  select * into strict v_projection
  from public.document_generation_projections
  where document_id=v_member.document_id and index_generation_id=v_member.index_generation_id
    and owner_id is not distinct from v_member.owner_id
    and lease_token=v_member.first_lease_token and sealed_at is not null;

  if p_family in ('chunks','images','table_facts','embedding_fields') and v_projection.worker_state_digest is null then
    raise exception 'shadow_eval_core_generation_unavailable' using errcode='22023';
  end if;
  if p_family in ('sections','memory_cards') and
    (v_projection.deep_memory_digest is null or v_projection.deep_memory_artifact_generation_id is null) then
    raise exception 'shadow_eval_deep_generation_unavailable' using errcode='22023';
  end if;
  if p_family='index_units' and
    (v_projection.worker_state_digest is null or v_projection.deep_memory_digest is null
      or v_projection.deep_memory_artifact_generation_id is null) then
    raise exception 'shadow_eval_index_unit_generations_unavailable' using errcode='22023';
  end if;

  -- Finalized deep rows carry C in index_generation_id. Their exact subordinate
  -- D remains bound by the sealed final inventory and projection receipt.
  return p_generation is not distinct from v_member.index_generation_id;
end $$;
alter function public.shadow_eval_generation_matches_v1(jsonb,uuid,uuid,text) owner to postgres;
revoke all on function public.shadow_eval_generation_matches_v1(jsonb,uuid,uuid,text) from public,anon,authenticated,service_role;


create or replace function public.shadow_eval_related_metadata_v1(
  p_guard jsonb,p_document_ids uuid[],p_mode text
)
returns table(document_id uuid,labels jsonb,summary text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_side text:=p_guard->>'side';
  v_operation text:=p_guard->>'operation';
  v_expected integer;
  v_matched integer;
begin
  if p_document_ids is null
    or coalesce(pg_catalog.array_ndims(p_document_ids),1)<>1
    or pg_catalog.array_position(p_document_ids,null) is not null
    or (p_mode in ('text_chunks','related_documents')) is not true
    or (p_mode='text_chunks' and (v_operation='text_chunks') is not true)
    or (p_mode='related_documents' and (v_operation in ('ranking_metadata','related_documents')) is not true)
    or exists(
      select 1 from pg_catalog.unnest(p_document_ids) id
      where not exists(
        select 1 from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds') g
        where g=id::text
      )
    )
    then raise exception 'invalid_shadow_eval_related_scope' using errcode='22023';
  end if;
  v_expected:=(select pg_catalog.count(distinct id) from pg_catalog.unnest(p_document_ids) id);

  if v_side='candidate' then
    select pg_catalog.count(distinct p.document_id) into v_matched
    from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
    join public.document_index_generations m
      on m.document_id=(s.value->>'documentId')::uuid
     and m.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
    join public.document_generation_projections p
      on p.document_id=m.document_id and p.index_generation_id=m.index_generation_id
    where m.document_id=any(p_document_ids)
      and m.source_binding=s.value and m.state='staged' and m.stage_receipt is not null
      and p.lease_token=m.first_lease_token and p.sealed_at is not null
      and p.summary_digest is not null and p.summary is not null
      and pg_catalog.jsonb_typeof(p.generated_labels)='array';
    if v_matched<>v_expected then
      raise exception 'shadow_eval_candidate_metadata_population' using errcode='22023';
    end if;
  elsif v_side<>'baseline' or p_guard->'candidateGenerationId' is distinct from 'null'::jsonb then
    raise exception 'shadow_eval_metadata_side' using errcode='22023';
  end if;

  return query
    with docs as materialized (
      select d.*,s.value source_binding
      from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
      join public.shadow_eval_documents_v1(p_guard) d on d.id=(s.value->>'documentId')::uuid
      where d.id=any(p_document_ids)
    ),
    candidate_projection as materialized (
      select p.*
      from public.document_generation_projections p
      where v_side='candidate'
        and p.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
        and p.document_id=any(p_document_ids)
        and p.summary_digest is not null and p.sealed_at is not null
    )
    select d.id,
      coalesce((
        select pg_catalog.jsonb_agg(items.value
          order by (items.value->>'confidence')::real desc,items.value->>'label')
        from (
          select pg_catalog.to_jsonb(l) value
          from public.document_labels l
          where l.document_id=d.id
            and (v_side='candidate' and l.source<>'generated'
              or v_side='baseline' and (l.source<>'generated'
                or l.metadata->>'index_generation_id' is not distinct from d.source_binding->>'baselineGenerationId'))
            and (p_mode='text_chunks' or (d.owner_id is not null and l.owner_id=d.owner_id))
            and (p_mode<>'text_chunks' or (
              coalesce(l.metadata->>'review_status','new')<>'hidden'
              and coalesce(l.metadata->>'hidden','false')<>'true'
            ))
          union all
          select item.value
          from candidate_projection p
          cross join lateral pg_catalog.jsonb_array_elements(p.generated_labels) item(value)
          where v_side='candidate' and p.document_id=d.id
            and (p_mode='text_chunks' or d.owner_id is not null)
            and (p_mode<>'text_chunks' or (
              coalesce(item.value->'metadata'->>'review_status','new')<>'hidden'
              and coalesce(item.value->'metadata'->>'hidden','false')<>'true'
            ))
        ) items
      ),'[]'::jsonb) labels,
      case
        when v_side='candidate' and (p_mode='text_chunks' or d.owner_id is not null)
          then (select p.summary->>'summary' from candidate_projection p where p.document_id=d.id)
        when v_side='baseline' and p_mode='text_chunks'
          then (select s.summary from public.document_summaries s where s.document_id=d.id
            and s.metadata->>'index_generation_id' is not distinct from d.source_binding->>'baselineGenerationId' limit 1)
        when v_side='baseline' and p_mode='related_documents' and d.owner_id is not null
          then (select s.summary from public.document_summaries s
            where s.document_id=d.id and s.owner_id=d.owner_id
              and s.metadata->>'index_generation_id' is not distinct from d.source_binding->>'baselineGenerationId'
            order by s.generated_at desc limit 1)
        else null
      end summary
    from docs d;
end $$;
alter function public.shadow_eval_related_metadata_v1(jsonb,uuid[],text) owner to postgres;
revoke all on function public.shadow_eval_related_metadata_v1(jsonb,uuid[],text) from public,anon,authenticated,service_role;


create or replace function public.shadow_eval_image_metadata_v1(p_guard jsonb,p_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_operation text:=p_guard->>'operation';
  v_result jsonb;
begin
  if p_ids is null
    or coalesce(pg_catalog.array_ndims(p_ids),1)<>1
    or pg_catalog.array_position(p_ids,null) is not null
    or (v_operation in ('text_chunks','hybrid_chunks')) is not true
    then raise exception 'invalid_shadow_eval_image_metadata_scope' using errcode='22023';
  end if;
  if exists(
    select 1 from public.document_images i where i.id=any(p_ids)
      and not exists(
        select 1 from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds') id
        where id=i.document_id::text
      )
  ) then raise exception 'shadow_eval_image_outside_scope' using errcode='22023';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id',i.id,
        'page_number',i.page_number,
        'storage_path',i.storage_path,
        'caption',i.caption,
        'bbox',i.bbox,
        'image_type',i.image_type,
        'searchable',i.searchable,
        'clinical_relevance_score',i.clinical_relevance_score,
        'source_kind',i.source_kind,
        'sourceKind',i.source_kind,
        'tableLabel',nullif(i.metadata->>'table_label',''),
        'tableTitle',nullif(i.metadata->>'table_title',''),
        'tableRole',nullif(i.metadata->>'table_role',''),
        'tableTextSnippet',nullif(pg_catalog.left(coalesce(
          i.metadata->>'table_text_snippet',i.metadata->>'table_text',''),500),''),
        'width',i.width,
        'height',i.height,
        'labels',i.labels,
        'metadata',i.metadata
      ) order by i.page_number nulls last,i.created_at
    ),'[]'::jsonb)
    into v_result
  from public.document_images i
  where i.id=any(p_ids)
    and exists(
      select 1 from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds') id
      where id=i.document_id::text
    )
    and public.shadow_eval_generation_matches_v1(
      p_guard,i.document_id,i.index_generation_id,'images'
    )
    and i.searchable=true and i.image_type<>'logo_decorative';
  return v_result;
end $$;
alter function public.shadow_eval_image_metadata_v1(jsonb,uuid[]) owner to postgres;
revoke all on function public.shadow_eval_image_metadata_v1(jsonb,uuid[]) from public,anon,authenticated,service_role;


create or replace function public.shadow_eval_quality_v1(p_guard jsonb,p_document_ids uuid[])
returns setof public.document_index_quality
language plpgsql stable security definer set search_path = '' as $$
declare
  v_side text:=p_guard->>'side';
  v_operation text:=p_guard->>'operation';
  v_expected integer;
  v_matched integer;
begin
  if p_document_ids is null
    or coalesce(pg_catalog.array_ndims(p_document_ids),1)<>1
    or pg_catalog.array_position(p_document_ids,null) is not null
    or (v_operation in ('quality','hybrid_chunks')) is not true
    or exists(
      select 1 from pg_catalog.unnest(p_document_ids) id
      where not exists(
        select 1 from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds') g
        where g=id::text
      )
    )
    then raise exception 'invalid_shadow_eval_quality_scope' using errcode='22023';
  end if;

  if v_side='baseline' then
    if p_guard->'candidateGenerationId' is distinct from 'null'::jsonb then
      raise exception 'shadow_eval_baseline_quality_generation' using errcode='22023';
    end if;
    return query
      select q.*
      from public.document_index_quality q
      join pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
        on (s.value->>'documentId')::uuid=q.document_id
       and q.owner_id is not distinct from (s.value->>'ownerId')::uuid
      where q.document_id=any(p_document_ids);
    return;
  end if;
  if v_side<>'candidate'
    or pg_catalog.jsonb_typeof(p_guard->'candidateGenerationId') is distinct from 'string' then
    raise exception 'shadow_eval_quality_side' using errcode='22023';
  end if;

  v_expected:=(select pg_catalog.count(distinct id) from pg_catalog.unnest(p_document_ids) id);
  select pg_catalog.count(distinct p.document_id) into v_matched
  from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
  join public.document_index_generations m
    on m.document_id=(s.value->>'documentId')::uuid
   and m.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
  join public.document_generation_projections p
    on p.document_id=m.document_id and p.index_generation_id=m.index_generation_id
  where m.document_id=any(p_document_ids)
    and m.source_binding=s.value and m.state='staged' and m.stage_receipt is not null
    and p.owner_id is not distinct from (s.value->>'ownerId')::uuid
    and p.lease_token=m.first_lease_token and p.sealed_at is not null
    and p.quality_digest is not null and p.quality is not null;
  if v_matched<>v_expected then
    raise exception 'shadow_eval_candidate_quality_population' using errcode='22023';
  end if;

  return query
    select (pg_catalog.jsonb_populate_record(
      null::public.document_index_quality,p.quality
    )).*
    from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
    join public.document_generation_projections p
      on p.document_id=(s.value->>'documentId')::uuid
     and p.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
    where p.document_id=any(p_document_ids)
      and p.owner_id is not distinct from (s.value->>'ownerId')::uuid
      and p.quality_digest is not null and p.sealed_at is not null;
end $$;
alter function public.shadow_eval_quality_v1(jsonb,uuid[]) owner to postgres;
revoke all on function public.shadow_eval_quality_v1(jsonb,uuid[]) from public,anon,authenticated,service_role;


-- U04 fixed evaluation SQL bodies candidate 1.
-- Outside-only source component. Root owns the closed guard/result and side helpers.
-- Every endpoint performs the guard as the first PL/pgSQL statement and exposes no
-- dynamic relation, routine, predicate, projection, order, or limit input.

create or replace function public.u04_eval_aliases_v1(p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb; v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'aliases','{}'::jsonb);
  select pg_catalog.jsonb_build_object(
    'ownerRows',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q))
      from (select a.alias,a.canonical,a.alias_type,a.weight,a.owner_id
        from public.shadow_eval_aliases_v1(v_guard) a where a.enabled and a.owner_id is not null
        order by a.weight desc limit 200) q),'[]'::jsonb),
    'publicRows',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q))
      from (select a.alias,a.canonical,a.alias_type,a.weight,a.owner_id
        from public.shadow_eval_aliases_v1(v_guard) a where a.enabled and a.owner_id is null
        order by a.weight desc limit 200) q),'[]'::jsonb)) into v_result;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_aliases_v1(jsonb) owner to postgres;
revoke all on function public.u04_eval_aliases_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_aliases_v1(jsonb) to service_role;

create or replace function public.u04_eval_corpus_terms_v1(p_context jsonb,terms text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb; v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'corpus_terms',pg_catalog.jsonb_build_object('terms',terms));
  with input_terms as (
    select distinct pg_catalog.lower(pg_catalog.btrim(t.term)) as term
    from pg_catalog.unnest(coalesce(terms,array[]::text[])) with ordinality t(term,ord)
    where pg_catalog.btrim(t.term)<>'' and t.ord<=8
  ), docs as materialized (
    select d.* from public.shadow_eval_documents_v1(v_guard) d where d.status='indexed'
  ), totals as (
    select pg_catalog.count(*)::integer total_doc_count from docs
  ), rows as (
    select it.term,
      pg_catalog.plainto_tsquery('english',it.term)<>''::pg_catalog.tsquery as has_ts_signal,
      (select pg_catalog.count(*)::integer from docs d
        where d.title_search_tsv@@pg_catalog.plainto_tsquery('english',it.term)) title_doc_count,
      exists(select 1 from public.document_chunks c join docs d on d.id=c.document_id
        where public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
          and c.search_tsv@@pg_catalog.plainto_tsquery('english',it.term)) chunk_present,
      totals.total_doc_count
    from input_terms it cross join totals order by it.term
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by term),'[]'::jsonb)
    into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_corpus_terms_v1(jsonb,text[]) owner to postgres;
revoke all on function public.u04_eval_corpus_terms_v1(jsonb,text[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_corpus_terms_v1(jsonb,text[]) to service_role;

create or replace function public.u04_eval_correct_terms_v1(p_context jsonb,input_query text,min_sim real)
returns jsonb language plpgsql stable security definer
set search_path = '' as $$
declare v_guard jsonb; tokens text[]; tok text; best text; best_sim real;
  corrected text[]:=array[]::text[]; changed boolean:=false; v_result text;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'correct_terms',
    pg_catalog.jsonb_build_object('input_query',input_query,'min_sim',min_sim));
  if input_query is null or pg_catalog.length(pg_catalog.btrim(input_query))=0 then
    return public.shadow_eval_result_v1(v_guard,pg_catalog.to_jsonb(input_query));
  end if;
  tokens:=pg_catalog.regexp_split_to_array(pg_catalog.lower(input_query),'\s+');
  foreach tok in array tokens loop
    if pg_catalog.length(tok)<4 then corrected:=corrected||tok; continue; end if;
    best:=null;best_sim:=0;
    select candidate.term,candidate.match_sim into best,best_sim from (
      (select pg_catalog.lower(a.canonical) term,extensions.similarity(pg_catalog.lower(a.alias),tok) match_sim
        from public.shadow_eval_aliases_v1(v_guard) a
        where a.enabled and a.owner_id is null and pg_catalog.length(a.alias) between 4 and 40
          and pg_catalog.length(a.canonical) between 4 and 40
          and pg_catalog.lower(a.alias) OPERATOR(extensions.%) tok
        order by extensions.similarity(pg_catalog.lower(a.alias),tok) desc,pg_catalog.lower(a.alias) limit 32)
      union all
      (select pg_catalog.lower(a.canonical),extensions.similarity(pg_catalog.lower(a.canonical),tok)
        from public.shadow_eval_aliases_v1(v_guard) a
        where a.enabled and a.owner_id is null and pg_catalog.length(a.canonical) between 4 and 40
          and pg_catalog.lower(a.canonical) OPERATOR(extensions.%) tok
        order by extensions.similarity(pg_catalog.lower(a.canonical),tok) desc,pg_catalog.lower(a.canonical) limit 32)
      union all
      (select word,extensions.similarity(word,tok) from (
          select distinct d.id document_id,pg_catalog.lower(title_word) word
          from public.shadow_eval_documents_v1(v_guard) d
          cross join lateral pg_catalog.unnest(pg_catalog.regexp_split_to_array(pg_catalog.lower(d.title),'[^a-z]+')) title_word
          where d.owner_id is null and d.status='indexed' and pg_catalog.length(title_word) between 4 and 40
        ) title_words where word OPERATOR(extensions.%) tok
        order by extensions.similarity(word,tok) desc,word limit 32)
    ) candidate order by candidate.match_sim desc,candidate.term limit 1;
    if best is not null and best_sim>=min_sim and best<>tok and pg_catalog.length(best)>=pg_catalog.length(tok)
      then corrected:=corrected||best;changed:=true; else corrected:=corrected||tok; end if;
  end loop;
  v_result:=case when changed then pg_catalog.array_to_string(corrected,' ') else input_query end;
  return public.shadow_eval_result_v1(v_guard,pg_catalog.to_jsonb(v_result));
end $$;
alter function public.u04_eval_correct_terms_v1(jsonb,text,real) owner to postgres;
revoke all on function public.u04_eval_correct_terms_v1(jsonb,text,real) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_correct_terms_v1(jsonb,text,real) to service_role;

create or replace function public.u04_eval_lookup_chunk_terms_v1(
  p_context jsonb,document_filters uuid[],terms text[],match_count integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'lookup_chunk_terms',
    pg_catalog.jsonb_build_object('document_filters',document_filters,'terms',terms,'match_count',match_count));
  with docs as materialized (select * from public.shadow_eval_documents_v1(v_guard)),
  rows as (
    select c.id,c.document_id,c.page_number,c.chunk_index,c.section_heading,c.section_path,c.heading_level,
      c.parent_heading,c.anchor_id,c.content,c.retrieval_synopsis,c.image_ids
    from public.document_chunks c join docs d on d.id=c.document_id
    where document_filters is not null and c.document_id=any(document_filters)
      and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
      and exists(select 1 from pg_catalog.unnest(terms) t(term) where
        c.content ilike '%'||t.term||'%' or coalesce(c.retrieval_synopsis,'') ilike '%'||t.term||'%'
          or coalesce(c.section_heading,'') ilike '%'||t.term||'%')
    limit greatest(match_count*4,24)
  )
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_lookup_chunk_terms_v1(jsonb,uuid[],text[],integer) owner to postgres;
revoke all on function public.u04_eval_lookup_chunk_terms_v1(jsonb,uuid[],text[],integer) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_lookup_chunk_terms_v1(jsonb,uuid[],text[],integer) to service_role;

create or replace function public.u04_eval_lookup_chunk_prefix_v1(
  p_context jsonb,document_filters uuid[],match_count integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'lookup_chunk_prefix',
    pg_catalog.jsonb_build_object('document_filters',document_filters,'match_count',match_count));
  with docs as materialized (select * from public.shadow_eval_documents_v1(v_guard)),
  rows as (
    select c.id,c.document_id,c.page_number,c.chunk_index,c.section_heading,c.section_path,c.heading_level,
      c.parent_heading,c.anchor_id,c.content,c.retrieval_synopsis,c.image_ids
    from public.document_chunks c join docs d on d.id=c.document_id
    where document_filters is not null and c.document_id=any(document_filters)
      and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
    order by c.chunk_index asc limit match_count
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by chunk_index),'[]'::jsonb) into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_lookup_chunk_prefix_v1(jsonb,uuid[],integer) owner to postgres;
revoke all on function public.u04_eval_lookup_chunk_prefix_v1(jsonb,uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_lookup_chunk_prefix_v1(jsonb,uuid[],integer) to service_role;

create or replace function public.u04_eval_lookup_document_terms_v1(p_context jsonb,terms text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'lookup_document_terms',
    pg_catalog.jsonb_build_object('terms',terms));
  with rows as (
    select d.id,d.owner_id,d.title,d.file_name,d.status,d.page_count,d.chunk_count,d.image_count,d.metadata
    from public.shadow_eval_documents_v1(v_guard) d
    where d.status='indexed' and exists(select 1 from pg_catalog.unnest(terms) t(term)
      where d.title ilike '%'||t.term||'%' or d.file_name ilike '%'||t.term||'%')
    limit 12
  )
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_lookup_document_terms_v1(jsonb,text[]) owner to postgres;
revoke all on function public.u04_eval_lookup_document_terms_v1(jsonb,text[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_lookup_document_terms_v1(jsonb,text[]) to service_role;

create or replace function public.u04_eval_memory_cards_lexical_v1(
  p_context jsonb,query_text text,document_filters uuid[],match_count integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'memory_cards_lexical',
    pg_catalog.jsonb_build_object('query_text',query_text,'document_filters',document_filters,'match_count',match_count));
  with q as (select pg_catalog.websearch_to_tsquery('english',coalesce(query_text,'')) tsq),
  docs as materialized (select * from public.shadow_eval_documents_v1(v_guard)),
  rows as (
    select m.id,m.document_id,m.owner_id,m.section_id,m.card_type,m.title,m.content,m.normalized_terms,
      m.page_number,m.source_chunk_ids,m.source_image_ids,m.confidence,m.metadata
    from public.document_memory_cards m join docs d on d.id=m.document_id cross join q
    where m.search_tsv@@q.tsq and (document_filters is null or m.document_id=any(document_filters))
      and public.shadow_eval_generation_matches_v1(v_guard,m.document_id,m.index_generation_id,'memory_cards')
    order by m.confidence desc limit match_count
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by confidence desc),'[]'::jsonb) into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_memory_cards_lexical_v1(jsonb,text,uuid[],integer) owner to postgres;
revoke all on function public.u04_eval_memory_cards_lexical_v1(jsonb,text,uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_memory_cards_lexical_v1(jsonb,text,uuid[],integer) to service_role;


create or replace function public.u04_eval_chunks_by_ids_v1(p_context jsonb,ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'chunks_by_ids',jsonb_build_object('ids',ids));
  with docs as materialized (select * from public.shadow_eval_documents_v1(v_guard)),
  rows as (
    select c.id,c.document_id,c.page_number,c.chunk_index,c.section_heading,c.section_path,c.heading_level,
      c.parent_heading,c.anchor_id,c.content,c.retrieval_synopsis,c.image_ids,c.index_generation_id
    from public.document_chunks c join docs d on d.id=c.document_id
    where c.id=any(ids) and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
    limit pg_catalog.cardinality(ids)
  )
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_chunks_by_ids_v1(jsonb,uuid[]) owner to postgres;
revoke all on function public.u04_eval_chunks_by_ids_v1(jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_chunks_by_ids_v1(jsonb,uuid[]) to service_role;

create or replace function public.u04_eval_chunks_by_indexes_v1(
  p_context jsonb,document_ids uuid[],indexes integer[],match_count integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'chunks_by_indexes',
    jsonb_build_object('document_ids',document_ids,'indexes',indexes,'match_count',match_count));
  with docs as materialized (select * from public.shadow_eval_documents_v1(v_guard)),
  rows as (
    select c.id,c.document_id,c.page_number,c.chunk_index,c.section_heading,c.section_path,c.heading_level,
      c.parent_heading,c.anchor_id,c.content,c.retrieval_synopsis,c.image_ids,c.index_generation_id
    from public.document_chunks c join docs d on d.id=c.document_id
    where c.document_id=any(document_ids) and c.chunk_index=any(indexes)
      and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
    order by c.chunk_index asc limit match_count
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by chunk_index),'[]'::jsonb) into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_chunks_by_indexes_v1(jsonb,uuid[],integer[],integer) owner to postgres;
revoke all on function public.u04_eval_chunks_by_indexes_v1(jsonb,uuid[],integer[],integer) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_chunks_by_indexes_v1(jsonb,uuid[],integer[],integer) to service_role;

create or replace function public.u04_eval_documents_v1(p_context jsonb,ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'documents',jsonb_build_object('ids',ids));
  with rows as (
    select d.id,d.title,d.file_name,d.metadata,d.owner_id,d.status
    from public.shadow_eval_documents_v1(v_guard) d where d.id=any(ids) and d.status='indexed'
  )
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_documents_v1(jsonb,uuid[]) owner to postgres;
revoke all on function public.u04_eval_documents_v1(jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_documents_v1(jsonb,uuid[]) to service_role;

create or replace function public.u04_eval_ranking_metadata_v1(p_context jsonb,document_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'ranking_metadata',jsonb_build_object('document_ids',document_ids));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.document_id),'[]'::jsonb) into v_result
    from public.shadow_eval_related_metadata_v1(v_guard,document_ids,'related_documents') r;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_ranking_metadata_v1(jsonb,uuid[]) owner to postgres;
revoke all on function public.u04_eval_ranking_metadata_v1(jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_ranking_metadata_v1(jsonb,uuid[]) to service_role;

create or replace function public.u04_eval_related_documents_v1(p_context jsonb,document_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'related_documents',jsonb_build_object('document_ids',document_ids));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.document_id),'[]'::jsonb) into v_result
    from public.shadow_eval_related_metadata_v1(v_guard,document_ids,'related_documents') r;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_related_documents_v1(jsonb,uuid[]) owner to postgres;
revoke all on function public.u04_eval_related_documents_v1(jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_related_documents_v1(jsonb,uuid[]) to service_role;

create or replace function public.u04_eval_quality_v1(p_context jsonb,document_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'quality',jsonb_build_object('document_ids',document_ids));
  select coalesce(jsonb_agg(jsonb_build_object('document_id',q.document_id,'owner_id',q.owner_id,
    'quality_score',q.quality_score,'extraction_quality',q.extraction_quality,'metrics',q.metrics,
    'issues',q.issues,'updated_at',q.updated_at)),'[]'::jsonb) into v_result
  from public.shadow_eval_quality_v1(v_guard,document_ids) q;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_quality_v1(jsonb,uuid[]) owner to postgres;
revoke all on function public.u04_eval_quality_v1(jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_quality_v1(jsonb,uuid[]) to service_role;

create or replace function public.u04_eval_images_by_ids_v1(p_context jsonb,ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'images_by_ids',jsonb_build_object('ids',ids));
  with docs as materialized (select * from public.shadow_eval_documents_v1(v_guard)),
  rows as (
    select i.id,i.document_id,i.page_number,i.storage_path,i.caption,i.bbox,i.image_type,i.searchable,
      i.clinical_relevance_score,i.source_kind,i.width,i.height,i.labels,i.metadata
    from public.document_images i join docs d on d.id=i.document_id
    where i.id=any(ids) and i.searchable=true and i.image_type<>'logo_decorative'
      and public.shadow_eval_generation_matches_v1(v_guard,i.document_id,i.index_generation_id,'images')
    limit pg_catalog.cardinality(ids)
  )
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_images_by_ids_v1(jsonb,uuid[]) owner to postgres;
revoke all on function public.u04_eval_images_by_ids_v1(jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_images_by_ids_v1(jsonb,uuid[]) to service_role;

create or replace function public.u04_eval_images_by_pages_v1(
  p_context jsonb,document_ids uuid[],page_numbers integer[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'images_by_pages',
    jsonb_build_object('document_ids',document_ids,'page_numbers',page_numbers));
  with docs as materialized (select * from public.shadow_eval_documents_v1(v_guard)),
  rows as (
    select i.id,i.document_id,i.page_number,i.storage_path,i.caption,i.bbox,i.image_type,i.searchable,
      i.clinical_relevance_score,i.source_kind,i.width,i.height,i.labels,i.metadata
    from public.document_images i join docs d on d.id=i.document_id
    where i.document_id=any(document_ids) and i.page_number=any(page_numbers)
      and i.searchable=true and i.image_type<>'logo_decorative'
      and public.shadow_eval_generation_matches_v1(v_guard,i.document_id,i.index_generation_id,'images')
    order by i.clinical_relevance_score desc limit 80
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by clinical_relevance_score desc),'[]'::jsonb)
    into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_images_by_pages_v1(jsonb,uuid[],integer[]) owner to postgres;
revoke all on function public.u04_eval_images_by_pages_v1(jsonb,uuid[],integer[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_images_by_pages_v1(jsonb,uuid[],integer[]) to service_role;

create or replace function public.u04_eval_visual_rows_v1(p_context jsonb,document_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'visual_rows',jsonb_build_object('document_ids',document_ids));
  with docs as materialized (select * from public.shadow_eval_documents_v1(v_guard)),
  rows as (
    select i.id,i.document_id,i.page_number,i.source_kind,i.searchable,i.image_type,
      i.clinical_relevance_score,i.metadata
    from public.document_images i join docs d on d.id=i.document_id
    where i.document_id=any(document_ids) and i.image_type<>'logo_decorative'
      and public.shadow_eval_generation_matches_v1(v_guard,i.document_id,i.index_generation_id,'images')
  )
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_visual_rows_v1(jsonb,uuid[]) owner to postgres;
revoke all on function public.u04_eval_visual_rows_v1(jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_visual_rows_v1(jsonb,uuid[]) to service_role;

create or replace function public.u04_eval_adjacent_chunks_v1(
  p_context jsonb,document_ids uuid[],chunk_indexes integer[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'adjacent_chunks',
    jsonb_build_object('document_ids',document_ids,'chunk_indexes',chunk_indexes));
  with docs as materialized (select * from public.shadow_eval_documents_v1(v_guard)),
  rows as (
    select c.id,c.document_id,c.page_number,c.chunk_index,c.section_heading,c.content,
      c.retrieval_synopsis,c.index_generation_id
    from public.document_chunks c join docs d on d.id=c.document_id
    where c.document_id=any(document_ids) and c.chunk_index=any(chunk_indexes)
      and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
    order by c.chunk_index asc limit 80
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by chunk_index),'[]'::jsonb) into v_result from rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_adjacent_chunks_v1(jsonb,uuid[],integer[]) owner to postgres;
revoke all on function public.u04_eval_adjacent_chunks_v1(jsonb,uuid[],integer[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_adjacent_chunks_v1(jsonb,uuid[],integer[]) to service_role;


create or replace function public.u04_eval_text_chunks_v1(
  p_context jsonb,query_text text,match_count integer,document_filters uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' set work_mem = '64MB' as $$
declare v_guard jsonb;v_result jsonb;v_count integer;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'text_chunks',
    jsonb_build_object('query_text',query_text,'match_count',match_count,'document_filters',document_filters));
  v_count:=least(greatest(coalesce(match_count,12),1),96);
  with query as (select websearch_to_tsquery('english',coalesce(query_text,'')) tsq),
  docs as materialized (select * from public.shadow_eval_documents_v1(v_guard) where status='indexed'),
  chunk_hits as (
    select c.id from public.document_chunks c join docs d on d.id=c.document_id cross join query
    where c.search_tsv@@query.tsq and (document_filters is null or c.document_id=any(document_filters))
      and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
  ), title_chunk_hits as (
    select c.id from docs d cross join query join public.document_chunks c on c.document_id=d.id
    where d.title_search_tsv@@query.tsq and (document_filters is null or c.document_id=any(document_filters))
      and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
  ), lexical_candidates as (
    select id from chunk_hits union select id from title_chunk_hits
  ), ranked as (
    select c.id,c.document_id,d.title,d.file_name,c.page_number,c.chunk_index,c.section_heading,c.content,
      c.retrieval_synopsis,c.image_ids,d.metadata source_metadata,
      (ts_rank_cd(c.search_tsv,query.tsq)+(ts_rank_cd(d.title_search_tsv,query.tsq)*3.0))::double precision text_rank
    from lexical_candidates cand join public.document_chunks c on c.id=cand.id
      join docs d on d.id=c.document_id cross join query
    order by (ts_rank_cd(c.search_tsv,query.tsq)+(ts_rank_cd(d.title_search_tsv,query.tsq)*3.0)) desc
    limit least(greatest(v_count*2,24),96)
  ), metadata as materialized (
    select m.* from public.shadow_eval_related_metadata_v1(v_guard,
      array(select distinct document_id from ranked),'text_chunks') m
  ), final_rows as (
    select ranked.id,ranked.document_id,ranked.title,ranked.file_name,ranked.page_number,ranked.chunk_index,
      ranked.section_heading,ranked.content,ranked.retrieval_synopsis,ranked.image_ids,ranked.source_metadata,
      coalesce(metadata.labels,'[]'::jsonb) document_labels,metadata.summary document_summary,
      0::double precision similarity,ranked.text_rank,
      least(0.5,0.18+(least(ranked.text_rank,1)*0.3))::double precision hybrid_score,
      least(0.99,0.4+(least(ranked.text_rank,1)*0.59))::double precision lexical_score,
      public.shadow_eval_image_metadata_v1(v_guard,ranked.image_ids) images
    from ranked left join metadata on metadata.document_id=ranked.document_id
    order by hybrid_score desc,text_rank desc,ranked.id limit v_count
  )
  select coalesce(jsonb_agg(to_jsonb(final_rows) order by hybrid_score desc,text_rank desc,id),'[]'::jsonb)
    into v_result from final_rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_text_chunks_v1(jsonb,text,integer,uuid[]) owner to postgres;
revoke all on function public.u04_eval_text_chunks_v1(jsonb,text,integer,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_text_chunks_v1(jsonb,text,integer,uuid[]) to service_role;

create or replace function public.u04_eval_hybrid_chunks_v1(
  p_context jsonb,query_embedding extensions.vector(1536),query_text text,match_count integer,
  min_similarity double precision,document_filters uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' set work_mem = '128MB' as $$
declare v_guard jsonb;v_result jsonb;v_clock timestamptz;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'hybrid_chunks',
    jsonb_build_object('query_embedding',query_embedding::text,'query_text',query_text,'match_count',match_count,
      'min_similarity',min_similarity,'document_filters',document_filters));
  v_clock:=(v_guard->>'comparisonClock')::timestamptz;
  with query as (select websearch_to_tsquery('english',coalesce(query_text,'')) tsq),
  docs as materialized (select * from public.shadow_eval_documents_v1(v_guard) where status='indexed'),
  qualities as materialized (
    select q.* from public.shadow_eval_quality_v1(v_guard,array(select id from docs)) q
  ), scopes(public_scope) as (values(false),(true)),
  vector_ranked as (
    select v.* from scopes s cross join lateral (
    select s.public_scope,c.id,c.document_id,c.page_number,c.chunk_index,c.section_heading,c.content,c.retrieval_synopsis,c.image_ids,
      1-(c.embedding OPERATOR(extensions.<=>) query_embedding) similarity,
      (ts_rank_cd(c.search_tsv,query.tsq)+(ts_rank_cd(d.title_search_tsv,query.tsq)*3.0))::double precision text_rank,
      row_number() over(order by c.embedding OPERATOR(extensions.<=>) query_embedding) vector_rank,
      null::bigint text_match_rank,coalesce((d.metadata->'rag_indexing_version') is not null,false) has_deep_index,
      d.updated_at doc_updated_at,coalesce(q.quality_score,0.7)::double precision quality_score
    from public.document_chunks c join docs d on d.id=c.document_id left join qualities q on q.document_id=c.document_id cross join query
    where (d.owner_id is null)=s.public_scope
      and (document_filters is null or c.document_id=any(document_filters))
      and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
      and 1-(c.embedding OPERATOR(extensions.<=>) query_embedding)>=min_similarity
    order by c.embedding OPERATOR(extensions.<=>) query_embedding limit greatest(match_count*6,48)
    ) v
  ), text_ranked as (
    select t.* from scopes s cross join lateral (
    select s.public_scope,c.id,c.document_id,c.page_number,c.chunk_index,c.section_heading,c.content,c.retrieval_synopsis,c.image_ids,
      1-(c.embedding OPERATOR(extensions.<=>) query_embedding) similarity,
      (ts_rank_cd(c.search_tsv,query.tsq)+(ts_rank_cd(d.title_search_tsv,query.tsq)*3.0))::double precision text_rank,
      null::bigint vector_rank,
      row_number() over(order by (ts_rank_cd(c.search_tsv,query.tsq)+(ts_rank_cd(d.title_search_tsv,query.tsq)*3.0)) desc,
        c.embedding OPERATOR(extensions.<=>) query_embedding) text_match_rank,
      coalesce((d.metadata->'rag_indexing_version') is not null,false) has_deep_index,
      d.updated_at doc_updated_at,coalesce(q.quality_score,0.7)::double precision quality_score
    from public.document_chunks c join docs d on d.id=c.document_id left join qualities q on q.document_id=c.document_id cross join query
    where (d.owner_id is null)=s.public_scope
      and (document_filters is null or c.document_id=any(document_filters))
      and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
      and c.search_tsv@@query.tsq
    order by (ts_rank_cd(c.search_tsv,query.tsq)+(ts_rank_cd(d.title_search_tsv,query.tsq)*3.0)) desc
    limit greatest(match_count*6,48)
    ) t
  ), combined as (select * from vector_ranked union all select * from text_ranked),
  scored as (
    select public_scope,id,document_id,page_number,chunk_index,section_heading,content,retrieval_synopsis,image_ids,
      max(similarity)::double precision similarity,max(text_rank)::double precision text_rank,
      min(vector_rank) vector_rank,min(text_match_rank) text_match_rank,max(quality_score)::double precision quality_score,
      bool_or(has_deep_index) has_deep_index,max(doc_updated_at) doc_updated_at
    from combined group by public_scope,id,document_id,page_number,chunk_index,section_heading,content,retrieval_synopsis,image_ids
  ), scored_metrics as (
    select scored.*,((similarity*0.62)+(least(text_rank,1)*0.22)+(quality_score*0.10)+
      (case when doc_updated_at>v_clock-interval '90 days' then 0.06 else 0 end))::double precision hybrid_score,
      (coalesce(1.0/(60+vector_rank),0)+coalesce(1.0/(60+text_match_rank),0))::double precision rrf_score
    from scored
  ), hybrid_candidates as (
    select h.* from scopes s cross join lateral (
      select id,public_scope from scored_metrics where public_scope=s.public_scope
      order by hybrid_score desc,similarity desc,text_rank desc limit match_count) h
  ), vector_candidates as (
    select v.* from scopes s cross join lateral (
      select id,public_scope from scored_metrics where public_scope=s.public_scope
      order by similarity desc,hybrid_score desc limit match_count) v
  ), text_candidates as (
    select t.* from scopes s cross join lateral (
      select id,public_scope from scored_metrics where public_scope=s.public_scope
      order by text_rank desc,hybrid_score desc limit match_count) t
  ), rrf_candidates as (
    select r.* from scopes s cross join lateral (
      select id,public_scope from scored_metrics where public_scope=s.public_scope
      order by rrf_score desc,hybrid_score desc limit match_count) r
  ), candidate_ids as (
    select id,public_scope from hybrid_candidates union select id,public_scope from vector_candidates union
    select id,public_scope from text_candidates union select id,public_scope from rrf_candidates
  ), base_rows as (
    select b.* from scopes s cross join lateral (
      select c.id,c.document_id,d.title,d.file_name,c.page_number,c.chunk_index,c.section_heading,c.content,
        c.retrieval_synopsis,c.image_ids,d.metadata source_metadata,c.similarity,c.text_rank,c.hybrid_score,c.rrf_score,
        public.shadow_eval_image_metadata_v1(v_guard,c.image_ids) images
      from scored_metrics c join candidate_ids ids on ids.id=c.id and ids.public_scope=c.public_scope
        join docs d on d.id=c.document_id
      where c.public_scope=s.public_scope
      order by c.hybrid_score desc,c.rrf_score desc,c.similarity desc,c.text_rank desc limit match_count
    ) b
  ), final_rows as (
    select * from base_rows order by hybrid_score desc,rrf_score desc,id
    limit greatest(1,least(match_count,100))
  )
  select coalesce(jsonb_agg(to_jsonb(final_rows) order by hybrid_score desc,rrf_score desc,id),'[]'::jsonb)
    into v_result from final_rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_hybrid_chunks_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) owner to postgres;
revoke all on function public.u04_eval_hybrid_chunks_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_hybrid_chunks_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) to service_role;

create or replace function public.u04_eval_vector_chunks_v1(
  p_context jsonb,query_embedding extensions.vector(1536),match_count integer,
  min_similarity double precision,document_filter uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set hnsw.ef_search = '100' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'vector_chunks',
    jsonb_build_object('query_embedding',query_embedding::text,'match_count',match_count,
      'min_similarity',min_similarity,'document_filter',document_filter));
  with docs as materialized (select * from public.shadow_eval_documents_v1(v_guard) where status='indexed'),
  scopes(public_scope) as (values(false),(true)),
  base_rows as (
    select b.* from scopes s cross join lateral (
      select c.id,c.document_id,d.title,d.file_name,c.page_number,c.chunk_index,c.section_heading,c.content,
        c.retrieval_synopsis,c.image_ids,d.metadata source_metadata,'[]'::jsonb document_labels,
        null::text document_summary,1-(c.embedding OPERATOR(extensions.<=>) query_embedding) similarity,
        '[]'::jsonb images
      from public.document_chunks c join docs d on d.id=c.document_id
      where (d.owner_id is null)=s.public_scope
        and (document_filter is null or c.document_id=document_filter)
        and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
        and 1-(c.embedding OPERATOR(extensions.<=>) query_embedding)>=min_similarity
      order by c.embedding OPERATOR(extensions.<=>) query_embedding limit match_count
    ) b
  ), final_rows as (
    select * from base_rows order by similarity desc,id limit greatest(1,least(match_count,100))
  )
  select coalesce(jsonb_agg(to_jsonb(final_rows) order by similarity desc,id),'[]'::jsonb)
    into v_result from final_rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_vector_chunks_v1(jsonb,extensions.vector,integer,double precision,uuid) owner to postgres;
revoke all on function public.u04_eval_vector_chunks_v1(jsonb,extensions.vector,integer,double precision,uuid) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_vector_chunks_v1(jsonb,extensions.vector,integer,double precision,uuid) to service_role;

create or replace function public.u04_eval_lookup_chunks_v1(
  p_context jsonb,query_text text,document_filters uuid[],match_count integer)
returns jsonb language plpgsql stable security definer set search_path = '' set work_mem = '64MB' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'lookup_chunks',
    jsonb_build_object('query_text',query_text,'document_filters',document_filters,'match_count',match_count));
  with query as (select websearch_to_tsquery('english',coalesce(query_text,'')) tsq),
  docs as materialized (select * from public.shadow_eval_documents_v1(v_guard) where status='indexed'),
  scopes(public_scope) as (values(false),(true)),
  base_rows as (
    select b.* from scopes s cross join lateral (
      select c.id,c.document_id,c.page_number,c.chunk_index,c.section_heading,c.section_path,c.heading_level,
        c.parent_heading,c.anchor_id,c.content,c.retrieval_synopsis,c.image_ids,
        (ts_rank_cd(c.search_tsv,query.tsq)+
          (case when c.section_heading is not null then ts_rank_cd(to_tsvector('english',c.section_heading),query.tsq)*0.35 else 0 end)+
          (ts_rank_cd(d.title_search_tsv,query.tsq)*0.25))::double precision text_rank
      from public.document_chunks c join docs d on d.id=c.document_id cross join query
      where (d.owner_id is null)=s.public_scope and document_filters is not null
        and c.document_id=any(document_filters)
        and public.shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')
        and (c.search_tsv@@query.tsq or d.title_search_tsv@@query.tsq)
      order by text_rank desc,c.chunk_index asc limit least(greatest(match_count,1),80)
    ) b
  ), final_rows as (
    select * from base_rows order by text_rank desc,id limit greatest(1,least(match_count,100))
  )
  select coalesce(jsonb_agg(to_jsonb(final_rows) order by text_rank desc,id),'[]'::jsonb)
    into v_result from final_rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_lookup_chunks_v1(jsonb,text,uuid[],integer) owner to postgres;
revoke all on function public.u04_eval_lookup_chunks_v1(jsonb,text,uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_lookup_chunks_v1(jsonb,text,uuid[],integer) to service_role;

create or replace function public.u04_eval_lookup_documents_v1(p_context jsonb,query_text text,match_count integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'lookup_documents',
    jsonb_build_object('query_text',query_text,'match_count',match_count));
  with query as (select websearch_to_tsquery('english',coalesce(query_text,'')) tsq),
  docs as materialized (select * from public.shadow_eval_documents_v1(v_guard)),
  scopes(public_scope) as (values(false),(true)),
  ranked as (
    select d.id,d.owner_id,d.title,d.file_name,d.status,d.page_count,d.chunk_count,d.image_count,d.metadata,
      ((ts_rank_cd(d.title_search_tsv,query.tsq)*4.0)+(ts_rank_cd(d.search_tsv,query.tsq)*1.5))::double precision text_rank,
      case when d.title_search_tsv@@query.tsq then 'title'
        when d.search_tsv@@query.tsq then 'metadata' else 'none' end match_reason
    from docs d cross join query
    where d.status='indexed' and (d.title_search_tsv@@query.tsq or d.search_tsv@@query.tsq)
  ), base_rows as (
    select b.* from scopes s cross join lateral (
      select * from ranked where (owner_id is null)=s.public_scope and text_rank>0
      order by text_rank desc,page_count desc,title asc limit match_count
    ) b
  ), final_rows as (
    select * from base_rows order by text_rank desc,id limit greatest(1,least(match_count,100))
  )
  select coalesce(jsonb_agg(to_jsonb(final_rows) order by text_rank desc,id),'[]'::jsonb)
    into v_result from final_rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_lookup_documents_v1(jsonb,text,integer) owner to postgres;
revoke all on function public.u04_eval_lookup_documents_v1(jsonb,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_lookup_documents_v1(jsonb,text,integer) to service_role;


create or replace function public.u04_eval_table_facts_v1(
  p_context jsonb,query_text text,match_count integer,document_filters uuid[])
returns jsonb language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' set work_mem = '64MB' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'table_facts',
    jsonb_build_object('query_text',query_text,'match_count',match_count,'document_filters',document_filters));
  with query as (
    select websearch_to_tsquery('english',coalesce(query_text,'')) tsq,
      lower(trim(regexp_replace(coalesce(query_text,''),'\s+',' ','g'))) normalized,
      string_to_array(lower(trim(regexp_replace(coalesce(query_text,''),'\s+',' ','g'))),' ')::text[] tokens
  ), scopes(public_scope) as (values(false),(true)),
  doc_scope as materialized (
    select d.id,(d.owner_id is null) public_scope from public.shadow_eval_documents_v1(v_guard) d
    where d.status='indexed' and (document_filters is null or d.id=any(document_filters))
  ), fts_matches as (
    select x.* from scopes s cross join lateral (
    select s.public_scope,f.id,f.document_id,f.source_chunk_id,f.source_image_id,f.page_number,f.table_title,f.row_label,
      f.clinical_parameter,f.threshold_value,f.action,ts_rank_cd(f.search_tsv,q.tsq)::double precision text_rank,
      case when coalesce(f.threshold_value,'')<>'' then 'table_threshold'
        when coalesce(f.action,'')<>'' then 'table_action' else 'table_row' end match_reason
    from query q join public.document_table_facts f on f.search_tsv@@q.tsq join doc_scope ds on ds.id=f.document_id
    where ds.public_scope=s.public_scope
      and public.shadow_eval_generation_matches_v1(v_guard,f.document_id,f.index_generation_id,'table_facts')
    order by ts_rank_cd(f.search_tsv,q.tsq) desc limit greatest(match_count*5,64)
    ) x
  ), term_matches as (
    select x.* from scopes s cross join lateral (
    select s.public_scope,f.id,f.document_id,f.source_chunk_id,f.source_image_id,f.page_number,f.table_title,f.row_label,
      f.clinical_parameter,f.threshold_value,f.action,0.45::double precision text_rank,'term_overlap'::text match_reason
    from query q join public.document_table_facts f on cardinality(q.tokens)>0 and f.normalized_terms&&q.tokens
      join doc_scope ds on ds.id=f.document_id
    where ds.public_scope=s.public_scope
      and public.shadow_eval_generation_matches_v1(v_guard,f.document_id,f.index_generation_id,'table_facts')
    limit greatest(match_count*4,48)
    ) x
  ), trgm_matches as (
    select x.* from scopes s cross join lateral (
    select s.public_scope,f.id,f.document_id,f.source_chunk_id,f.source_image_id,f.page_number,f.table_title,f.row_label,
      f.clinical_parameter,f.threshold_value,f.action,
      (extensions.similarity(lower(coalesce(f.table_title,'')||' '||coalesce(f.row_label,'')||' '||
        coalesce(f.clinical_parameter,'')),q.normalized)*0.8)::double precision text_rank,
      'trgm_similarity'::text match_reason
    from query q join public.document_table_facts f on
      lower(coalesce(f.table_title,'')||' '||coalesce(f.row_label,'')||' '||coalesce(f.clinical_parameter,''))
        OPERATOR(extensions.%) q.normalized
      join doc_scope ds on ds.id=f.document_id
    where ds.public_scope=s.public_scope
      and public.shadow_eval_generation_matches_v1(v_guard,f.document_id,f.index_generation_id,'table_facts')
      and extensions.similarity(lower(coalesce(f.table_title,'')||' '||coalesce(f.row_label,'')||' '||
        coalesce(f.clinical_parameter,'')),q.normalized)>=0.18
    order by extensions.similarity(lower(coalesce(f.table_title,'')||' '||coalesce(f.row_label,'')||' '||
      coalesce(f.clinical_parameter,'')),q.normalized) desc limit greatest(match_count*4,48)
    ) x
  ), combined as (
    select * from fts_matches union all select * from term_matches union all select * from trgm_matches
  ), deduped as (
    select distinct on(c.public_scope,c.id) c.* from combined c order by c.public_scope,c.id,c.text_rank desc
  ), base_rows as (
    select b.* from scopes s cross join lateral (
      select d.id,d.document_id,d.source_chunk_id,d.source_image_id,d.page_number,d.table_title,d.row_label,
        d.clinical_parameter,d.threshold_value,d.action,d.text_rank,d.match_reason,'{}'::jsonb metadata
      from deduped d where d.public_scope=s.public_scope and d.text_rank>0
      order by d.text_rank desc,d.page_number asc nulls last limit match_count
    ) b
  ), final_rows as (
    select * from base_rows order by text_rank desc,id limit greatest(1,least(match_count,100))
  )
  select coalesce(jsonb_agg(to_jsonb(final_rows) order by text_rank desc,id),'[]'::jsonb)
    into v_result from final_rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_table_facts_v1(jsonb,text,integer,uuid[]) owner to postgres;
revoke all on function public.u04_eval_table_facts_v1(jsonb,text,integer,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_table_facts_v1(jsonb,text,integer,uuid[]) to service_role;

create or replace function public.u04_eval_embedding_fields_v1(
  p_context jsonb,query_embedding extensions.vector(1536),query_text text,match_count integer,
  min_similarity double precision,document_filters uuid[])
returns jsonb language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' set work_mem = '128MB' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'embedding_fields',
    jsonb_build_object('query_embedding',query_embedding::text,'query_text',query_text,'match_count',match_count,
      'min_similarity',min_similarity,'document_filters',document_filters));
  with query as (select websearch_to_tsquery('english',coalesce(query_text,'')) tsq),
  docs as materialized (select * from public.shadow_eval_documents_v1(v_guard) where status='indexed'),
  scopes(public_scope) as (values(false),(true)),
  vector_hits as (
    select x.* from scopes s cross join lateral (
      select s.public_scope,f.id from public.document_embedding_fields f join docs d on d.id=f.document_id
      where (d.owner_id is null)=s.public_scope
        and (document_filters is null or f.document_id=any(document_filters)) and f.source_chunk_id is not null
        and public.shadow_eval_generation_matches_v1(v_guard,f.document_id,f.index_generation_id,'embedding_fields')
        and 1-(f.embedding OPERATOR(extensions.<=>) query_embedding)>=min_similarity
      order by f.embedding OPERATOR(extensions.<=>) query_embedding limit greatest(match_count*3,32)
    ) x
  ), text_hits as (
    select x.* from scopes s cross join lateral (
      select s.public_scope,f.id from public.document_embedding_fields f join docs d on d.id=f.document_id cross join query
      where (d.owner_id is null)=s.public_scope
        and (document_filters is null or f.document_id=any(document_filters)) and f.source_chunk_id is not null
        and public.shadow_eval_generation_matches_v1(v_guard,f.document_id,f.index_generation_id,'embedding_fields')
        and f.search_tsv@@query.tsq
      order by ts_rank_cd(f.search_tsv,query.tsq) desc limit greatest(match_count*3,32)
    ) x
  ), candidate_ids as (
    select public_scope,id from vector_hits union select public_scope,id from text_hits
  ),
  ranked as (
    select ids.public_scope,f.id,f.document_id,f.source_chunk_id,f.field_type,f.content,
      (1-(f.embedding OPERATOR(extensions.<=>) query_embedding))::double precision similarity,
      ts_rank_cd(f.search_tsv,query.tsq)::double precision text_rank
    from public.document_embedding_fields f join candidate_ids ids on ids.id=f.id cross join query
  ), base_rows as (
    select b.* from scopes s cross join lateral (
      select id,document_id,source_chunk_id,field_type,content,similarity,text_rank,
        ((similarity*0.7)+(least(text_rank,1)*0.3))::double precision hybrid_score
      from ranked where public_scope=s.public_scope
      order by hybrid_score desc,similarity desc,text_rank desc limit match_count
    ) b
  ), final_rows as (
    select * from base_rows order by hybrid_score desc,id limit greatest(1,least(match_count,100))
  )
  select coalesce(jsonb_agg(to_jsonb(final_rows) order by hybrid_score desc,id),'[]'::jsonb)
    into v_result from final_rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_embedding_fields_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) owner to postgres;
revoke all on function public.u04_eval_embedding_fields_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_embedding_fields_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) to service_role;

create or replace function public.u04_eval_index_units_v1(
  p_context jsonb,query_embedding extensions.vector(1536),query_text text,match_count integer,
  min_similarity double precision,document_filters uuid[])
returns jsonb language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' set work_mem = '128MB' as $$
declare v_guard jsonb;v_result jsonb;v_count integer;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'index_units',
    jsonb_build_object('query_embedding',query_embedding::text,'query_text',query_text,'match_count',match_count,
      'min_similarity',min_similarity,'document_filters',document_filters));
  v_count:=least(greatest(coalesce(match_count,24),1),96);
  with query as (
    select websearch_to_tsquery('english',coalesce(query_text,'')) tsq,
      regexp_split_to_array(lower(coalesce(query_text,'')),'\s+') terms
  ), docs as materialized (select * from public.shadow_eval_documents_v1(v_guard) where status='indexed'),
  text_hits as (
    select u.id from public.document_index_units u join docs d on d.id=u.document_id cross join query
    where u.search_tsv@@query.tsq and (document_filters is null or u.document_id=any(document_filters))
      and u.source_chunk_id is not null
      and public.shadow_eval_generation_matches_v1(v_guard,u.document_id,u.index_generation_id,'index_units')
  ), term_hits as (
    select u.id from public.document_index_units u join docs d on d.id=u.document_id cross join query
    where u.normalized_terms&&query.terms and (document_filters is null or u.document_id=any(document_filters))
      and u.source_chunk_id is not null
      and public.shadow_eval_generation_matches_v1(v_guard,u.document_id,u.index_generation_id,'index_units')
  ), candidate_ids as (select id from text_hits union select id from term_hits),
  ranked as (
    select u.id,u.document_id,u.source_chunk_id,u.source_image_id,u.unit_type,u.title,u.content,u.page_start,u.page_end,
      u.heading_path,u.normalized_terms,u.source_span,u.quality_score,u.extraction_mode,
      (1-(u.embedding OPERATOR(extensions.<=>) query_embedding))::double precision similarity,
      (ts_rank_cd(u.search_tsv,query.tsq)+case when u.normalized_terms&&query.terms then 0.25 else 0 end+
        case when u.unit_type in ('askable_question','table_fact','clinical_fact','threshold','workflow_step',
          'medication_monitoring','alias','visual_summary','flowchart_step','diagram_decision','risk_matrix_cell',
          'medication_chart_row','chart_finding','visual_askable_question','table_threshold') then 0.06
          when u.unit_type='section_summary' then 0.03 else 0 end)::double precision text_rank,u.metadata
    from candidate_ids ids join public.document_index_units u on u.id=ids.id cross join query
    order by text_rank desc limit greatest(v_count*3,48)
  ), final_rows as (
    select id,document_id,source_chunk_id,source_image_id,unit_type,title,content,page_start,page_end,heading_path,
      normalized_terms,source_span,quality_score,extraction_mode,similarity,text_rank,
      ((similarity*0.52)+(least(text_rank,1)*0.28)+(quality_score*0.12)+
        (case when extraction_mode in ('model_heavy','hybrid') then 0.04 else 0 end)+
        (case when unit_type in ('askable_question','threshold','table_fact','table_threshold','visual_askable_question') then 0.04
          when unit_type in ('workflow_step','medication_monitoring','flowchart_step','diagram_decision',
            'medication_chart_row','risk_matrix_cell') then 0.03 else 0 end))::double precision hybrid_score,metadata
    from ranked order by hybrid_score desc,id limit v_count
  )
  select coalesce(jsonb_agg(to_jsonb(final_rows) order by hybrid_score desc,id),'[]'::jsonb)
    into v_result from final_rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_index_units_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) owner to postgres;
revoke all on function public.u04_eval_index_units_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_index_units_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) to service_role;

create or replace function public.u04_eval_memory_cards_hybrid_v1(
  p_context jsonb,query_embedding extensions.vector(1536),query_text text,match_count integer,
  min_similarity double precision,document_filters uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' set work_mem = '64MB' as $$
declare v_guard jsonb;v_result jsonb;
begin
  v_guard:=public.shadow_eval_guard_v1(p_context,'memory_cards_hybrid',
    jsonb_build_object('query_embedding',query_embedding::text,'query_text',query_text,'match_count',match_count,
      'min_similarity',min_similarity,'document_filters',document_filters));
  with query as (select websearch_to_tsquery('english',coalesce(query_text,'')) tsq),
  docs as materialized (select * from public.shadow_eval_documents_v1(v_guard) where status='indexed'),
  scopes(public_scope) as (values(false),(true)),
  vector_ranked as (
    select x.* from scopes s cross join lateral (
    select s.public_scope,m.*,(1-(m.embedding OPERATOR(extensions.<=>) query_embedding))::double precision similarity,
      ts_rank_cd(m.search_tsv,query.tsq)::double precision text_rank,
      row_number() over(order by m.embedding OPERATOR(extensions.<=>) query_embedding) vector_rank,
      null::bigint text_match_rank
    from public.document_memory_cards m join docs d on d.id=m.document_id cross join query
    where (d.owner_id is null)=s.public_scope
      and (document_filters is null or m.document_id=any(document_filters))
      and public.shadow_eval_generation_matches_v1(v_guard,m.document_id,m.index_generation_id,'memory_cards')
      and 1-(m.embedding OPERATOR(extensions.<=>) query_embedding)>=min_similarity
    order by m.embedding OPERATOR(extensions.<=>) query_embedding limit greatest(match_count*6,96)
    ) x
  ), text_ranked as (
    select x.* from scopes s cross join lateral (
    select s.public_scope,m.*,(1-(m.embedding OPERATOR(extensions.<=>) query_embedding))::double precision similarity,
      ts_rank_cd(m.search_tsv,query.tsq)::double precision text_rank,null::bigint vector_rank,
      row_number() over(order by ts_rank_cd(m.search_tsv,query.tsq) desc,
        m.embedding OPERATOR(extensions.<=>) query_embedding) text_match_rank
    from public.document_memory_cards m join docs d on d.id=m.document_id cross join query
    where (d.owner_id is null)=s.public_scope
      and (document_filters is null or m.document_id=any(document_filters))
      and public.shadow_eval_generation_matches_v1(v_guard,m.document_id,m.index_generation_id,'memory_cards')
      and m.search_tsv@@query.tsq
    order by ts_rank_cd(m.search_tsv,query.tsq) desc limit greatest(match_count*6,96)
    ) x
  ), combined as (select * from vector_ranked union all select * from text_ranked),
  scored as (
    select public_scope,id,document_id,owner_id,section_id,card_type,title,content,normalized_terms,page_number,
      source_chunk_ids,source_image_ids,confidence,metadata,max(similarity)::double precision similarity,
      max(text_rank)::double precision text_rank,min(vector_rank) vector_rank,min(text_match_rank) text_match_rank
    from combined group by public_scope,id,document_id,owner_id,section_id,card_type,title,content,normalized_terms,
      page_number,source_chunk_ids,source_image_ids,confidence,metadata
  ), scored_rows as (
    select public_scope,id,document_id,owner_id,section_id,card_type,title,content,normalized_terms,page_number,
      source_chunk_ids,source_image_ids,confidence,metadata,similarity,text_rank,
      ((similarity*0.62)+(least(text_rank,1)*0.24)+(confidence*0.10)+
        (coalesce(1.0/(60+vector_rank),0)+coalesce(1.0/(60+text_match_rank),0))*0.04)::double precision hybrid_score,
      (coalesce(1.0/(60+vector_rank),0)+coalesce(1.0/(60+text_match_rank),0))::double precision rrf_score
    from scored
  ), base_rows as (
    select b.* from scopes s cross join lateral (
      select id,document_id,owner_id,section_id,card_type,title,content,normalized_terms,page_number,
        source_chunk_ids,source_image_ids,confidence,metadata,similarity,text_rank,hybrid_score,rrf_score
      from scored_rows where public_scope=s.public_scope
      order by hybrid_score desc,similarity desc,text_rank desc,confidence desc limit match_count
    ) b
  ), final_rows as (
    select * from base_rows order by hybrid_score desc,rrf_score desc,id limit greatest(1,least(match_count,100))
  )
  select coalesce(jsonb_agg(to_jsonb(final_rows) order by hybrid_score desc,rrf_score desc,id),'[]'::jsonb)
    into v_result from final_rows;
  return public.shadow_eval_result_v1(v_guard,v_result);
end $$;
alter function public.u04_eval_memory_cards_hybrid_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) owner to postgres;
revoke all on function public.u04_eval_memory_cards_hybrid_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.u04_eval_memory_cards_hybrid_v1(jsonb,extensions.vector,text,integer,double precision,uuid[]) to service_role;

-- U04 evaluation same-statement guard candidate 1.
-- Outside-only source component. This file is not an applied migration.
-- The read-only reconciliation below is the current production body with only:
--   * a distinct private name,
--   * STABLE declaration,
--   * removal of FOR UPDATE, and
--   * mandatory complete stored-outcome equality before full revalidation.
-- Every nested callee is already STABLE or IMMUTABLE.
-- U04 evaluator-only read-only terminal counterparts.
-- These preserve producer validators and admit only immutable sealed evidence.
create or replace function public.shadow_eval_projection_disposition_v1(p_member public.document_index_generations,p_declaration jsonb,p_outcome jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row public.document_generation_projections%rowtype;v_ref jsonb;v_family text;v_slot text;v_batch jsonb;v_planned jsonb;v_original jsonb;
  v_payload jsonb;v_component jsonb;v_component_digest text;v_digest text;v_count bigint;v_ordinal bigint;
begin
  v_ref:=p_outcome->'artifactRef';v_family:=p_outcome->>'family';v_slot:=v_ref->>'slot';
  if v_ref->>'tag' is distinct from 'candidate_projection'
    or v_slot is distinct from (case v_family when 'summary' then 'summary' when 'generated_labels' then 'generated_labels'
      when 'quality' then 'quality' when 'document_metadata' then 'worker_metadata' when 'producer_aliases' then 'producer_aliases' end)
    then raise exception 'shadow_projection_reference_family'; end if;
  select * into v_row from public.document_generation_projections where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id;
  if not found or v_row.owner_id is distinct from p_member.owner_id or v_row.lease_token is distinct from p_member.first_lease_token
    or p_member.state is distinct from 'staged' or p_member.staged_at is null
    or v_row.sealed_at is distinct from p_member.staged_at
    then raise exception 'shadow_projection_reference_identity'; end if;
  v_batch:=public.shadow_inventory_envelope_payload_v1(p_declaration->'outputManifestEnvelope');
  select count(*),pg_catalog.jsonb_agg(value->'output')->0 into v_count,v_planned from pg_catalog.jsonb_array_elements(v_batch->'units')
    where value->>'family'=v_family and value->>'key'=p_outcome->>'unitKey';
  if v_count<>1 or pg_catalog.jsonb_typeof(p_outcome->'retainedNativePayload') is distinct from 'string'
    then raise exception 'shadow_projection_original_required'; end if;
  perform public.shadow_strict_original_json_v1((p_outcome->>'retainedNativePayload')::json);
  v_original:=public.shadow_inventory_envelope_payload_v1((p_outcome->>'retainedNativePayload')::jsonb);
  if v_original is distinct from v_planned then raise exception 'shadow_projection_original_changed'; end if;
  if v_family in ('generated_labels','producer_aliases') then
    if pg_catalog.jsonb_typeof(v_ref->'itemId') is distinct from 'string' then raise exception 'shadow_projection_item_required'; end if;
    select count(*),min(ord),pg_catalog.jsonb_agg(value)->0 into v_count,v_ordinal,v_payload
      from pg_catalog.jsonb_array_elements(case v_family when 'generated_labels' then v_row.generated_labels else v_row.producer_aliases end)
        with ordinality a(value,ord) where value->'id'=v_ref->'itemId';
    if v_count<>1 then raise exception 'shadow_projection_item_unavailable'; end if;
    if (v_family='generated_labels' and p_outcome->>'unitKey' is distinct from public.shadow_node_value_text_v1(
          pg_catalog.jsonb_build_object('label',v_payload->'label','label_type',v_payload->'label_type')))
      or (v_family='producer_aliases' and p_outcome->>'unitKey' is distinct from 'deep:'||(v_ordinal-1)::text)
      then raise exception 'shadow_projection_item_original_mismatch'; end if;
  else
    if v_ref->'itemId' is distinct from 'null'::jsonb or p_outcome->>'unitKey' is distinct from 'singleton'
      then raise exception 'shadow_projection_singleton_required'; end if;
    v_payload:=case v_family when 'summary' then v_row.summary when 'quality' then v_row.quality else v_row.worker_metadata end;
  end if;
  if v_payload is null or v_payload='null'::jsonb then raise exception 'shadow_projection_payload_unavailable'; end if;
  if v_family in ('summary','generated_labels') then
    v_component_digest:=v_row.summary_digest;
    v_component:=pg_catalog.jsonb_build_object('kind','u04-summary-projection-v1','binding',public.shadow_projection_binding_v1(p_member),
      'outputManifestEnvelope',p_declaration->'outputManifestEnvelope','summary',v_row.summary,'generated_labels',v_row.generated_labels,
      'summary_projection_complete',v_row.summary_projection_complete,'enrichment_metadata',v_row.enrichment_metadata);
  elsif v_family='quality' then
    v_component_digest:=v_row.quality_digest;
    v_component:=pg_catalog.jsonb_build_object('kind','u04-quality-projection-v1','binding',public.shadow_projection_binding_v1(p_member),
      'outputManifestEnvelope',p_declaration->'outputManifestEnvelope','quality',v_row.quality);
  elsif v_family='document_metadata' then
    v_component_digest:=v_row.worker_state_digest;
    v_component:=pg_catalog.jsonb_build_object('kind','u04-worker-projection-v1','binding',public.shadow_projection_binding_v1(p_member),
      'outputManifestEnvelope',p_declaration->'outputManifestEnvelope','worker_metadata',v_row.worker_metadata,'document_counts',v_row.document_counts);
  else
    v_component_digest:=v_row.deep_memory_digest;
    v_component:=pg_catalog.jsonb_build_object('kind','u04-deep-projection-v1','binding',public.shadow_projection_binding_v1(p_member,v_row.deep_memory_artifact_generation_id),
      'outputManifestEnvelope',p_declaration->'outputManifestEnvelope','deep_memory_receipt',v_row.deep_memory_receipt,
      'deep_memory_metadata',v_row.deep_memory_metadata,'producer_aliases',v_row.producer_aliases);
  end if;
  if v_component_digest is null or public.shadow_pg_bundle_v1(v_component,'projection')->>'digest' is distinct from v_component_digest
    then raise exception 'shadow_projection_component_changed'; end if;
  v_digest:=public.shadow_pg_bundle_v1(v_payload,'projection')->>'digest';
  if v_ref->>'payloadDigest' is distinct from v_digest then raise exception 'shadow_projection_payload_digest'; end if;
  return pg_catalog.jsonb_build_object('payload',v_payload,'digest',v_digest);
end $$;
alter function public.shadow_eval_projection_disposition_v1(public.document_index_generations,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_eval_projection_disposition_v1(public.document_index_generations,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_eval_attempt_control_payload_v1(p_member public.document_index_generations,p_declaration jsonb,p_output jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_batch jsonb;v_capture jsonb;v_checkpoint jsonb;v_current jsonb;v_initial_job jsonb;v_current_job jsonb;v_stage jsonb;
  v_receipt jsonb;v_final jsonb;v_terminal jsonb;v_terminal_job jsonb;v_duration numeric;
begin
  v_batch:=public.shadow_inventory_envelope_payload_v1(p_declaration->'outputManifestEnvelope');
  if p_declaration->'artifactGenerationId'<>'null'::jsonb or p_declaration->'producer'->>'name' is distinct from 'local-worker'
    or v_batch->'binding' is distinct from public.shadow_projection_binding_v1(p_member,null)
    or pg_catalog.jsonb_array_length(v_batch->'units')<>1
    or v_batch->'units'->0->>'family'<>'attempt_control'
    or v_batch->'units'->0->>'key' is distinct from p_member.job_id::text
    or v_batch->'units'->0->'output' is distinct from p_output then raise exception 'shadow_control_owner_identity'; end if;
  v_capture:=public.shadow_producer_capture_v1(p_output);v_checkpoint:=v_capture->'input';
  if v_capture->'ownUndefinedPaths'<>'[]'::jsonb
    or not public.shadow_keys_v1(v_checkpoint,array['controlRevision','ownNodeJobs','ownStages'])
    or pg_catalog.jsonb_typeof(v_checkpoint->'controlRevision')<>'number'
    or (v_checkpoint->>'controlRevision')::numeric<>pg_catalog.trunc((v_checkpoint->>'controlRevision')::numeric)
    or (v_checkpoint->>'controlRevision')::numeric not between 1 and 9007199254740991
    or (v_checkpoint->>'controlRevision')::numeric>(p_member.control_revision-1)
    or pg_catalog.jsonb_typeof(v_checkpoint->'ownNodeJobs')<>'array'
    or pg_catalog.jsonb_array_length(v_checkpoint->'ownNodeJobs')<>1
    or v_checkpoint->'ownStages'<>'[]'::jsonb then raise exception 'shadow_control_checkpoint_invalid'; end if;
  if p_member.state is distinct from 'staged' or p_member.staged_at is null
    or p_member.stage_receipt is null or p_member.stage_receipt_digest is null
    or p_member.stage_receipt->>'digest' is distinct from p_member.stage_receipt_digest
    or p_member.stage_receipt->>'domain' is distinct from 'member_receipt'
    or p_member.stage_receipt->>'encoding' is distinct from 'pg-jsonb-text-v1'
    then raise exception 'shadow_control_terminal_member_invalid'; end if;
  v_receipt:=public.shadow_inventory_envelope_payload_v1(p_member.stage_receipt);
  if not public.shadow_keys_v1(v_receipt,array['kind','version','binding','planDigest','preparedOriginDigest',
      'executionProfileDigest','caseSetDigest','expectedStateDigest','baselineBundleDigest','expectedInventoryDigest',
      'finalInventoryEnvelope','candidateProjectionDigest','terminalControlEnvelope','sealedAt','limitations'])
    or v_receipt->>'kind' is distinct from 'u04-member-seal-receipt-v1'
    or v_receipt->'version' is distinct from '1'::jsonb
    or v_receipt->'binding' is distinct from public.shadow_projection_binding_v1(p_member,null)
    or v_receipt->>'expectedStateDigest' is distinct from p_member.expected_state_digest
    or v_receipt->>'baselineBundleDigest' is distinct from p_member.baseline_bundle_digest
    or v_receipt->>'expectedInventoryDigest' is distinct from p_member.expected_inventory_digest
    or v_receipt->>'candidateProjectionDigest' is distinct from p_member.candidate_projection_digest
    or v_receipt->'sealedAt' is distinct from pg_catalog.to_jsonb(p_member.staged_at)
    or v_receipt->'finalInventoryEnvelope'->>'digest' is distinct from p_member.inventory_digest
    or v_receipt->'finalInventoryEnvelope'->>'domain' is distinct from 'inventory'
    or v_receipt->'finalInventoryEnvelope'->>'encoding' is distinct from 'pg-jsonb-text-v1'
    or v_receipt->'terminalControlEnvelope'->>'domain' is distinct from 'control'
    or v_receipt->'terminalControlEnvelope'->>'encoding' is distinct from 'pg-jsonb-text-v1'
    then raise exception 'shadow_control_terminal_receipt_invalid'; end if;
  v_final:=public.shadow_inventory_envelope_payload_v1(v_receipt->'finalInventoryEnvelope');
  if not public.shadow_keys_v1(v_final,array['kind','version','binding','expectedInventoryEnvelope',
      'finalDispositions','projectionEnvelope','preSealControlEnvelope','candidateRows','retainedEvidence'])
    or v_final->>'kind' is distinct from 'u04-final-inventory-v1'
    or v_final->'version' is distinct from '1'::jsonb
    or v_final->'binding' is distinct from public.shadow_projection_binding_v1(p_member,null)
    or v_final->'preSealControlEnvelope'->>'domain' is distinct from 'control'
    or v_final->'preSealControlEnvelope'->>'encoding' is distinct from 'pg-jsonb-text-v1'
    then raise exception 'shadow_control_preseal_envelope_invalid'; end if;
  v_current:=public.shadow_inventory_envelope_payload_v1(v_final->'preSealControlEnvelope');
  v_terminal:=public.shadow_inventory_envelope_payload_v1(v_receipt->'terminalControlEnvelope');
  if not public.shadow_keys_v1(v_current,array['controlRevision','ownNodeJobs','ownStages'])
    or not public.shadow_keys_v1(v_terminal,array['controlRevision','ownNodeJobs','ownStages'])
    or v_current->>'controlRevision' is distinct from (p_member.control_revision-1)::text
    or v_terminal->>'controlRevision' is distinct from p_member.control_revision::text
    or pg_catalog.jsonb_array_length(v_current->'ownNodeJobs')<>1
    or pg_catalog.jsonb_array_length(v_terminal->'ownNodeJobs')<>1
    or v_terminal is distinct from p_member.control_snapshot
    or v_terminal is distinct from public.shadow_control_snapshot_v1(p_member.job_id,p_member.control_revision)
    then raise exception 'shadow_control_current_invalid'; end if;
  v_current_job:=v_current->'ownNodeJobs'->0;v_terminal_job:=v_terminal->'ownNodeJobs'->0;
  if v_current_job->>'id' is distinct from p_member.job_id::text
    or v_current_job->>'document_id' is distinct from p_member.document_id::text
    or v_current_job->>'status' is distinct from 'processing'
    or v_current_job->>'locked_by' is null or pg_catalog.btrim(v_current_job->>'locked_by')=''
    or v_current_job->'completed_at' is distinct from 'null'::jsonb
    or (v_current_job->>'lease_expires_at')::timestamptz<=p_member.staged_at
    or v_terminal_job->>'id' is distinct from p_member.job_id::text
    or v_terminal_job->>'document_id' is distinct from p_member.document_id::text
    or v_terminal_job->>'status' is distinct from 'completed'
    or v_terminal_job->>'stage' is distinct from 'shadow_staged'
    or v_terminal_job->'progress' is distinct from '100'::jsonb
    or v_terminal_job->'locked_by' is distinct from 'null'::jsonb
    or v_terminal_job->'locked_at' is distinct from 'null'::jsonb
    or v_terminal_job->'completed_at' is distinct from pg_catalog.to_jsonb(p_member.staged_at)
    or (v_current_job-array['status','stage','progress','locked_at','locked_by','completed_at','updated_at'])
      is distinct from (v_terminal_job-array['status','stage','progress','locked_at','locked_by','completed_at','updated_at'])
    or v_current->'ownStages' is distinct from v_terminal->'ownStages'
    then raise exception 'shadow_control_terminal_transition_invalid'; end if;
  v_initial_job:=v_checkpoint->'ownNodeJobs'->0;v_current_job:=v_current->'ownNodeJobs'->0;
  v_duration:=(v_initial_job->>'lease_duration_seconds')::numeric;
  if v_initial_job->>'id' is distinct from p_member.job_id::text
    or v_initial_job->>'document_id' is distinct from p_member.document_id::text
    or v_initial_job->>'status'<>'processing' or v_current_job->>'status'<>'processing'
    or v_initial_job->'batch_id'<>'null'::jsonb or v_initial_job->>'operation'<>'shadow_reindex'
    or v_initial_job->'attempt_count'<>'1'::jsonb or v_initial_job->'max_attempts'<>'1'::jsonb
    or v_initial_job->>'requested_generation_id' is distinct from p_member.index_generation_id::text
    or v_initial_job->>'shadow_plan_digest' is distinct from v_current_job->>'shadow_plan_digest'
    or v_initial_job->>'lease_token' is distinct from p_member.first_lease_token::text
    or v_initial_job->'lease_expected_generation_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.baseline_generation_id),'null'::jsonb)
    or v_initial_job->>'lease_write_generation_id' is distinct from p_member.index_generation_id::text
    or v_initial_job->>'lease_authority_digest' is distinct from p_member.authority_digest
    or pg_catalog.jsonb_typeof(v_initial_job->'locked_by')<>'string' or pg_catalog.length(v_initial_job->>'locked_by')=0
    or v_initial_job->'locked_by' is distinct from v_current_job->'locked_by'
    or v_duration<>pg_catalog.trunc(v_duration) or v_duration not between 60 and 86400
    or v_initial_job->'lease_duration_seconds' is distinct from v_current_job->'lease_duration_seconds'
    or (v_initial_job-array['stage','progress','locked_at','lease_expires_at','updated_at'])
      is distinct from (v_current_job-array['stage','progress','locked_at','lease_expires_at','updated_at'])
    then raise exception 'shadow_control_owner_changed'; end if;
  perform public.shadow_audit_timestamp_v1(v_initial_job->'locked_at');
  perform public.shadow_audit_timestamp_v1(v_initial_job->'lease_expires_at');
  for v_stage in select value from pg_catalog.jsonb_array_elements(v_current->'ownStages') loop
    if v_stage->>'job_id' is distinct from p_member.job_id::text
      or v_stage->>'document_id' is distinct from p_member.document_id::text
      or v_stage->>'job_kind'<>'node'
      or v_stage->>'lease_token' is distinct from p_member.first_lease_token::text
      or v_stage->'index_generation_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.baseline_generation_id),'null'::jsonb)
      then raise exception 'shadow_control_stage_scope'; end if;
  end loop;
  return v_capture;
exception when others then raise exception 'invalid_shadow_attempt_control' using errcode='22023';
end $$;
alter function public.shadow_eval_attempt_control_payload_v1(public.document_index_generations,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_eval_attempt_control_payload_v1(public.document_index_generations,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_eval_reconcile_final_disposition_v1(p_member public.document_index_generations,p_manifest jsonb,p_outcome jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_unit public.document_generation_inventory%rowtype;v_declaration jsonb;v_batch jsonb;v_planned jsonb;v_ref jsonb;v_payload jsonb;v_raw jsonb;v_native jsonb;
  v_table text;v_family text;v_group text;v_row jsonb;v_digest text;v_bytes bytea;v_reason text;v_count integer;v_d uuid;v_key text;v_page_input jsonb;v_limitation jsonb;v_pointer jsonb;
begin
  select * into v_unit from public.document_generation_inventory where document_id=p_member.document_id and index_generation_id=p_member.index_generation_id
    and family=p_outcome->>'family' and unit_key=p_outcome->>'unitKey';
  if not found or public.shadow_inventory_outcome_v1(v_unit) is distinct from p_outcome then raise exception 'shadow_disposition_unit_required'; end if;
  select s->'declaration',s->>'groupKey' into v_declaration,v_group from pg_catalog.jsonb_array_elements(p_manifest->'families') f cross join lateral pg_catalog.jsonb_array_elements(f->'groups') s
    where f->>'family'=p_outcome->>'family' and s->>'state'='declared' and s->'declaration'->'population'->>'tag'='known'
      and s->'declaration'->'population'->'expectedUnits' @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('family',p_outcome->'family','key',p_outcome->'unitKey'));
  if not found then raise exception 'shadow_disposition_declaration_required'; end if;
  v_batch:=public.shadow_inventory_envelope_payload_v1(v_declaration->'outputManifestEnvelope');
  select value->'output' into v_planned from pg_catalog.jsonb_array_elements(v_batch->'units') where value->'family'=p_outcome->'family' and value->'key'=p_outcome->'unitKey';
  if not found then raise exception 'shadow_planned_output_required'; end if;
  for v_limitation in select value from pg_catalog.jsonb_array_elements(p_outcome->'limitations') loop
    for v_pointer in select value from pg_catalog.jsonb_array_elements(v_limitation->'evidence') loop
      perform public.shadow_resolve_batch_pointer_v1(v_pointer,v_declaration->'outputManifestEnvelope');
    end loop;
  end loop;
  if p_outcome->>'disposition'<>'retained' then
    if p_outcome->>'family'='cache_inputs' and v_unit.required then raise exception 'shadow_required_cache_input_not_retained'; end if;
    if p_outcome->>'family' in ('attempt_control','repair_audit_inputs') and v_unit.required then raise exception 'shadow_required_retained_input_not_retained'; end if;
    v_reason:=p_outcome->>'reasonCode';
    if (p_outcome->>'disposition'='failed' and v_reason='producer_failed'
      or p_outcome->>'disposition'='skipped' and v_reason in ('producer_skipped','producer_unavailable')
      or p_outcome->>'disposition'='excluded' and v_reason='policy_excluded') is not true
      or pg_catalog.jsonb_array_length(p_outcome->'limitations')=0 or not exists(select 1 from pg_catalog.jsonb_array_elements(p_outcome->'limitations') l
        where l->>'code'=v_reason and l->'scope'->>'key' in (p_outcome->>'unitKey','*')) then raise exception 'invalid_shadow_nonretained_disposition'; end if;
    -- This writer's known planned units contain actual output. A failed write
    -- cannot discard those bytes: retain the complete original producer value.
    if p_outcome->'artifactRef' is distinct from 'null'::jsonb or p_outcome->'contentDigest' is distinct from 'null'::jsonb
      or pg_catalog.jsonb_typeof(p_outcome->'retainedNativePayload') is distinct from 'string'
      or public.shadow_node_value_text_v1(v_planned) is distinct from p_outcome->>'retainedNativePayload' then raise exception 'shadow_partial_evidence_required'; end if;
    -- Preserve the complete captured value above; inspect only its validated
    -- native RPC input for source fields after a failed core write.
    v_payload:=case
      when p_outcome->>'family'='pages' then public.shadow_page_producer_input_v1(v_planned,p_member.document_id)
      when v_declaration->'artifactGenerationId'='null'::jsonb and p_outcome->>'family' in ('chunks','images','table_facts','embedding_fields','index_units')
        then public.shadow_native_rpc_input_v1(v_planned)
      else v_planned end;
    perform public.shadow_validate_inventory_relationships_v1(p_member,p_manifest,p_outcome,v_payload);
    return;
  end if;
  if p_outcome->'reasonCode' is distinct from 'null'::jsonb or p_outcome->'artifactRef'='null'::jsonb then raise exception 'invalid_shadow_retained_disposition'; end if;
  v_ref:=p_outcome->'artifactRef';v_d:=(v_declaration->>'artifactGenerationId')::uuid;
  if v_ref->>'tag'='candidate_row' then
    v_table:=case v_ref->>'owner' when 'page' then 'document_pages' when 'chunk' then 'document_chunks' when 'image' then 'document_images'
      when 'table_fact' then 'document_table_facts' when 'embedding_field' then 'document_embedding_fields' when 'index_unit' then 'document_index_units'
      when 'section' then 'document_sections' when 'memory_card' then 'document_memory_cards' end;
    v_family:=case v_ref->>'owner' when 'page' then 'pages' when 'chunk' then 'chunks' when 'image' then 'images' when 'table_fact' then 'table_facts'
      when 'embedding_field' then 'embedding_fields' when 'index_unit' then 'index_units' when 'section' then 'sections' when 'memory_card' then 'memory_cards' end;
    if v_family is distinct from p_outcome->>'family' then raise exception 'shadow_reference_family'; end if;
    select row_payload into v_row from public.shadow_capture_rows_v1(array[p_member.document_id],array[]::uuid[]) where table_name=v_table and row_payload->'id'=v_ref->'rowId';
    if not found or v_row->>'document_id' is distinct from p_member.document_id::text
      or (v_row ? 'owner_id' and v_row->'owner_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.owner_id),'null'::jsonb))
      or v_row->'metadata'->>'ingestion_lease_token' is distinct from p_member.first_lease_token::text
      or (case when v_family='pages' then v_row->>'page_number'
        when v_d is not null then public.shadow_deep_row_key_v1(p_member,v_family,v_row)
        else v_row->>'id' end) is distinct from p_outcome->>'unitKey'
      then raise exception 'shadow_candidate_reference_identity'; end if;
    if v_d is null then
      if v_row->>'index_generation_id' is distinct from p_member.index_generation_id::text then raise exception 'shadow_candidate_generation'; end if;
    elsif v_d in (p_member.index_generation_id,p_member.baseline_generation_id) or v_row->>'producer' is distinct from 'local-worker'
      or v_row->>'artifact_generation_id' is distinct from v_d::text or v_row->'metadata'->>'artifact_generation_id' is distinct from v_d::text
      or v_row->>'index_generation_id' is distinct from p_member.index_generation_id::text
      or v_row->'metadata'->>'index_generation_id' is distinct from p_member.index_generation_id::text
      then raise exception 'shadow_candidate_generation'; end if;
    v_digest:=public.shadow_capture_envelope_v1(v_row)->>'digest';
    if v_ref->>'rowDigest' is distinct from v_digest then raise exception 'shadow_candidate_reference_digest'; end if;
    if pg_catalog.jsonb_typeof(p_outcome->'retainedNativePayload') is distinct from 'string' then raise exception 'shadow_original_unit_required'; end if;
    perform public.shadow_strict_original_json_v1((p_outcome->>'retainedNativePayload')::json);
    v_raw:=(p_outcome->>'retainedNativePayload')::jsonb;v_native:=public.shadow_inventory_envelope_payload_v1(v_raw);
    if v_native is distinct from v_planned then raise exception 'shadow_original_unit_changed'; end if;
    -- Native declarations precede generated IDs/times and fixed writer stamps.
    -- Match through the same typed writer contracts; never rewrite the retained
    -- original output to resemble the final server row.
    if v_d is not null then
      if public.shadow_deep_row_matches_v1(p_member,v_family,p_outcome->>'unitKey',v_row) is not true
        then raise exception 'shadow_original_deep_mismatch'; end if;
    elsif v_family='pages' then
      v_page_input:=public.shadow_page_producer_input_v1(v_native,p_member.document_id);
      if v_page_input->>'page_number' is distinct from p_outcome->>'unitKey'
        or v_row->'text' is distinct from v_page_input->'text' or v_row->'ocr_used' is distinct from v_page_input->'ocr_used'
        or v_row->'metadata' is distinct from v_page_input->'metadata'||pg_catalog.jsonb_build_object('index_generation_id',p_member.index_generation_id,'ingestion_job_kind','node','ingestion_job_id',p_member.job_id,'ingestion_lease_token',p_member.first_lease_token)
        or pg_catalog.jsonb_typeof(v_row->'id') is distinct from 'string' or (v_row->>'id')::uuid is null
        or public.shadow_audit_timestamp_v1(v_row->'created_at') is null then raise exception 'shadow_original_page_mismatch'; end if;
      -- rowDigest above binds the complete actual server id/time/row. Neither
      -- is invented in the pre-write native producer output or excluded from it.
    elsif public.shadow_core_row_matches_v1(p_member,v_family,v_native,v_row) is not true
      then raise exception 'shadow_original_candidate_mismatch'; end if;
    v_payload:=v_row;
  elsif v_ref->>'tag'='candidate_projection' then
    v_raw:=public.shadow_eval_projection_disposition_v1(p_member,v_declaration,p_outcome);
    v_payload:=v_raw->'payload';v_digest:=v_raw->>'digest';
  elsif v_ref->>'tag'='retained_payload' then
    v_raw:=v_planned;v_payload:=public.shadow_inventory_envelope_payload_v1(v_raw);v_digest:=v_raw->>'digest';
    if v_ref->>'envelopeDigest' is distinct from v_digest or (v_ref->>'byteLength')::bigint<>pg_catalog.octet_length(pg_catalog.convert_to(v_raw->>'canonicalPayload','UTF8')) then raise exception 'shadow_retained_payload_identity'; end if;
    if v_ref->>'representation'='producer_text' then
      if pg_catalog.jsonb_typeof(v_payload) is distinct from 'string' or p_outcome->>'retainedEvidenceText' is distinct from v_payload#>>'{}' then raise exception 'shadow_retained_text_identity'; end if;
    elsif v_ref->>'representation'='producer_bytes' then
      if pg_catalog.jsonb_typeof(v_payload) is distinct from 'string' then raise exception 'shadow_retained_bytes_identity'; end if;
      v_bytes:=pg_catalog.decode(v_payload#>>'{}','base64');
      if pg_catalog.replace(pg_catalog.encode(v_bytes,'base64'),E'\n','') is distinct from v_payload#>>'{}' or p_outcome->>'retainedNativePayload' is distinct from v_payload#>>'{}' then raise exception 'shadow_retained_bytes_identity'; end if;
    elsif p_outcome->>'retainedNativePayload' is distinct from v_raw->>'canonicalPayload' then raise exception 'shadow_retained_payload_identity'; end if;
    if p_outcome->>'family' in ('native_structure','cache_inputs') or p_outcome->>'family' in ('attempt_control','repair_audit_inputs') then
      if p_outcome->'retainedEvidenceText'<>'null'::jsonb or p_outcome->'representationVersion'<>'null'::jsonb or p_outcome->'transformVersion'<>'null'::jsonb
        or v_ref->>'mediaType'<>'application/json' or (p_outcome->>'family'='native_structure' and (v_group<>'worker_native' or p_outcome->>'unitKey'<>'extracted-document' or v_ref->>'representation'<>'producer_json'))
        or (p_outcome->>'family'='cache_inputs' and (v_group<>'cache' or v_ref->>'representation'<>'cache_input'))
        or (p_outcome->>'family'='attempt_control' and (v_group<>'control' or p_outcome->>'unitKey' is distinct from p_member.job_id::text or v_ref->>'representation'<>'control_checkpoint'))
        or (p_outcome->>'family'='repair_audit_inputs' and (v_group<>'repair' or p_outcome->>'unitKey'<>'enrichment-repair' or v_ref->>'representation'<>'repair_audit_input'))
        or v_unit.lease_token is distinct from p_member.first_lease_token or v_unit.artifact_generation_id is not null or v_unit.producer is distinct from 'local-worker'
        or v_unit.source_binding is distinct from public.shadow_projection_binding_v1(p_member,null) then raise exception 'shadow_retained_owner_identity'; end if;
      v_payload:=case when p_outcome->>'family'='native_structure'
        then public.shadow_native_structure_payload_v1(p_member,p_manifest,v_declaration,v_planned)
        when p_outcome->>'family'='cache_inputs'
        then public.shadow_cache_input_payload_v1(p_member,p_manifest,v_declaration,p_outcome->>'unitKey',v_planned)
        when p_outcome->>'family'='attempt_control'
        then public.shadow_eval_attempt_control_payload_v1(p_member,v_declaration,v_planned)
        else public.shadow_repair_audit_payload_v1(p_member,v_declaration,v_planned) end;
    end if;
  elsif v_ref->>'tag'='private_object' then
    if p_outcome->>'family'<>'private_objects' or not public.shadow_keys_v1(v_planned,array['tag','ref','bytes']) or v_planned->>'tag' is distinct from 'private_object'
      or v_planned->'ref' is distinct from v_ref or not public.shadow_keys_v1(v_planned->'bytes',array['encoding','content'])
      or v_planned->'bytes'->>'encoding' is distinct from 'base64' or p_outcome->>'retainedNativePayload' is distinct from v_planned->'bytes'->>'content' then raise exception 'shadow_object_evidence_required'; end if;
    v_bytes:=pg_catalog.decode(p_outcome->>'retainedNativePayload','base64');v_digest:='sha256:'||pg_catalog.encode(extensions.digest(v_bytes,'sha256'),'hex');
    if pg_catalog.replace(pg_catalog.encode(v_bytes,'base64'),E'\n','') is distinct from p_outcome->>'retainedNativePayload'
      or v_digest is distinct from v_ref->>'sha256' or pg_catalog.octet_length(v_bytes)::bigint<>(v_ref->>'byteLength')::bigint
      or p_outcome->>'unitKey' is distinct from 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(public.shadow_node_value_text_v1(v_ref),'UTF8'),'sha256'),'hex') then raise exception 'shadow_object_identity'; end if;
    v_row:=public.shadow_candidate_image_attachment_v1(p_member,v_ref);v_payload:=v_planned;
  else raise exception 'shadow_reference_semantics_unavailable'; end if;
  if p_outcome->>'contentDigest' is distinct from v_digest then raise exception 'shadow_content_digest_mismatch'; end if;
  perform public.shadow_validate_inventory_relationships_v1(p_member,p_manifest,p_outcome,v_payload);
end $$;
alter function public.shadow_eval_reconcile_final_disposition_v1(public.document_index_generations,jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_eval_reconcile_final_disposition_v1(public.document_index_generations,jsonb,jsonb) from public,anon,authenticated,service_role;


-- One mandatory, read-only statement-snapshot admission for all fixed readers.
-- Supplied authority bytes are immutable identity. Independent controller admission
-- remains a required client-side input and is not manufactured by this function.
create or replace function public.shadow_eval_guard_v1(p_context jsonb,p_operation text,p_arguments jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_operations constant jsonb:='["adjacent_chunks","aliases","chunks_by_ids","chunks_by_indexes","corpus_terms","correct_terms","documents","embedding_fields","hybrid_chunks","images_by_ids","images_by_pages","index_units","lookup_chunk_prefix","lookup_chunk_terms","lookup_chunks","lookup_document_terms","lookup_documents","memory_cards_hybrid","memory_cards_lexical","quality","ranking_metadata","related_documents","table_facts","text_chunks","vector_chunks","visual_rows"]'::jsonb;
  v_settings constant text[]:=array['TimeZone','default_text_search_config','search_path','statement_timeout','lock_timeout','pg_trgm.similarity_threshold','hnsw.ef_search'];
  v_context jsonb;v_request jsonb;v_authority jsonb;v_manifest jsonb;v_phase jsonb;v_call jsonb;
  v_origin jsonb;v_profile jsonb;v_cases jsonb;v_config jsonb;v_recovery jsonb;
  v_environment jsonb;v_capture jsonb;v_review jsonb;v_operation jsonb;v_observed_operation jsonb;
  v_observed_settings jsonb:='[]'::jsonb;v_setting jsonb;v_setting_name text;v_setting_value text;
  v_w uuid[];v_m uuid[];v_jobs uuid[];v_call_ids uuid[];v_observed_envelope jsonb;v_observed jsonb;
  v_supplied_observed jsonb;v_scope jsonb;v_case jsonb;v_source jsonb;v_locked jsonb;v_expected_source jsonb;
  v_prior text;v_doc uuid;v_index integer:=0;v_expected_case_count integer;v_scope_count integer;
  v_now timestamptz:=pg_catalog.statement_timestamp();v_authorized timestamptz;v_expires timestamptz;
  v_confirmation_payload jsonb;v_confirmation_text text;v_confirmation text;
  v_side text;v_candidate uuid;v_plan_envelope jsonb;v_plan_payload jsonb;v_plan jsonb;v_plan_input jsonb;
  v_readback jsonb;v_wave_receipt_envelope jsonb;v_wave_receipt jsonb;v_wave public.shadow_reindex_waves%rowtype;
  v_member_entry jsonb;v_receipt_envelope jsonb;v_receipt jsonb;v_final jsonb;v_expected_inventory jsonb;
  v_member public.document_index_generations%rowtype;v_job public.ingestion_jobs%rowtype;
  v_projection public.document_generation_projections%rowtype;v_baseline public.document_generation_baselines%rowtype;
  v_unit public.document_generation_inventory%rowtype;v_declarations jsonb;v_dispositions jsonb;
  v_expected_count bigint;v_actual_count bigint;v_controls jsonb:='[]'::jsonb;
  v_current_members jsonb;v_current_documents jsonb;v_current_baselines jsonb;v_max_sealed timestamptz;
  v_current_wave_receipt jsonb;v_preseal jsonb;v_terminal jsonb;v_limitations jsonb;
  v_id jsonb;v_match_count bigint:=0;
begin
  if not public.shadow_keys_v1(p_context,array['version','kind','requestEnvelope','authorityEnvelope',
      'originalOriginEnvelope','recoveryEnvelope','evidence','call'])
    or p_context->'version' is distinct from '1'::jsonb
    or p_context->>'kind' is distinct from 'u04-evaluation-sql-context-v1'
    or pg_catalog.jsonb_typeof(p_arguments) is distinct from 'object'
    or not exists(select 1 from pg_catalog.jsonb_array_elements_text(v_operations) x where x=p_operation)
    then raise exception 'shadow_eval_context'; end if;
  v_context:=p_context;v_call:=v_context->'call';
  if not public.shadow_keys_v1(v_call,array['operation','case','readOrdinal','documentIds','originalArguments'])
    or v_call->>'operation' is distinct from p_operation
    or pg_catalog.jsonb_typeof(v_call->'readOrdinal') is distinct from 'number'
    or v_call->>'readOrdinal' !~ '^(0|[1-9][0-9]*)$'
    or (v_call->>'readOrdinal')::numeric>9007199254740991
    or pg_catalog.jsonb_typeof(v_call->'documentIds') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_call->'originalArguments') is distinct from 'object'
    then raise exception 'shadow_eval_call'; end if;
  if p_operation in ('hybrid_chunks','vector_chunks','embedding_fields','index_units','memory_cards_hybrid') then
    if (v_call->'originalArguments'-'query_embedding') is distinct from (p_arguments-'query_embedding')
      or pg_catalog.jsonb_typeof(v_call->'originalArguments'->'query_embedding') is distinct from 'string'
      or pg_catalog.jsonb_typeof(p_arguments->'query_embedding') is distinct from 'string'
      or (v_call->'originalArguments'->>'query_embedding')::extensions.vector(1536)
         is distinct from (p_arguments->>'query_embedding')::extensions.vector(1536)
      then raise exception 'shadow_eval_arguments'; end if;
  elsif v_call->'originalArguments' is distinct from p_arguments then
    raise exception 'shadow_eval_arguments';
  end if;

  v_request:=public.shadow_node_payload_v1(v_context->'requestEnvelope','u04-evaluation-request-v1');
  v_authority:=public.shadow_node_payload_v1(v_context->'authorityEnvelope','plan');
  if not public.shadow_keys_v1(v_request,array['kind','version','sessionId','authorityEnvelopeDigest',
      'executionProfileDigest','originalOriginDigest','caseSetDigest','configurationDigest',
      'sourceBindings','caseScopes','phase','comparisonClock','requiredSqlOperations'])
    or v_request->>'kind' is distinct from 'u04-evaluation-request-v1' or v_request->'version' is distinct from '1'::jsonb
    or v_request->>'sessionId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or v_request->'requiredSqlOperations' is distinct from v_operations
    or not public.shadow_keys_v1(v_authority,array['kind','version','manifest','phase','executionProfileDigest',
      'originalOriginDigest','caseScopes','runnerPolicy','recoveryEnvelopeDigest'])
    or v_authority->>'kind' is distinct from 'u04-evaluation-authority-v1' or v_authority->'version' is distinct from '1'::jsonb
    then raise exception 'shadow_eval_identity'; end if;
  v_manifest:=v_authority->'manifest';v_phase:=v_authority->'phase';
  if not public.shadow_keys_v1(v_manifest,array['version','operation','targetProjectRef','planPath','reportOrReceiptPath',
      'recoveryEvidencePath','recoveryEvidenceSha256','expectedDocumentIds','expectedDocumentCount',
      'confirmationSha256','authorizedAt','expiresAt'])
    or v_manifest->'version' is distinct from '1'::jsonb or v_manifest->>'operation' is distinct from 'evaluate'
    or v_manifest->>'targetProjectRef' is distinct from 'sjrfecxgysukkwxsowpy'
    or pg_catalog.jsonb_typeof(v_manifest->'recoveryEvidencePath') is distinct from 'string'
    or pg_catalog.length(v_manifest->>'recoveryEvidencePath')=0
    or v_manifest->>'recoveryEvidenceSha256' !~ '^sha256:[0-9a-f]{64}$'
    or v_manifest->>'confirmationSha256' !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(v_manifest->'expectedDocumentIds') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_manifest->'expectedDocumentCount') is distinct from 'number'
    or v_manifest->>'expectedDocumentCount' !~ '^[1-9][0-9]*$'
    then raise exception 'shadow_eval_manifest'; end if;
  v_authorized:=public.shadow_audit_timestamp_v1(v_manifest->'authorizedAt');
  v_expires:=public.shadow_audit_timestamp_v1(v_manifest->'expiresAt');
  if v_authorized is null or v_expires is null or v_authorized>v_now or v_now>=v_expires or v_expires<=v_authorized
    then raise exception 'shadow_eval_expired'; end if;
  v_confirmation_payload:=pg_catalog.jsonb_set(v_authority,'{manifest}',v_manifest-'confirmationSha256',false);
  v_confirmation_text:=public.shadow_node_value_text_v1(v_confirmation_payload);
  v_confirmation:='sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_confirmation_text,'UTF8'),'sha256'),'hex');
  if v_confirmation is distinct from v_manifest->>'confirmationSha256' then raise exception 'shadow_eval_confirmation'; end if;

  if not public.shadow_keys_v1(v_authority->'runnerPolicy',array['kind','version','workload','retrievalConcurrency',
      'qualityConcurrency','evaluatorRetry','costRates','runContext','crossRegionRunner'])
    or v_authority->'runnerPolicy'->>'kind' is distinct from 'u04-evaluation-runner-policy-v1'
    or v_authority->'runnerPolicy'->'version' is distinct from '1'::jsonb
    or v_authority->'runnerPolicy'->>'workload' is distinct from 'eval-quality-retrieval-and-rag-v1'
    or v_authority->'runnerPolicy'->'retrievalConcurrency' is distinct from '1'::jsonb
    or v_authority->'runnerPolicy'->'qualityConcurrency' is distinct from '1'::jsonb
    or not public.shadow_keys_v1(v_authority->'runnerPolicy'->'evaluatorRetry',
      array['maxAttempts','initialDelayMs','maxDelayMs'])
    or exists(select 1 from pg_catalog.jsonb_each(v_authority->'runnerPolicy'->'evaluatorRetry') e
      where pg_catalog.jsonb_typeof(e.value) is distinct from 'number' or e.value::text !~ '^[1-9][0-9]*$'
        or e.value::text::numeric>9007199254740991)
    or (v_authority->'runnerPolicy'->'costRates'<>'null'::jsonb and
      (not public.shadow_keys_v1(v_authority->'runnerPolicy'->'costRates',array['input','cachedInput','output'])
       or exists(select 1 from pg_catalog.jsonb_each(v_authority->'runnerPolicy'->'costRates') e
         where pg_catalog.jsonb_typeof(e.value) is distinct from 'number')))
    or not public.shadow_keys_v1(v_authority->'runnerPolicy'->'runContext',
      array['git_sha','github_run_id','github_run_attempt','latency_context'])
    or exists(select 1 from pg_catalog.jsonb_each(v_authority->'runnerPolicy'->'runContext') e
      where (e.key='latency_context' and pg_catalog.jsonb_typeof(e.value) is distinct from 'string')
         or (e.key<>'latency_context' and e.value<>'null'::jsonb and pg_catalog.jsonb_typeof(e.value) is distinct from 'string'))
    or pg_catalog.jsonb_typeof(v_authority->'runnerPolicy'->'crossRegionRunner') is distinct from 'boolean'
    then raise exception 'shadow_eval_runner_policy'; end if;


  if not public.shadow_generation_envelope_valid(v_context->'originalOriginEnvelope','baseline','pg-jsonb-text-v1')
    then raise exception 'shadow_eval_origin'; end if;
  v_origin:=(v_context->'originalOriginEnvelope'->>'canonicalPayload')::jsonb;
  if v_origin::text is distinct from v_context->'originalOriginEnvelope'->>'canonicalPayload'
    or not public.shadow_keys_v1(v_origin,array['kind','evidenceMode','capturedAt','executionProfileEnvelope',
      'documentIds','manualAliasIds','sourcePolicyVersion','rows'])
    or v_origin->>'kind' is distinct from 'u04-origin-snapshot-v1'
    or public.shadow_audit_timestamp_v1(v_origin->'capturedAt')>v_authorized
    then raise exception 'shadow_eval_origin'; end if;
  v_profile:=public.shadow_profile_capture_v1(v_origin->'executionProfileEnvelope');
  if v_profile->'target'->>'projectRef' is distinct from v_manifest->>'targetProjectRef'
    or v_origin->'documentIds' is distinct from v_profile->'documentIds'
    or v_origin->'manualAliasIds' is distinct from v_profile->'manualAliasIds'
    or v_origin->'sourcePolicyVersion' is distinct from v_profile->'sourcePolicyVersion'
    or v_origin->'evidenceMode' is distinct from v_profile->'evidenceMode'
    or v_context->'originalOriginEnvelope'->>'digest' is distinct from v_authority->>'originalOriginDigest'
    or v_origin->'executionProfileEnvelope'->>'digest' is distinct from v_authority->>'executionProfileDigest'
    or v_manifest->'expectedDocumentIds' is distinct from v_profile->'documentIds'
    or (v_manifest->>'expectedDocumentCount')::integer<>pg_catalog.jsonb_array_length(v_profile->'documentIds')
    or v_request->>'authorityEnvelopeDigest' is distinct from v_context->'authorityEnvelope'->>'digest'
    or v_request->'executionProfileDigest' is distinct from v_authority->'executionProfileDigest'
    or v_request->'originalOriginDigest' is distinct from v_authority->'originalOriginDigest'
    or v_request->'comparisonClock' is distinct from v_profile->'comparisonClock'
    then raise exception 'shadow_eval_profile_binding'; end if;
  select pg_catalog.array_agg(value::uuid order by ord) into v_w
    from pg_catalog.jsonb_array_elements_text(v_profile->'documentIds') with ordinality a(value,ord);
  select coalesce(pg_catalog.array_agg(value::uuid order by ord),array[]::uuid[]) into v_m
    from pg_catalog.jsonb_array_elements_text(v_profile->'manualAliasIds') with ordinality a(value,ord);

  if not public.shadow_keys_v1(v_profile->'configuration',array['version','domain','encoding','canonicalPayload','digest'])
    or not public.shadow_keys_v1(v_profile->'cases',array['version','domain','encoding','canonicalPayload','digest'])
    or not public.shadow_keys_v1(v_profile->'sql',array['environment'])
    then raise exception 'shadow_eval_profile_sections'; end if;
  v_config:=public.shadow_node_payload_v1(v_profile->'configuration','u04-engine-config-v1');
  v_cases:=public.shadow_node_payload_v1(v_profile->'cases','u04-evaluation-cases-v1');
  if not public.shadow_keys_v1(v_config,array['kind','generation','ranking','gate'])
    or v_config->>'kind' is distinct from 'u04-comparison-config-v1'
    or not public.shadow_keys_v1(v_cases,array['kind','providerMode','globalForceEmbedding','preparation','selection','retrieval','quality'])
    or v_cases->>'kind' is distinct from 'u04-comparison-cases-v1'
    or v_cases->'providerMode' is distinct from v_profile->'providerMode'
    or pg_catalog.jsonb_typeof(v_cases->'globalForceEmbedding') is distinct from 'boolean'
    or v_request->>'configurationDigest' is distinct from v_profile->'configuration'->>'digest'
    or v_request->>'caseSetDigest' is distinct from v_profile->'cases'->>'digest'
    or v_authority->'caseScopes'->>'caseSetDigest' is distinct from v_profile->'cases'->>'digest'
    or v_request->'caseScopes' is distinct from v_authority->'caseScopes'
    then raise exception 'shadow_eval_case_binding'; end if;
  if not public.shadow_keys_v1(v_authority->'caseScopes',array['caseSetDigest','scopes'])
    or pg_catalog.jsonb_typeof(v_authority->'caseScopes'->'scopes') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_cases->'retrieval') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_cases->'quality') is distinct from 'array'
    or not public.shadow_keys_v1(v_cases->'preparation',array['optionalUndefined'])
    or pg_catalog.jsonb_typeof(v_cases->'preparation'->'optionalUndefined') is distinct from 'array'
    or not public.shadow_keys_v1(v_cases->'selection',array['retrieval','quality'])
    or pg_catalog.jsonb_typeof(v_cases->'selection'->'retrieval') is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_cases->'selection'->'quality') is distinct from 'object'
    then raise exception 'shadow_eval_cases'; end if;
  v_expected_case_count:=pg_catalog.jsonb_array_length(v_cases->'retrieval')+pg_catalog.jsonb_array_length(v_cases->'quality');
  v_scope_count:=pg_catalog.jsonb_array_length(v_authority->'caseScopes'->'scopes');
  if v_scope_count<>v_expected_case_count then raise exception 'shadow_eval_case_population'; end if;
  v_index:=0;v_prior:=null;
  for v_scope in select value from pg_catalog.jsonb_array_elements(v_authority->'caseScopes'->'scopes') loop
    if not public.shadow_keys_v1(v_scope,array['case','documentIds'])
      or not public.shadow_keys_v1(v_scope->'case',array['kind','index','caseId'])
      or pg_catalog.jsonb_typeof(v_scope->'documentIds') is distinct from 'array'
      or v_scope->'case'->>'kind' not in ('retrieval','quality')
      or v_scope->'case'->>'index' !~ '^(0|[1-9][0-9]*)$'
      then raise exception 'shadow_eval_case_scope'; end if;
    if v_index<pg_catalog.jsonb_array_length(v_cases->'retrieval') then
      v_case:=v_cases->'retrieval'->v_index;
      if not public.shadow_keys_v1(v_case,array['testCase','retrievalLimit','effectiveForceEmbedding'])
        or not (v_case->'testCase' ?& array['id','query','expectedQueryClass','expectedDocumentSubstrings',
          'expectedContentTerms','topK','expectTableEvidence'])
        or v_case->'testCase'-array['id','query','expectedQueryClass','expectedDocumentSubstrings',
          'expectedContentTerms','topK','expectTableEvidence','forceEmbedding']<>'{}'::jsonb
        or v_scope->'case'->>'kind'<>'retrieval' or (v_scope->'case'->>'index')::integer<>v_index
        or v_scope->'case'->>'caseId' is distinct from v_case->'testCase'->>'id'
        then raise exception 'shadow_eval_case_scope'; end if;
    else
      v_case:=v_cases->'quality'->(v_index-pg_catalog.jsonb_array_length(v_cases->'retrieval'));
      if not (v_case ?& array['id','question','category','supported','expectedFiles','allowedRoutes','minCitations','latencyTargetMs'])
        or v_case-array['id','question','category','supported','expectedFiles','allowedRoutes','minCitations','latencyTargetMs',
          'suite','relevanceGrade','expectedQueryClass','falsePositiveControl','requireExpectedFileCitation',
          'requiredDirectClaim','requireVisualEvidence','expectsSourceDangerWarning','acceptSourceOnly','programmeExpectation']<>'{}'::jsonb
        or v_scope->'case'->>'kind'<>'quality'
        or (v_scope->'case'->>'index')::integer<>v_index-pg_catalog.jsonb_array_length(v_cases->'retrieval')
        or v_scope->'case'->>'caseId' is distinct from v_case->>'id'
        then raise exception 'shadow_eval_case_scope'; end if;
    end if;
    v_prior:=null;
    for v_id in select value from pg_catalog.jsonb_array_elements(v_scope->'documentIds') loop
      if pg_catalog.jsonb_typeof(v_id) is distinct from 'string'
        or v_id#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (v_prior is not null and v_id#>>'{}' collate "C"<=v_prior collate "C")
        or not (v_profile->'documentIds' @> pg_catalog.jsonb_build_array(v_id))
        then raise exception 'shadow_eval_case_scope'; end if;
      v_prior:=v_id#>>'{}';
    end loop;
    if v_scope->'case' is not distinct from v_call->'case' then
      if v_scope->'documentIds' is distinct from v_call->'documentIds' then raise exception 'shadow_eval_call_scope'; end if;
      v_match_count:=v_match_count+1;
    end if;
    v_index:=v_index+1;
  end loop;
  if v_match_count<>1 then raise exception 'shadow_eval_call_scope'; end if;

  if pg_catalog.jsonb_typeof(v_request->'sourceBindings') is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_request->'sourceBindings')<>pg_catalog.cardinality(v_w)
    then raise exception 'shadow_eval_source_population'; end if;
  v_index:=0;
  for v_source in select value from pg_catalog.jsonb_array_elements(v_request->'sourceBindings') loop
    v_doc:=v_w[v_index+1];
    if not public.shadow_keys_v1(v_source,array['version','originDigest','executionProfileDigest','documentId','ownerId',
        'contentHash','authorityDigest','sourcePolicyVersion','manualAliasIds','baselineGenerationId','source'])
      or v_source->'version' is distinct from '1'::jsonb
      or v_source->>'documentId' is distinct from v_doc::text
      or v_source->'originDigest' is distinct from v_context->'originalOriginEnvelope'->'digest'
      or v_source->'executionProfileDigest' is distinct from v_origin->'executionProfileEnvelope'->'digest'
      or v_source->'manualAliasIds' is distinct from v_profile->'manualAliasIds'
      or v_source->'sourcePolicyVersion' is distinct from v_profile->'sourcePolicyVersion'
      or v_source->>'contentHash' !~ '^sha256:[0-9a-f]{64}$'
      or v_source->>'authorityDigest' !~ '^sha256:[0-9a-f]{64}$'
      then raise exception 'shadow_eval_source_binding'; end if;
    v_locked:=public.read_shadow_document_authority_v1(v_doc);
    if v_locked is null or v_locked->'document'->'owner_id' is distinct from v_source->'ownerId'
      or v_locked->'document'->'content_hash' is distinct from v_source->'contentHash'
      or v_locked->'document'->'index_generation_id' is distinct from v_source->'baselineGenerationId'
      or v_locked->>'authority_digest' is distinct from v_source->>'authorityDigest'
      then raise exception 'shadow_eval_source_changed'; end if;
    if v_locked->'document'->'metadata' ? 'source_catalogue_key' then
      select pg_catalog.jsonb_build_object('tag','catalogue_version',
        'sourceCatalogueKey',v.source_catalogue_key,'sourceVersionId',v.id,'activationEventId',v.activation_event_id)
        into v_expected_source from public.public_source_versions v where v.staging_document_id=v_doc;
    else
      v_expected_source:=pg_catalog.jsonb_build_object('tag','document_owned');
    end if;
    if v_source->'source' is distinct from v_expected_source then raise exception 'shadow_eval_source_binding'; end if;
    v_index:=v_index+1;
  end loop;
  if v_request->'phase' is distinct from v_phase
    or v_request->'caseScopes' is distinct from v_authority->'caseScopes'
    then raise exception 'shadow_eval_request_binding'; end if;

  select coalesce(pg_catalog.array_agg(value::uuid order by ord),array[]::uuid[]) into v_call_ids
    from pg_catalog.jsonb_array_elements_text(v_call->'documentIds') with ordinality a(value,ord);
  foreach v_id in array array[
    p_arguments->'document_filters',p_arguments->'document_ids',
    case when p_operation='documents' then p_arguments->'ids' else null end] loop
    if v_id is null or v_id='null'::jsonb then continue; end if;
    if pg_catalog.jsonb_typeof(v_id) is distinct from 'array'
      or exists(select 1 from pg_catalog.jsonb_array_elements(v_id) x
        where not (v_call->'documentIds' @> pg_catalog.jsonb_build_array(x)))
      then raise exception 'shadow_eval_argument_scope'; end if;
  end loop;
  if p_arguments ? 'document_filter' and p_arguments->'document_filter'<>'null'::jsonb
    and not (v_call->'documentIds' @> pg_catalog.jsonb_build_array(p_arguments->'document_filter'))
    then raise exception 'shadow_eval_argument_scope'; end if;

  perform public.shadow_validate_recovery_v1(v_context->'recoveryEnvelope',v_manifest->>'targetProjectRef',v_authorized);
  v_recovery:=public.shadow_validate_recovery_v1(v_context->'recoveryEnvelope',v_manifest->>'targetProjectRef',v_now);
  if v_context->'recoveryEnvelope'->>'digest' is distinct from v_authority->>'recoveryEnvelopeDigest'
    or v_recovery->>'rawDigest' is distinct from v_manifest->>'recoveryEvidenceSha256'
    then raise exception 'shadow_eval_recovery'; end if;


  -- Validate the complete retained SQL environment wrapper and replace every
  -- effectiveText with the value observed by current_setting in this statement.
  v_environment:=public.shadow_node_payload_v1(v_profile->'sql'->'environment','u04-sql-execution-evidence-v1');
  if not public.shadow_keys_v1(v_environment,array['kind','evidenceMode','captureEnvelope','reviewEnvelope'])
    or v_environment->>'kind' is distinct from 'u04-reviewed-sql-environment-v1'
    or v_environment->'evidenceMode' is distinct from v_profile->'evidenceMode'
    then raise exception 'shadow_eval_environment'; end if;
  v_capture:=public.shadow_node_payload_v1(v_environment->'captureEnvelope','u04-sql-execution-evidence-v1');
  v_review:=public.shadow_node_payload_v1(v_environment->'reviewEnvelope','u04-sql-execution-evidence-v1');
  if not public.shadow_keys_v1(v_capture,array['kind','evidenceMode','target','capturedAt','producer','implementation',
      'runtime','textSearch','collations','relations','routines','operations','deadlineConfiguration','nativeCapture'])
    or v_capture->>'kind' is distinct from 'u04-sql-environment-capture-v1'
    or v_capture->'evidenceMode' is distinct from v_profile->'evidenceMode'
    or v_capture->'target'->>'projectRef' is distinct from v_manifest->>'targetProjectRef'
    or v_capture->'implementation' is distinct from v_profile->'implementation'
    or not public.shadow_keys_v1(v_review,array['kind','evidenceMode','captureEnvelopeDigest','reviewer','coverage'])
    or v_review->>'kind' is distinct from 'u04-sql-environment-review-v1'
    or v_review->'evidenceMode' is distinct from v_profile->'evidenceMode'
    or v_review->>'captureEnvelopeDigest' is distinct from v_environment->'captureEnvelope'->>'digest'
    or pg_catalog.jsonb_array_length(v_review->'coverage')<>6
    or (select count(distinct value->>'area') from pg_catalog.jsonb_array_elements(v_review->'coverage'))<>6
    or exists(select 1 from pg_catalog.jsonb_array_elements(v_review->'coverage') c
      where c->>'area' not in ('target_and_implementation','text_search','collations','structural_dependencies',
        'operation_settings','server_deadline') or c->>'outcome'<>'satisfied')
    or pg_catalog.jsonb_array_length(v_capture->'operations')<>26
    or (select count(distinct value->>'operation') from pg_catalog.jsonb_array_elements(v_capture->'operations'))<>26
    or exists(select 1 from pg_catalog.jsonb_array_elements_text(v_operations) required
      where not exists(select 1 from pg_catalog.jsonb_array_elements(v_capture->'operations') actual
        where actual->>'operation'=required))
    then raise exception 'shadow_eval_environment'; end if;
  select value into v_operation from pg_catalog.jsonb_array_elements(v_capture->'operations')
    where value->>'operation'=p_operation;
  if not found or not public.shadow_keys_v1(v_operation,array['operation','entryRoutine','dependencyRoutines','relations','collations','settings'])
    or pg_catalog.jsonb_array_length(v_operation->'settings')<>7
    or (select count(distinct value->>'name') from pg_catalog.jsonb_array_elements(v_operation->'settings'))<>7
    or exists(select 1 from pg_catalog.jsonb_array_elements(v_operation->'settings') s
      where not (s->>'name'=any(v_settings))
        or not public.shadow_keys_v1(s,array['name','effectiveText','unit','source','definingRoutine']))
    then raise exception 'shadow_eval_operation_environment'; end if;
  for v_setting in select value from pg_catalog.jsonb_array_elements(v_operation->'settings') loop
    v_setting_name:=v_setting->>'name';
    v_setting_value:=pg_catalog.current_setting(v_setting_name,true);
    if v_setting_value is null or v_setting_value is distinct from v_setting->>'effectiveText'
      then raise exception 'shadow_eval_setting'; end if;
    v_observed_settings:=v_observed_settings||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_set(v_setting,'{effectiveText}',pg_catalog.to_jsonb(v_setting_value),false));
  end loop;
  v_observed_operation:=pg_catalog.jsonb_set(v_operation,'{settings}',v_observed_settings,false);
  if v_observed_operation is distinct from v_operation
    or extract(epoch from pg_catalog.current_setting('statement_timeout')::interval)*1000
       is distinct from (v_profile->'limits'->>'serverRequestDeadlineMs')::numeric
    or extract(epoch from pg_catalog.current_setting('lock_timeout')::interval)*1000 not between 1 and
       (v_profile->'limits'->>'lockTimeoutMs')::numeric
    or (p_operation='vector_chunks' and pg_catalog.current_setting('hnsw.ef_search',true)<>'100')
    then raise exception 'shadow_eval_deadline'; end if;
  if not public.shadow_keys_v1(v_capture->'deadlineConfiguration',
      array['kind','deploymentIdentity','transport','requestPathIdentity','policy','bindings','client'])
    or v_capture->'deadlineConfiguration'->>'kind'<>'u04-deadline-configuration-v1'
    or v_capture->'deadlineConfiguration'->>'transport'<>'supabase-postgrest-rpc'
    or not public.shadow_keys_v1(v_capture->'deadlineConfiguration'->'policy',
      array['topLevelStatementDeadlineMs','lockTimeoutMs','clientTotalDeadlineMs'])
    or v_capture->'deadlineConfiguration'->'policy'->>'topLevelStatementDeadlineMs'<>'15000'
    or v_capture->'deadlineConfiguration'->'policy'->>'clientTotalDeadlineMs'<>'20000'
    or (v_capture->'deadlineConfiguration'->'policy'->>'lockTimeoutMs')::numeric is distinct from
       (v_profile->'limits'->>'lockTimeoutMs')::numeric
    or v_capture->'deadlineConfiguration'->'client'->>'totalDeadlineMs'<>'20000'
    or v_capture->'deadlineConfiguration'->'client'->>'scope'<>'one_operation_total'
    then raise exception 'shadow_eval_deadline_evidence'; end if;

  v_side:=v_phase->>'side';
  if v_side='baseline' then
    if not public.shadow_keys_v1(v_phase,array['side','planDigest','candidateGenerationId','waveReceiptDigest'])
      or v_phase->'planDigest'<>'null'::jsonb or v_phase->'candidateGenerationId'<>'null'::jsonb
      or v_phase->'waveReceiptDigest'<>'null'::jsonb
      or v_manifest->'planPath'<>'null'::jsonb or v_manifest->'reportOrReceiptPath'<>'null'::jsonb
      or not public.shadow_keys_v1(v_context->'evidence',array['side','planEnvelope','waveReadback'])
      or v_context->'evidence'->>'side'<>'baseline'
      or v_context->'evidence'->'planEnvelope'<>'null'::jsonb
      or v_context->'evidence'->'waveReadback'<>'null'::jsonb
      then raise exception 'shadow_eval_baseline_phase'; end if;
    v_observed_envelope:=public.capture_shadow_reindex_origin(v_w,v_origin->>'sourcePolicyVersion',v_m,
      v_origin->'executionProfileEnvelope');
    v_observed:=(v_observed_envelope->>'canonicalPayload')::jsonb;
    if v_observed-'capturedAt' is distinct from v_origin-'capturedAt'
      then raise exception 'shadow_eval_baseline_changed'; end if;
    v_controls:='[]'::jsonb;
  elsif v_side='candidate' then
    if not public.shadow_keys_v1(v_phase,array['side','planDigest','candidateGenerationId','waveReceiptDigest'])
      or v_phase->>'planDigest' !~ '^sha256:[0-9a-f]{64}$'
      or v_phase->>'candidateGenerationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or v_phase->>'waveReceiptDigest' !~ '^sha256:[0-9a-f]{64}$'
      or pg_catalog.jsonb_typeof(v_manifest->'planPath') is distinct from 'string'
      or pg_catalog.length(v_manifest->>'planPath')=0
      or (v_manifest->'reportOrReceiptPath'<>'null'::jsonb and
        (pg_catalog.jsonb_typeof(v_manifest->'reportOrReceiptPath') is distinct from 'string'
         or pg_catalog.length(v_manifest->>'reportOrReceiptPath')=0))
      or not public.shadow_keys_v1(v_context->'evidence',array['side','planEnvelope','waveReadback'])
      or v_context->'evidence'->>'side'<>'candidate'
      then raise exception 'shadow_eval_candidate_phase'; end if;
    v_candidate:=(v_phase->>'candidateGenerationId')::uuid;
    v_plan_envelope:=v_context->'evidence'->'planEnvelope';
    v_plan_payload:=public.validate_shadow_plan_v1(v_plan_envelope);
    v_plan:=v_plan_payload->'plan';v_plan_input:=v_plan_payload->'audit'->'input';
    v_readback:=v_context->'evidence'->'waveReadback';
    if v_plan_envelope->>'digest' is distinct from v_phase->>'planDigest'
      or v_plan->>'candidateGenerationId' is distinct from v_candidate::text
      or v_plan->>'targetProjectRef' is distinct from v_manifest->>'targetProjectRef'
      or v_plan_input->'originEnvelope' is distinct from v_context->'originalOriginEnvelope'
      or public.shadow_audit_timestamp_v1(v_plan_payload->'audit'->'validation'->'auditPreparedAt')>v_authorized
      or (select pg_catalog.jsonb_agg(value->'documentId' order by ord)
          from pg_catalog.jsonb_array_elements(v_plan->'documents') with ordinality d(value,ord))
         is distinct from v_profile->'documentIds'
      or not public.shadow_keys_v1(v_readback,array['version','waveReceiptEnvelope','baselineRows','observedOriginEnvelope'])
      or v_readback->'version' is distinct from '1'::jsonb
      then raise exception 'shadow_eval_candidate_evidence'; end if;
    v_wave_receipt_envelope:=v_readback->'waveReceiptEnvelope';
    v_wave_receipt:=public.shadow_inventory_envelope_payload_v1(v_wave_receipt_envelope);
    if v_wave_receipt_envelope->>'domain'<>'wave_receipt' or v_wave_receipt_envelope->>'encoding'<>'pg-jsonb-text-v1'
      or v_wave_receipt_envelope->>'digest' is distinct from v_phase->>'waveReceiptDigest'
      or not public.shadow_keys_v1(v_wave_receipt,array['kind','version','candidateGenerationId','planDigest',
        'preparedOriginDigest','executionProfileDigest','caseSetDigest','baselineReportDigest',
        'recoveryEvidenceDigest','operationManifestDigest','documentIds','members','sealedAt'])
      or v_wave_receipt->>'kind'<>'u04-wave-seal-receipt-v1' or v_wave_receipt->'version'<>'1'::jsonb
      or v_wave_receipt->>'candidateGenerationId' is distinct from v_candidate::text
      or v_wave_receipt->>'planDigest' is distinct from v_phase->>'planDigest'
      or v_wave_receipt->>'preparedOriginDigest' is distinct from v_authority->>'originalOriginDigest'
      or v_wave_receipt->>'executionProfileDigest' is distinct from v_authority->>'executionProfileDigest'
      or v_wave_receipt->>'caseSetDigest' is distinct from v_authority->'caseScopes'->>'caseSetDigest'
      or v_wave_receipt->>'recoveryEvidenceDigest' is distinct from v_recovery->'evidence'->>'digest'
      or v_wave_receipt->'documentIds' is distinct from v_profile->'documentIds'
      or pg_catalog.jsonb_array_length(v_wave_receipt->'members')<>pg_catalog.cardinality(v_w)
      or public.shadow_audit_timestamp_v1(v_wave_receipt->'sealedAt')>v_authorized
      then raise exception 'shadow_eval_wave_receipt'; end if;
    select * into v_wave from public.shadow_reindex_waves
      where candidate_generation_id=v_candidate and plan_digest=v_phase->>'planDigest';
    if not found or v_wave.plan_payload is distinct from v_plan_envelope
      or v_wave.plan_digest is distinct from v_phase->>'planDigest'
      or v_wave.baseline_report is distinct from v_plan_input->'caseResultsEnvelope'
      or v_wave.prepared_origin_digest is distinct from v_authority->>'originalOriginDigest'
      or v_wave.execution_profile_digest is distinct from v_authority->>'executionProfileDigest'
      or v_wave.case_set_digest is distinct from v_authority->'caseScopes'->>'caseSetDigest'
      or v_wave.baseline_report_digest is distinct from v_wave_receipt->>'baselineReportDigest'
      or v_wave.recovery_evidence_digest is distinct from v_wave_receipt->>'recoveryEvidenceDigest'
      or v_wave.operation_manifest_digest is distinct from v_wave_receipt->>'operationManifestDigest'
      then raise exception 'shadow_eval_wave_row'; end if;


    v_jobs:=array[]::uuid[];v_index:=0;
    for v_member_entry in select value from pg_catalog.jsonb_array_elements(v_wave_receipt->'members') loop
      v_doc:=v_w[v_index+1];
      if not public.shadow_keys_v1(v_member_entry,array['documentId','memberReceiptEnvelope'])
        or v_member_entry->>'documentId' is distinct from v_doc::text
        then raise exception 'shadow_eval_wave_member'; end if;
      select * into v_member from public.document_index_generations
        where document_id=v_doc and index_generation_id=v_candidate;
      select value into v_case from pg_catalog.jsonb_array_elements(v_plan->'documents')
        where value->>'documentId'=v_doc::text;
      if not found or v_member.state<>'staged'
        or v_member.original_origin_envelope is distinct from v_context->'originalOriginEnvelope'
        or v_member.source_binding is distinct from v_request->'sourceBindings'->v_index
        or v_member.baseline_generation_id::text is distinct from v_case->>'baselineGenerationId'
        or v_member.expected_state_digest is distinct from v_case->>'expectedStateDigest'
        or v_member.stage_receipt is distinct from v_member_entry->'memberReceiptEnvelope'
        or v_member.stage_receipt_digest is distinct from v_member.stage_receipt->>'digest'
        or v_member.first_lease_token is null or v_member.claimed_at is null or v_member.staged_at is null
        or v_member.expected_inventory_digest is null or v_member.inventory_digest is null
        or v_member.candidate_projection_digest is null
        or not public.shadow_generation_manifest_shape(v_member.inventory_manifest,v_member.first_lease_token)
        then raise exception 'shadow_eval_member_row'; end if;
      v_jobs:=v_jobs||v_member.job_id;
      select * into v_job from public.ingestion_jobs where id=v_member.job_id;
      select * into v_projection from public.document_generation_projections
        where document_id=v_doc and index_generation_id=v_candidate;
      select * into v_baseline from public.document_generation_baselines
        where document_id=v_doc and candidate_generation_id=v_candidate;
      if v_job.id is null or v_job.operation<>'shadow_reindex' or v_job.document_id<>v_doc
        or v_job.requested_generation_id<>v_candidate or v_job.shadow_plan_digest<>v_wave.plan_digest
        or v_job.status<>'completed' or v_job.stage<>'shadow_staged' or v_job.progress<>100 or v_job.attempt_count<>1
        or v_job.max_attempts<>1 or v_job.batch_id is not null or v_job.locked_by is not null or v_job.locked_at is not null
        or v_job.completed_at is distinct from v_member.staged_at or v_job.error_message is not null or v_job.next_run_at is not null
        or v_job.lease_token is distinct from v_member.first_lease_token
        or v_job.lease_expected_generation_id is distinct from v_member.baseline_generation_id
        or v_job.lease_write_generation_id is distinct from v_candidate
        or v_job.lease_authority_digest is distinct from v_member.authority_digest
        or v_job.lease_expires_at is null or v_job.lease_expires_at<=v_job.completed_at
        or v_job.lease_duration_seconds is null or v_job.lease_duration_seconds<=0
        or v_projection.document_id is null or v_projection.owner_id is distinct from v_member.owner_id
        or v_projection.lease_token is distinct from v_member.first_lease_token
        or v_projection.sealed_at is distinct from v_member.staged_at or v_baseline.document_id is null
        then raise exception 'shadow_eval_terminal_state'; end if;
      perform public.shadow_validate_projection_components_v1(v_member,v_projection);
      v_receipt_envelope:=v_member.stage_receipt;
      v_receipt:=public.shadow_inventory_envelope_payload_v1(v_receipt_envelope);
      v_final:=public.shadow_inventory_envelope_payload_v1(v_receipt->'finalInventoryEnvelope');
      v_preseal:=public.shadow_inventory_envelope_payload_v1(v_final->'preSealControlEnvelope');
      v_terminal:=public.shadow_inventory_envelope_payload_v1(v_receipt->'terminalControlEnvelope');
      if v_receipt_envelope->>'domain'<>'member_receipt' or v_receipt_envelope->>'encoding'<>'pg-jsonb-text-v1'
        or not public.shadow_keys_v1(v_receipt,array['kind','version','binding','planDigest','preparedOriginDigest',
          'executionProfileDigest','caseSetDigest','expectedStateDigest','baselineBundleDigest','expectedInventoryDigest',
          'finalInventoryEnvelope','candidateProjectionDigest','terminalControlEnvelope','sealedAt','limitations'])
        or v_receipt->>'kind'<>'u04-member-seal-receipt-v1' or v_receipt->'version'<>'1'::jsonb
        or v_receipt->'binding' is distinct from public.shadow_projection_binding_v1(v_member,null)
        or v_receipt->>'planDigest' is distinct from v_wave.plan_digest
        or v_receipt->>'preparedOriginDigest' is distinct from v_wave.prepared_origin_digest
        or v_receipt->>'executionProfileDigest' is distinct from v_wave.execution_profile_digest
        or v_receipt->>'caseSetDigest' is distinct from v_wave.case_set_digest
        or v_receipt->>'expectedStateDigest' is distinct from v_member.expected_state_digest
        or v_receipt->>'baselineBundleDigest' is distinct from v_member.baseline_bundle_digest
        or v_receipt->>'expectedInventoryDigest' is distinct from v_member.expected_inventory_digest
        or v_receipt->>'candidateProjectionDigest' is distinct from v_member.candidate_projection_digest
        or v_receipt->'sealedAt' is distinct from pg_catalog.to_jsonb(v_member.staged_at)
        or v_receipt->'terminalControlEnvelope'->>'digest' is distinct from
          public.shadow_pg_bundle_v1(v_member.control_snapshot,'control')->>'digest'
        or v_terminal is distinct from v_member.control_snapshot
        or v_terminal->>'controlRevision' is distinct from v_member.control_revision::text
        or v_preseal->>'controlRevision' is distinct from (v_member.control_revision-1)::text
        or v_preseal->'ownNodeJobs'->0->>'status'<>'processing'
        or v_preseal->'ownNodeJobs'->0->>'locked_by' is null
        or pg_catalog.btrim(v_preseal->'ownNodeJobs'->0->>'locked_by')=''
        or v_preseal->'ownNodeJobs'->0->'completed_at'<>'null'::jsonb
        or (v_preseal->'ownNodeJobs'->0->>'lease_expires_at')::timestamptz<=v_member.staged_at
        or (v_preseal->'ownNodeJobs'->0)-array['status','stage','progress','locked_at','locked_by','completed_at','updated_at']
          is distinct from
          (v_terminal->'ownNodeJobs'->0)-array['status','stage','progress','locked_at','locked_by','completed_at','updated_at']
        or v_preseal->'ownStages' is distinct from v_terminal->'ownStages'
        then raise exception 'shadow_eval_member_receipt'; end if;
      select count(*),coalesce(pg_catalog.jsonb_agg(public.shadow_inventory_outcome_v1(i)
        order by public.shadow_utf16_order_v1(i.family),public.shadow_utf16_order_v1(i.unit_key)),'[]'::jsonb),
        coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('family',family,'unitKey',unit_key,'expected',expected,
          'required',required,'producer',producer,'sourceBinding',source_binding)
          order by public.shadow_utf16_order_v1(family),public.shadow_utf16_order_v1(unit_key)),'[]'::jsonb)
        into v_actual_count,v_dispositions,v_declarations
        from public.document_generation_inventory i where i.document_id=v_doc and i.index_generation_id=v_candidate;
      select count(*) into v_expected_count from pg_catalog.jsonb_array_elements(v_member.inventory_manifest->'families') f
        cross join lateral pg_catalog.jsonb_array_elements(f->'groups') g
        cross join lateral pg_catalog.jsonb_array_elements(case when g->>'state'='declared'
          and g->'declaration'->'population'->>'tag'='known'
          then g->'declaration'->'population'->'expectedUnits' else '[]'::jsonb end) u;
      v_expected_inventory:=public.shadow_pg_bundle_v1(
        pg_catalog.jsonb_build_object('manifest',v_member.inventory_manifest,'declarations',v_declarations),'inventory');
      select coalesce(pg_catalog.jsonb_agg(l.value order by public.shadow_utf16_order_v1(i.family),
        public.shadow_utf16_order_v1(i.unit_key),l.ord),'[]'::jsonb) into v_limitations
        from public.document_generation_inventory i
        cross join lateral pg_catalog.jsonb_array_elements(i.limitations) with ordinality l(value,ord)
        where i.document_id=v_doc and i.index_generation_id=v_candidate;
      if not public.shadow_keys_v1(v_final,array['kind','version','binding','expectedInventoryEnvelope',
          'finalDispositions','projectionEnvelope','preSealControlEnvelope','candidateRows','retainedEvidence'])
        or v_final->>'kind'<>'u04-final-inventory-v1' or v_final->'version'<>'1'::jsonb
        or v_final->'binding' is distinct from public.shadow_projection_binding_v1(v_member,null)
        or v_actual_count<>v_expected_count or v_final->'finalDispositions' is distinct from v_dispositions
        or v_final->'expectedInventoryEnvelope' is distinct from v_expected_inventory
        or v_receipt->'finalInventoryEnvelope'->>'digest' is distinct from v_member.inventory_digest
        or v_final->'projectionEnvelope' is distinct from
          public.shadow_pg_bundle_v1(pg_catalog.to_jsonb(v_projection),'projection')
        or v_final->'candidateRows' is distinct from public.shadow_final_candidate_rows_v1(v_member)
        or v_final->'retainedEvidence' is distinct from public.shadow_final_retained_evidence_v1(v_member)
        or v_receipt->'limitations' is distinct from v_limitations
        or pg_catalog.jsonb_path_exists(v_member.inventory_manifest,'$.families[*].groups[*] ? (@.state == "pending")')
        or exists(select 1 from public.document_generation_inventory i where i.document_id=v_doc
          and i.index_generation_id=v_candidate and (i.disposition='pending' or i.required and i.disposition<>'retained'))
        then raise exception 'shadow_eval_final_inventory'; end if;
      for v_unit in select * from public.document_generation_inventory
        where document_id=v_doc and index_generation_id=v_candidate
        order by public.shadow_utf16_order_v1(family),public.shadow_utf16_order_v1(unit_key) loop
        perform public.shadow_eval_reconcile_final_disposition_v1(v_member,v_member.inventory_manifest,
          public.shadow_inventory_outcome_v1(v_unit));
      end loop;
      if v_baseline.baseline_generation_id is distinct from v_member.baseline_generation_id
        or v_baseline.expected_state_digest is distinct from v_member.expected_state_digest
        or v_baseline.bundle_digest is distinct from v_member.baseline_bundle_digest
        or v_baseline.bundle_payload->>'digest' is distinct from v_baseline.bundle_digest
        or not public.shadow_generation_envelope_valid(v_baseline.bundle_payload,'baseline','pg-jsonb-text-v1')
        or (v_baseline.bundle_payload->>'canonicalPayload')::jsonb->'parameters'->'p_plan' is distinct from v_plan_envelope
        or (v_baseline.bundle_payload->>'canonicalPayload')::jsonb->'parameters'->'p_baseline_evaluation'
          is distinct from v_wave.baseline_report
        then raise exception 'shadow_eval_baseline_bundle'; end if;
      if v_member.control_snapshot is distinct from public.shadow_control_snapshot_v1(v_member.job_id,v_member.control_revision)
        or not exists(select 1 from public.ingestion_job_stages where job_id=v_member.job_id)
        or exists(select 1 from public.ingestion_job_stages st where st.job_id=v_member.job_id and
          (st.job_kind is distinct from 'node' or st.document_id is distinct from v_doc
           or st.lease_token is distinct from v_member.first_lease_token
           or st.index_generation_id is distinct from v_member.baseline_generation_id
           or st.stage_status<>'completed' or st.finished_at is null))
        then raise exception 'shadow_eval_terminal_control'; end if;
      v_controls:=v_controls||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'documentId',v_doc,'controlEnvelope',v_receipt->'terminalControlEnvelope'));
      v_index:=v_index+1;
    end loop;


    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('documentId',document_id,
        'memberReceiptEnvelope',stage_receipt) order by document_id),
      pg_catalog.jsonb_agg(document_id order by document_id),max(staged_at)
      into v_current_members,v_current_documents,v_max_sealed
      from public.document_index_generations where index_generation_id=v_candidate;
    v_current_wave_receipt:=public.shadow_pg_bundle_v1(pg_catalog.jsonb_build_object(
      'kind','u04-wave-seal-receipt-v1','version',1,'candidateGenerationId',v_candidate,
      'planDigest',v_wave.plan_digest,'preparedOriginDigest',v_wave.prepared_origin_digest,
      'executionProfileDigest',v_wave.execution_profile_digest,'caseSetDigest',v_wave.case_set_digest,
      'baselineReportDigest',v_wave.baseline_report_digest,'recoveryEvidenceDigest',v_wave.recovery_evidence_digest,
      'operationManifestDigest',v_wave.operation_manifest_digest,'documentIds',v_current_documents,
      'members',v_current_members,'sealedAt',v_max_sealed),'wave_receipt');
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('documentId',document_id,
      'rowEnvelope',public.shadow_capture_envelope_v1(pg_catalog.to_jsonb(b))) order by document_id),'[]'::jsonb)
      into v_current_baselines from public.document_generation_baselines b
      where candidate_generation_id=v_candidate;
    if v_current_wave_receipt is distinct from v_wave_receipt_envelope
      or v_max_sealed is distinct from public.shadow_audit_timestamp_v1(v_wave_receipt->'sealedAt')
      or v_current_baselines is distinct from v_readback->'baselineRows'
      or pg_catalog.jsonb_array_length(v_current_baselines)<>pg_catalog.cardinality(v_w)
      then raise exception 'shadow_eval_wave_readback'; end if;

    if not public.shadow_generation_envelope_valid(v_readback->'observedOriginEnvelope','baseline','pg-jsonb-text-v1')
      then raise exception 'shadow_eval_readback_origin'; end if;
    v_supplied_observed:=(v_readback->'observedOriginEnvelope'->>'canonicalPayload')::jsonb;
    if v_supplied_observed-array['capturedAt','rows'] is distinct from v_origin-array['capturedAt','rows']
      or public.shadow_state_rows_v1(v_supplied_observed->'rows',v_candidate,v_jobs)
         is distinct from public.shadow_state_rows_v1(v_origin->'rows',v_candidate,v_jobs)
      then raise exception 'shadow_eval_readback_origin'; end if;
    v_observed_envelope:=public.capture_shadow_reindex_origin(v_w,v_origin->>'sourcePolicyVersion',v_m,
      v_origin->'executionProfileEnvelope');
    v_observed:=(v_observed_envelope->>'canonicalPayload')::jsonb;
    if v_observed-array['capturedAt','rows'] is distinct from v_origin-array['capturedAt','rows']
      or public.shadow_state_rows_v1(v_observed->'rows',v_candidate,v_jobs)
         is distinct from public.shadow_state_rows_v1(v_origin->'rows',v_candidate,v_jobs)
      then raise exception 'shadow_eval_candidate_changed'; end if;
  else
    raise exception 'shadow_eval_phase';
  end if;

  -- UUID-list operations must resolve every supplied row ID within this exact
  -- case population and the selected side generation. Duplicate input IDs stay
  -- in originalArguments but cannot make an unknown or foreign row disappear.
  if p_operation='chunks_by_ids' then
    if pg_catalog.jsonb_typeof(p_arguments->'ids') is distinct from 'array'
      or exists(select 1 from pg_catalog.jsonb_array_elements_text(p_arguments->'ids') supplied
        where not exists(
          select 1 from public.document_chunks r
          join pg_catalog.jsonb_array_elements(v_request->'sourceBindings') source(value)
            on source.value->>'documentId'=r.document_id::text
          where r.id=supplied::uuid
            and v_call->'documentIds' @> pg_catalog.jsonb_build_array(r.document_id)
            and ((v_side='baseline' and r.index_generation_id is not distinct from
                    (source.value->>'baselineGenerationId')::uuid)
              or (v_side='candidate' and r.index_generation_id=v_candidate))))
      then raise exception 'shadow_eval_row_scope'; end if;
  elsif p_operation='images_by_ids' then
    if pg_catalog.jsonb_typeof(p_arguments->'ids') is distinct from 'array'
      or exists(select 1 from pg_catalog.jsonb_array_elements_text(p_arguments->'ids') supplied
        where not exists(
          select 1 from public.document_images r
          join pg_catalog.jsonb_array_elements(v_request->'sourceBindings') source(value)
            on source.value->>'documentId'=r.document_id::text
          where r.id=supplied::uuid
            and v_call->'documentIds' @> pg_catalog.jsonb_build_array(r.document_id)
            and ((v_side='baseline' and r.index_generation_id is not distinct from
                    (source.value->>'baselineGenerationId')::uuid)
              or (v_side='candidate' and r.index_generation_id=v_candidate))))
      then raise exception 'shadow_eval_row_scope'; end if;
  end if;

  if pg_catalog.octet_length(pg_catalog.convert_to(v_observed_envelope->>'canonicalPayload','UTF8'))>
      (v_profile->'limits'->>'maxOriginBundleBytes')::bigint
    then raise exception 'evidence_too_large'; end if;
  return pg_catalog.jsonb_build_object(
    'operation',p_operation,'side',v_side,'documentIds',v_call->'documentIds',
    'sourceBindings',v_request->'sourceBindings','candidateGenerationId',
      case when v_side='candidate' then pg_catalog.to_jsonb(v_candidate) else 'null'::jsonb end,
    'comparisonClock',v_request->'comparisonClock','call',v_call,
    'requestEnvelope',v_context->'requestEnvelope','authorityEnvelope',v_context->'authorityEnvelope',
    'evidence',v_context->'evidence','originalOriginEnvelope',v_context->'originalOriginEnvelope',
    'observedOriginEnvelope',v_observed_envelope,'controls',v_controls,'profile',v_profile,
    'environment',pg_catalog.jsonb_build_object('reviewedEnvironmentDigest',
      v_profile->'sql'->'environment'->>'digest','operation',v_observed_operation),
    'observedAt',v_observed->'capturedAt');
exception when others then
  if sqlerrm='evidence_too_large' then raise exception 'evidence_too_large' using errcode='22023'; end if;
  raise exception 'invalid_shadow_evaluation_guard' using errcode='22023';
end $$;
alter function public.shadow_eval_guard_v1(jsonb,text,jsonb) owner to postgres;
revoke all on function public.shadow_eval_guard_v1(jsonb,text,jsonb) from public,anon,authenticated,service_role;

-- U04 evaluation result writer, candidate 1.
-- Outside-only. Consumes the normalized shadow_eval_guard_v1 result from the
-- same statement. Root must add evaluation_report to shadow_pg_bundle_v1's
-- existing fixed domain allow-list before integrating this function.

create or replace function public.shadow_eval_result_origin_v1(p_guard jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e jsonb:=p_guard->'originalOriginEnvelope';p jsonb;
begin
  if pg_catalog.jsonb_typeof(e) is distinct from 'object'
    or e->>'domain' is distinct from 'baseline'
    or e->>'encoding' is distinct from 'pg-jsonb-text-v1'
    or pg_catalog.jsonb_typeof(e->'canonicalPayload') is distinct from 'string'
  then raise exception 'shadow_eval_result_origin' using errcode='22023'; end if;
  begin p:=(e->>'canonicalPayload')::jsonb;
  exception when others then raise exception 'shadow_eval_result_origin' using errcode='22023'; end;
  if p->>'kind' is distinct from 'u04-origin-snapshot-v1'
    or pg_catalog.jsonb_typeof(p->'rows') is distinct from 'object'
    or public.shadow_capture_envelope_v1(p) is distinct from e
  then raise exception 'shadow_eval_result_origin' using errcode='22023'; end if;
  return p;
end $$;
alter function public.shadow_eval_result_origin_v1(jsonb) owner to postgres;
revoke all on function public.shadow_eval_result_origin_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_eval_result_binding_v1(p_guard jsonb,p_document uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s jsonb;n bigint;
begin
  if p_document is null or not exists(
    select 1 from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds') x(value)
    where x.value=p_document::text
  ) then raise exception 'shadow_eval_result_document_scope' using errcode='22023'; end if;
  select count(*),min(x.value::text)::jsonb into n,s
  from pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') x(value)
  where x.value->>'documentId'=p_document::text;
  if n<>1 then raise exception 'shadow_eval_result_source_population' using errcode='22023'; end if;
  return s;
end $$;
alter function public.shadow_eval_result_binding_v1(jsonb,uuid) owner to postgres;
revoke all on function public.shadow_eval_result_binding_v1(jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function public.shadow_eval_result_origin_ref_v1(
  p_guard jsonb,p_table text,p_owner text,p_id uuid,p_document uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p jsonb:=public.shadow_eval_result_origin_v1(p_guard);e jsonb;r jsonb;n bigint;
begin
  if p_table not in ('documents','document_pages','document_chunks','document_images','document_table_facts',
    'document_embedding_fields','document_index_units','document_sections','document_memory_cards',
    'document_summaries','document_labels','document_index_quality','rag_aliases')
    or p_owner not in ('document','page','chunk','image','table_fact','embedding_field','index_unit',
      'section','memory_card','summary','label','quality','alias')
  then raise exception 'shadow_eval_result_origin_family' using errcode='22023'; end if;
  select count(*),min(x.value::text)::jsonb into n,e
  from pg_catalog.jsonb_array_elements(p->'rows'->p_table) x(value)
  where (case when p_table='document_index_quality' then (x.value->>'canonicalPayload')::jsonb->>'document_id'
              else (x.value->>'canonicalPayload')::jsonb->>'id' end)=p_id::text;
  if n<>1 then raise exception 'shadow_eval_result_origin_population' using errcode='22023'; end if;
  r:=(e->>'canonicalPayload')::jsonb;
  if public.shadow_capture_envelope_v1(r) is distinct from e
    or (p_table='documents' and r->>'id' is distinct from p_document::text)
    or (p_table not in ('documents','rag_aliases') and r->>'document_id' is distinct from p_document::text)
  then raise exception 'shadow_eval_result_origin_identity' using errcode='22023'; end if;
  return pg_catalog.jsonb_build_object(
    'tag','origin_row','owner',p_owner,'rowId',p_id,'rowDigest',e->'digest');
end $$;
alter function public.shadow_eval_result_origin_ref_v1(jsonb,text,text,uuid,uuid) owner to postgres;
revoke all on function public.shadow_eval_result_origin_ref_v1(jsonb,text,text,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.shadow_eval_result_candidate_unit_v1(
  p_guard jsonb,p_document uuid,p_owner text,p_id uuid,p_slot text default null,p_item uuid default null
) returns public.document_generation_inventory
language plpgsql stable security definer set search_path='' as $$
declare u public.document_generation_inventory%rowtype;n bigint;
begin
  select count(*) into n from public.document_generation_inventory i
  where i.document_id=p_document
    and i.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
    and i.disposition='retained' and i.artifact_ref is not null and i.content_digest is not null
    and ((p_slot is null and i.artifact_ref->>'tag'='candidate_row'
          and i.artifact_ref->>'owner'=p_owner and i.artifact_ref->>'rowId'=p_id::text)
      or (p_slot is not null and i.artifact_ref->>'tag'='candidate_projection'
          and i.artifact_ref->>'slot'=p_slot
          and ((p_item is null and i.artifact_ref->'itemId'='null'::jsonb)
            or (p_item is not null and i.artifact_ref->>'itemId'=p_item::text))));
  if n<>1 then raise exception 'shadow_eval_result_candidate_population' using errcode='22023'; end if;
  select * into strict u from public.document_generation_inventory i
  where i.document_id=p_document
    and i.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
    and i.disposition='retained'
    and ((p_slot is null and i.artifact_ref->>'tag'='candidate_row'
          and i.artifact_ref->>'owner'=p_owner and i.artifact_ref->>'rowId'=p_id::text)
      or (p_slot is not null and i.artifact_ref->>'tag'='candidate_projection'
          and i.artifact_ref->>'slot'=p_slot
          and ((p_item is null and i.artifact_ref->'itemId'='null'::jsonb)
            or (p_item is not null and i.artifact_ref->>'itemId'=p_item::text))));
  return u;
end $$;
alter function public.shadow_eval_result_candidate_unit_v1(jsonb,uuid,text,uuid,text,uuid) owner to postgres;
revoke all on function public.shadow_eval_result_candidate_unit_v1(jsonb,uuid,text,uuid,text,uuid) from public,anon,authenticated,service_role;

create or replace function public.shadow_eval_result_projection_ref_v1(
  p_guard jsonb,p_document uuid,p_slot text,p_item uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.document_generation_projections%rowtype;v jsonb;n bigint;
begin
  if p_slot not in ('summary','generated_labels','quality','worker_metadata','document_counts',
    'enrichment_metadata','deep_memory_metadata','deep_memory_receipt','producer_aliases')
  then raise exception 'shadow_eval_result_projection_slot' using errcode='22023'; end if;
  select * into strict p from public.document_generation_projections
  where document_id=p_document and index_generation_id=(p_guard->>'candidateGenerationId')::uuid
    and sealed_at is not null;
  if p_slot in ('generated_labels','producer_aliases') then
    if p_item is null then raise exception 'shadow_eval_result_projection_item' using errcode='22023'; end if;
    select count(*),min(x.value::text)::jsonb into n,v
    from pg_catalog.jsonb_array_elements(pg_catalog.to_jsonb(p)->p_slot) x(value)
    where x.value->>'id'=p_item::text;
    if n<>1 then raise exception 'shadow_eval_result_projection_item' using errcode='22023'; end if;
  else
    if p_item is not null then raise exception 'shadow_eval_result_projection_item' using errcode='22023'; end if;
    v:=pg_catalog.to_jsonb(p)->p_slot;
    if v is null or v='null'::jsonb then raise exception 'shadow_eval_result_projection_value' using errcode='22023'; end if;
  end if;
  return pg_catalog.jsonb_build_object('tag','candidate_projection','slot',p_slot,'itemId',p_item,
    'payloadDigest',public.shadow_pg_bundle_v1(v,'projection')->'digest');
end $$;
alter function public.shadow_eval_result_projection_ref_v1(jsonb,uuid,text,uuid) owner to postgres;
revoke all on function public.shadow_eval_result_projection_ref_v1(jsonb,uuid,text,uuid) from public,anon,authenticated,service_role;

create or replace function public.shadow_eval_result_origin_graph_v1(
  p_guard jsonb,p_document uuid,p_table text,p_owner text,p_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare origin jsonb:=public.shadow_eval_result_origin_v1(p_guard);env jsonb;row_value jsonb;specs jsonb;spec jsonb;
  path_value jsonb;field_path jsonb;item jsonb;item_index bigint;family_name text;tag_name text;
  target_id uuid;target_key text;page_id uuid;n bigint;refs jsonb:='[]'::jsonb;rels jsonb:='[]'::jsonb;
  profile_key text;claim_index bigint;prefix jsonb;request_value jsonb;alias_index bigint;
  unit_family text;unit_key text;
begin
  select min(e.value::text)::jsonb into env
  from pg_catalog.jsonb_array_elements(origin->'rows'->p_table) e(value)
  where (case when p_table='document_index_quality' then (e.value->>'canonicalPayload')::jsonb->>'document_id'
              else (e.value->>'canonicalPayload')::jsonb->>'id' end)=p_id::text;
  if env is null then raise exception 'shadow_eval_result_origin_graph_row' using errcode='22023'; end if;
  row_value:=(env->>'canonicalPayload')::jsonb;
  specs:='[
    {"path":["source_chunk_id"],"tag":"source_chunk","family":"chunks","array":false},
    {"path":["source_image_id"],"tag":"source_image","family":"images","array":false},
    {"path":["section_id"],"tag":"section","family":"sections","array":false},
    {"path":["image_ids"],"tag":"source_image","family":"images","array":true},
    {"path":["source_image_ids"],"tag":"source_image","family":"images","array":true},
    {"path":["chunk_ids"],"tag":"source_chunk","family":"chunks","array":true},
    {"path":["source_chunk_ids"],"tag":"source_chunk","family":"chunks","array":true},
    {"path":["metadata","chunk_ids"],"tag":"source_chunk","family":"chunks","array":true},
    {"path":["metadata","source_chunk_ids"],"tag":"source_chunk","family":"chunks","array":true},
    {"path":["metadata","source_image_ids"],"tag":"source_image","family":"images","array":true},
    {"path":["page_number"],"tag":"page","family":"pages","array":false},
    {"path":["page_start"],"tag":"page","family":"pages","array":false},
    {"path":["page_end"],"tag":"page","family":"pages","array":false}]'::jsonb;
  if p_table='document_labels' and row_value->>'source'='generated' then
    specs:=specs||'[{"path":["metadata","pages"],"tag":"page","family":"pages","array":true}]'::jsonb;
  end if;
  if p_table='document_summaries' then
    prefix:='["metadata","source_anchored_summary_v1"]'::jsonb;
    specs:=specs||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('path',prefix||'["source_chunk_ids"]'::jsonb,'tag','source_chunk','family','chunks','array',true),
      pg_catalog.jsonb_build_object('path',prefix||'["source_image_ids"]'::jsonb,'tag','source_image','family','images','array',true));
    foreach profile_key in array array['applies_to','key_clinical_actions','medication_dose_monitoring','thresholds_timing',
      'escalation_risk_warnings','required_forms_documentation','not_covered','important_tables_images',
      'best_questions','source_quality_notes']
    loop
      for claim_index in select ord-1 from pg_catalog.jsonb_array_elements(
        row_value #> array['metadata','source_anchored_summary_v1','clinical_specifics','profile',profile_key])
        with ordinality a(value,ord)
      loop
        specs:=specs||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('path',prefix||pg_catalog.jsonb_build_array('clinical_specifics','profile',profile_key,claim_index,'source_chunk_ids'),'tag','source_chunk','family','chunks','array',true),
          pg_catalog.jsonb_build_object('path',prefix||pg_catalog.jsonb_build_array('clinical_specifics','profile',profile_key,claim_index,'source_image_ids'),'tag','source_image','family','images','array',true),
          pg_catalog.jsonb_build_object('path',prefix||pg_catalog.jsonb_build_array('clinical_specifics','profile',profile_key,claim_index,'pages'),'tag','page','family','pages','array',true));
      end loop;
    end loop;
  end if;
  if p_table='documents' and row_value->'metadata'->'deep_memory_commit_receipts'->'local-worker' is not null
    and row_value->'metadata'->'deep_memory_commit_receipts'->'local-worker' is distinct from 'null'::jsonb
  then
    request_value:=row_value->'metadata'->'deep_memory_commit_receipts'->'local-worker'->'request';
    for item,item_index in select value,ord-1 from pg_catalog.jsonb_array_elements(request_value->'anchors')
      with ordinality a(value,ord)
    loop
      target_id:=(item->>'id')::uuid;
      refs:=refs||pg_catalog.jsonb_build_array(
        public.shadow_eval_result_origin_ref_v1(p_guard,'document_chunks','chunk',target_id,p_document));
      prefix:=pg_catalog.jsonb_build_array('metadata','deep_memory_commit_receipts','local-worker','request','anchors',item_index);
      rels:=rels||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('tag','source_chunk','field',prefix||pg_catalog.jsonb_build_array('id'),
          'target',pg_catalog.jsonb_build_object('family','chunks','key',target_id::text)),
        pg_catalog.jsonb_build_object('tag','anchor','field',prefix||pg_catalog.jsonb_build_array('anchor_id'),
          'target',pg_catalog.jsonb_build_object('family','chunks','key',target_id::text),'value',item->'anchor_id'));
    end loop;
    for item,alias_index in select value,ord-1 from pg_catalog.jsonb_array_elements(request_value->'aliases')
      with ordinality a(value,ord)
    loop
      prefix:=pg_catalog.jsonb_build_array('metadata','deep_memory_commit_receipts','local-worker','request','aliases',alias_index,'metadata');
      specs:=specs||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('path',prefix||pg_catalog.jsonb_build_array('source_chunk_ids'),'tag','source_chunk','family','chunks','array',true),
        pg_catalog.jsonb_build_object('path',prefix||pg_catalog.jsonb_build_array('chunk_ids'),'tag','source_chunk','family','chunks','array',true),
        pg_catalog.jsonb_build_object('path',prefix||pg_catalog.jsonb_build_array('source_image_ids'),'tag','source_image','family','images','array',true));
    end loop;
  end if;
  for spec in select value from pg_catalog.jsonb_array_elements(specs) loop
    field_path:=spec->'path';
    path_value:=row_value #> array(select pg_catalog.jsonb_array_elements_text(field_path));
    if path_value is null or path_value='null'::jsonb then continue; end if;
    if spec->'array'='true'::jsonb and pg_catalog.jsonb_typeof(path_value) is distinct from 'array'
    then raise exception 'shadow_eval_result_origin_graph_array' using errcode='22023'; end if;
    for item,item_index in select value,ord-1 from pg_catalog.jsonb_array_elements(
      case when spec->'array'='true'::jsonb then path_value else pg_catalog.jsonb_build_array(path_value) end)
      with ordinality a(value,ord)
    loop
      if pg_catalog.jsonb_typeof(item) is distinct from 'string' and spec->>'family'<>'pages'
      then raise exception 'shadow_eval_result_origin_graph_value' using errcode='22023'; end if;
      family_name:=spec->>'family';tag_name:=spec->>'tag';
      if family_name='pages' then
        if pg_catalog.jsonb_typeof(item) is distinct from 'number' then raise exception 'shadow_eval_result_origin_graph_page'; end if;
        select count(*),min((e.value->>'canonicalPayload')::jsonb->>'id')::uuid into n,page_id
        from pg_catalog.jsonb_array_elements(origin->'rows'->'document_pages') e(value)
        where (e.value->>'canonicalPayload')::jsonb->>'document_id'=p_document::text
          and (e.value->>'canonicalPayload')::jsonb->'page_number'=item;
        if n<>1 then raise exception 'shadow_eval_result_origin_graph_page'; end if;
        target_id:=page_id;target_key:=item#>>'{}';
        refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,'document_pages','page',target_id,p_document));
      elsif family_name='chunks' then
        target_id:=(item#>>'{}')::uuid;target_key:=target_id::text;
        refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,'document_chunks','chunk',target_id,p_document));
      elsif family_name='images' then
        target_id:=(item#>>'{}')::uuid;target_key:=target_id::text;
        refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,'document_images','image',target_id,p_document));
      else
        target_id:=(item#>>'{}')::uuid;target_key:=target_id::text;
        refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,'document_sections','section',target_id,p_document));
      end if;
      rels:=rels||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'tag',tag_name,'field',field_path||case when spec->'array'='true'::jsonb then pg_catalog.jsonb_build_array(item_index) else '[]'::jsonb end,
        'target',pg_catalog.jsonb_build_object('family',family_name,'key',target_key)));
    end loop;
  end loop;
  if row_value->'anchor_id' is not null and row_value->'anchor_id' is distinct from 'null'::jsonb then
    unit_family:=case p_owner when 'document' then 'document_metadata' when 'page' then 'pages'
      when 'chunk' then 'chunks' when 'image' then 'images' when 'table_fact' then 'table_facts'
      when 'embedding_field' then 'embedding_fields' when 'index_unit' then 'index_units'
      when 'section' then 'sections' when 'memory_card' then 'memory_cards' when 'summary' then 'summary'
      when 'label' then 'generated_labels' when 'quality' then 'quality' when 'alias' then 'producer_aliases' end;
    unit_key:=case when unit_family in ('document_metadata','summary','quality') then 'singleton'
      when unit_family='pages' then row_value->>'page_number' else row_value->>'id' end;
    if unit_family is null or unit_key is null or pg_catalog.jsonb_typeof(row_value->'anchor_id') is distinct from 'string'
    then raise exception 'shadow_eval_result_origin_graph_anchor' using errcode='22023'; end if;
    rels:=rels||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'tag','anchor','field',pg_catalog.jsonb_build_array('anchor_id'),
      'target',pg_catalog.jsonb_build_object('family',unit_family,'key',unit_key),'value',row_value->'anchor_id'));
  end if;
  select coalesce(pg_catalog.jsonb_agg(value order by public.shadow_node_value_text_v1(value)),'[]'::jsonb)
    into refs from (select distinct value from pg_catalog.jsonb_array_elements(refs)) dedup;
  select coalesce(pg_catalog.jsonb_agg(value order by public.shadow_node_value_text_v1(value)),'[]'::jsonb)
    into rels from (select distinct value from pg_catalog.jsonb_array_elements(rels)) dedup;
  return pg_catalog.jsonb_build_object('refs',refs,'relationships',rels);
end $$;
alter function public.shadow_eval_result_origin_graph_v1(jsonb,uuid,text,text,uuid) owner to postgres;
revoke all on function public.shadow_eval_result_origin_graph_v1(jsonb,uuid,text,text,uuid) from public,anon,authenticated,service_role;
create or replace function public.shadow_eval_result_occurrence_v1(
  p_guard jsonb,p_operation text,p_part text,p_index integer,p_row jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare side text:=p_guard->>'side';doc uuid;rid uuid;tbl text;owner_name text;slot_name text;item uuid;
  source jsonb;refs jsonb:='[]'::jsonb;rels jsonb:='[]'::jsonb;view_value jsonb;
  member public.document_index_generations%rowtype;unit public.document_generation_inventory%rowtype;
  dep public.document_generation_inventory%rowtype;origin jsonb:=public.shadow_eval_result_origin_v1(p_guard);
  env jsonb;full_row jsonb;selected jsonb:=p_row;n bigint;alias_row jsonb;entry jsonb;idx bigint;target_id uuid;page_id uuid;graph jsonb;expected_value jsonb;doc_value jsonb;label_id uuid;projection public.document_generation_projections%rowtype;
begin
  if (p_part in ('rows','ownerRows','publicRows')) is not true or p_index is null or p_index<0
    or pg_catalog.jsonb_typeof(p_row) is distinct from 'object'
  then raise exception 'shadow_eval_result_occurrence' using errcode='22023'; end if;

  if p_operation='aliases' then
    if side='candidate' then
      select count(*),min(a.value::text)::jsonb,min(p.document_id::text)::uuid
        into n,alias_row,doc
      from public.document_generation_projections p
      cross join lateral pg_catalog.jsonb_array_elements(p.producer_aliases) a(value)
      where p.index_generation_id=(p_guard->>'candidateGenerationId')::uuid
        and p.document_id=any(array(select value::uuid from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds')))
        and pg_catalog.jsonb_build_object('alias',a.value->'alias','canonical',a.value->'canonical',
          'alias_type',a.value->'alias_type','weight',a.value->'weight','owner_id',a.value->'owner_id')=p_row;
      if n=1 then rid:=(alias_row->>'id')::uuid;item:=rid;slot_name:='producer_aliases'; end if;
    end if;
    if doc is null then
      select count(*),min(e.value::text)::jsonb
        into n,env
      from pg_catalog.jsonb_array_elements(origin->'rows'->'rag_aliases') e(value)
      where exists(
          select 1
          from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds') d(value)
          join pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value) on s.value->>'documentId'=d.value
          where (e.value->>'canonicalPayload')::jsonb->'metadata'->>'document_id'=d.value
             or exists(select 1 from pg_catalog.jsonb_array_elements_text(s.value->'manualAliasIds') m(value)
                       where m.value=(e.value->>'canonicalPayload')::jsonb->>'id'))
        and pg_catalog.jsonb_build_object('alias',(e.value->>'canonicalPayload')::jsonb->'alias',
          'canonical',(e.value->>'canonicalPayload')::jsonb->'canonical',
          'alias_type',(e.value->>'canonicalPayload')::jsonb->'alias_type',
          'weight',(e.value->>'canonicalPayload')::jsonb->'weight',
          'owner_id',(e.value->>'canonicalPayload')::jsonb->'owner_id')=p_row;
      if n<>1 then raise exception 'shadow_eval_result_alias_population' using errcode='22023'; end if;
      rid:=((env->>'canonicalPayload')::jsonb->>'id')::uuid;full_row:=(env->>'canonicalPayload')::jsonb;
      select d.value::uuid into strict doc
      from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds') with ordinality d(value,ord)
      join pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') s(value)
        on s.value->>'documentId'=d.value
      where full_row->'metadata'->>'document_id'=d.value
         or exists(select 1 from pg_catalog.jsonb_array_elements_text(s.value->'manualAliasIds') m(value)
                   where m.value=rid::text)
      order by d.ord limit 1;
    else full_row:=alias_row; end if;
    if ((p_part='publicRows') is distinct from (full_row->'owner_id'='null'::jsonb))
    then raise exception 'shadow_eval_result_alias_part' using errcode='22023'; end if;
    tbl:='rag_aliases';owner_name:='alias';
  elsif p_operation in ('documents','lookup_documents','lookup_document_terms') then
    doc:=(p_row->>'id')::uuid;rid:=doc;tbl:='documents';owner_name:='document';
    if side='candidate' then slot_name:='worker_metadata'; end if;
  elsif p_operation in ('ranking_metadata','related_documents') then
    doc:=(p_row->>'document_id')::uuid;rid:=doc;tbl:='documents';owner_name:='document';
    if side='candidate' then slot_name:='worker_metadata'; end if;
  elsif p_operation='quality' then
    doc:=(p_row->>'document_id')::uuid;rid:=doc;tbl:='document_index_quality';owner_name:='quality';
    if side='candidate' then slot_name:='quality'; end if;
  else
    doc:=(p_row->>'document_id')::uuid;rid:=(p_row->>'id')::uuid;
    if p_operation in ('images_by_ids','images_by_pages','visual_rows') then tbl:='document_images';owner_name:='image';
    elsif p_operation='table_facts' then tbl:='document_table_facts';owner_name:='table_fact';
    elsif p_operation='embedding_fields' then tbl:='document_embedding_fields';owner_name:='embedding_field';
    elsif p_operation='index_units' then tbl:='document_index_units';owner_name:='index_unit';
    elsif p_operation in ('memory_cards_hybrid','memory_cards_lexical') then tbl:='document_memory_cards';owner_name:='memory_card';
    else tbl:='document_chunks';owner_name:='chunk'; end if;
  end if;
  source:=public.shadow_eval_result_binding_v1(p_guard,doc);

  if side='baseline' or (p_operation='aliases' and slot_name is null) then
    refs:=pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,tbl,owner_name,rid,doc));
    if full_row is null then
      select (e.value->>'canonicalPayload')::jsonb into strict full_row
      from pg_catalog.jsonb_array_elements(origin->'rows'->tbl) e(value)
      where (case when tbl='document_index_quality' then (e.value->>'canonicalPayload')::jsonb->>'document_id'
                  else (e.value->>'canonicalPayload')::jsonb->>'id' end)=rid::text;
    end if;
    if p_operation in ('ranking_metadata','related_documents') then
      select pg_catalog.jsonb_build_object('document_id',m.document_id,'labels',m.labels,'summary',m.summary)
        into strict full_row
      from public.shadow_eval_related_metadata_v1(p_guard,array[doc],'related_documents') m;
    end if;
    view_value:=pg_catalog.jsonb_build_object('tag',side,'source',source);
    if side='candidate' then
      select * into strict member from public.document_index_generations
      where document_id=doc and index_generation_id=(p_guard->>'candidateGenerationId')::uuid
        and source_binding=source and state='staged' and stage_receipt is not null;
      view_value:=pg_catalog.jsonb_build_object('tag','candidate','source',source,
        'candidateGenerationId',member.index_generation_id,'jobId',member.job_id,
        'firstLeaseToken',member.first_lease_token,'artifactGenerationId',null);
    end if;
  else
    unit:=public.shadow_eval_result_candidate_unit_v1(p_guard,doc,owner_name,rid,slot_name,item);
    select * into strict member from public.document_index_generations
    where document_id=doc and index_generation_id=(p_guard->>'candidateGenerationId')::uuid
      and source_binding=source and state='staged' and stage_receipt is not null;
    refs:=pg_catalog.jsonb_build_array(unit.artifact_ref);rels:=unit.relationships;
    view_value:=pg_catalog.jsonb_build_object('tag','candidate','source',source,
      'candidateGenerationId',member.index_generation_id,'jobId',member.job_id,
      'firstLeaseToken',member.first_lease_token,'artifactGenerationId',unit.artifact_generation_id);
    if slot_name is null then
      select row_payload into strict full_row
      from public.shadow_capture_rows_v1(array[doc],array[]::uuid[])
      where table_name=tbl and row_payload->>'id'=rid::text;
      if public.shadow_capture_envelope_v1(full_row)->'digest' is distinct from unit.artifact_ref->'rowDigest'
      then raise exception 'shadow_eval_result_candidate_digest' using errcode='22023'; end if;
    elsif slot_name='producer_aliases' then full_row:=alias_row;
    elsif slot_name='quality' then
      select pg_catalog.to_jsonb(q) into strict full_row from public.shadow_eval_quality_v1(p_guard,array[doc]) q;
    elsif p_operation in ('ranking_metadata','related_documents') then
      select pg_catalog.jsonb_build_object('document_id',m.document_id,'labels',m.labels,'summary',m.summary) into strict full_row
      from public.shadow_eval_related_metadata_v1(p_guard,array[doc],'related_documents') m;
    else
      select pg_catalog.to_jsonb(d) into strict full_row from public.shadow_eval_documents_v1(p_guard) d where d.id=doc;
    end if;

    for dep in
      select distinct on (i.family,i.unit_key) i.*
      from pg_catalog.jsonb_array_elements(unit.relationships) e(value)
      join public.document_generation_inventory i
        on i.document_id=doc and i.index_generation_id=member.index_generation_id
       and i.family=e.value->'target'->>'family' and i.unit_key=e.value->'target'->>'key'
      where i.disposition='retained' and i.artifact_ref is not null
      order by i.family,i.unit_key
    loop refs:=refs||pg_catalog.jsonb_build_array(dep.artifact_ref); end loop;
  end if;

  if side='baseline' then
    graph:=public.shadow_eval_result_origin_graph_v1(p_guard,doc,tbl,owner_name,rid);
    refs:=refs||(graph->'refs');rels:=graph->'relationships';
    if p_operation in ('text_chunks','ranking_metadata','related_documents') then
      expected_value:=case when p_operation='text_chunks' then p_row->'document_labels' else p_row->'labels' end;
      for entry in select value from pg_catalog.jsonb_array_elements(expected_value) loop
        label_id:=(entry->>'id')::uuid;
        select count(*),min(e.value::text)::jsonb into n,env
        from pg_catalog.jsonb_array_elements(origin->'rows'->'document_labels') e(value)
        where (e.value->>'canonicalPayload')::jsonb->>'id'=label_id::text
          and (e.value->>'canonicalPayload')::jsonb=entry
          and (((e.value->>'canonicalPayload')::jsonb->>'source')='manual'
            or (e.value->>'canonicalPayload')::jsonb->'metadata'->>'index_generation_id'
              is not distinct from source->>'baselineGenerationId');
        if n<>1 then raise exception 'shadow_eval_result_label_population' using errcode='22023'; end if;
        refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,'document_labels','label',label_id,doc));
        graph:=public.shadow_eval_result_origin_graph_v1(p_guard,doc,'document_labels','label',label_id);
        refs:=refs||(graph->'refs');rels:=rels||(graph->'relationships');
      end loop;
      expected_value:=case when p_operation='text_chunks' then p_row->'document_summary' else p_row->'summary' end;
      if expected_value is distinct from 'null'::jsonb then
        select count(*),min(e.value::text)::jsonb into n,env
        from pg_catalog.jsonb_array_elements(origin->'rows'->'document_summaries') e(value)
        where (e.value->>'canonicalPayload')::jsonb->>'document_id'=doc::text
          and (e.value->>'canonicalPayload')::jsonb->'summary'=expected_value
          and (e.value->>'canonicalPayload')::jsonb->'metadata'->>'index_generation_id'
            is not distinct from source->>'baselineGenerationId';
        if n<>1 then raise exception 'shadow_eval_result_summary_population' using errcode='22023'; end if;
        target_id:=((env->>'canonicalPayload')::jsonb->>'id')::uuid;
        refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,'document_summaries','summary',target_id,doc));
        graph:=public.shadow_eval_result_origin_graph_v1(p_guard,doc,'document_summaries','summary',target_id);
        refs:=refs||(graph->'refs');rels:=rels||(graph->'relationships');
      end if;
    end if;
  end if;
  if side='baseline' and p_operation in ('text_chunks','hybrid_chunks','vector_chunks') then
    refs:=refs||pg_catalog.jsonb_build_array(
      public.shadow_eval_result_origin_ref_v1(p_guard,'documents','document',doc,doc));
    graph:=public.shadow_eval_result_origin_graph_v1(p_guard,doc,'documents','document',doc);
    refs:=refs||(graph->'refs');rels:=rels||(graph->'relationships');
  end if;
  if side='candidate' and p_operation in ('documents','lookup_documents','lookup_document_terms',
    'text_chunks','hybrid_chunks','vector_chunks','ranking_metadata','related_documents')
  then
    refs:=refs||pg_catalog.jsonb_build_array(
      public.shadow_eval_result_origin_ref_v1(p_guard,'documents','document',doc,doc));
    dep:=public.shadow_eval_result_candidate_unit_v1(p_guard,doc,'document',doc,'worker_metadata',null);
    refs:=refs||pg_catalog.jsonb_build_array(dep.artifact_ref,
      public.shadow_eval_result_projection_ref_v1(p_guard,doc,'document_counts',null));
    rels:=rels||dep.relationships;
  end if;
  if p_operation in ('text_chunks','hybrid_chunks','vector_chunks') then
    selected:=selected-'title'-'file_name'-'source_metadata'-'document_labels'-'document_summary'
      -'similarity'-'text_rank'-'hybrid_score'-'lexical_score'-'rrf_score'-'images';
  elsif p_operation='lookup_chunks' then selected:=selected-'text_rank';
  elsif p_operation='lookup_documents' then selected:=selected-'text_rank'-'match_reason';
  elsif p_operation='table_facts' then selected:=selected-'text_rank'-'match_reason'-'metadata';
  elsif p_operation='embedding_fields' then selected:=selected-'similarity'-'text_rank'-'hybrid_score';
  elsif p_operation='index_units' then selected:=selected-'similarity'-'text_rank'-'hybrid_score';
  elsif p_operation='memory_cards_hybrid' then selected:=selected-'similarity'-'text_rank'-'hybrid_score'-'rrf_score';
  elsif p_operation in ('ranking_metadata','related_documents') then null;
  elsif p_operation='quality' and side='candidate' then null;
  elsif p_operation in ('documents','lookup_document_terms') and side='candidate' then null;
  elsif p_operation='lookup_documents' and side='candidate' then selected:=selected-'text_rank'-'match_reason';
  elsif p_operation='aliases' then
    selected:=pg_catalog.jsonb_build_object('alias',full_row->'alias','canonical',full_row->'canonical',
      'alias_type',full_row->'alias_type','weight',full_row->'weight','owner_id',full_row->'owner_id');
  end if;
  if p_operation in ('embedding_fields','index_units') then
    if p_row->'source_chunk_id' is distinct from coalesce(nullif(full_row->'source_chunk_id','null'::jsonb),full_row->'id')
      then raise exception 'shadow_eval_result_source_chunk_projection' using errcode='22023'; end if;
    selected:=selected-'source_chunk_id';
  end if;
  if not (full_row @> selected) then raise exception 'shadow_eval_result_row_changed' using errcode='22023'; end if;
  if p_operation in ('text_chunks','hybrid_chunks','vector_chunks') then
    select pg_catalog.to_jsonb(d) into strict doc_value from public.shadow_eval_documents_v1(p_guard) d where d.id=doc;
    if p_row->'title' is distinct from doc_value->'title'
      or p_row->'file_name' is distinct from doc_value->'file_name'
      or p_row->'source_metadata' is distinct from doc_value->'metadata'
    then raise exception 'shadow_eval_result_document_projection' using errcode='22023'; end if;
  end if;
  if p_operation='text_chunks' then
    select pg_catalog.jsonb_build_object('labels',m.labels,'summary',m.summary) into strict expected_value
    from public.shadow_eval_related_metadata_v1(p_guard,array[doc],'text_chunks') m;
    if p_row->'document_labels' is distinct from expected_value->'labels'
      or p_row->'document_summary' is distinct from expected_value->'summary'
    then raise exception 'shadow_eval_result_metadata_projection' using errcode='22023'; end if;
  elsif p_operation='vector_chunks' and
    (p_row->'document_labels' is distinct from '[]'::jsonb or p_row->'document_summary' is distinct from 'null'::jsonb or p_row->'images' is distinct from '[]'::jsonb)
  then raise exception 'shadow_eval_result_vector_placeholders' using errcode='22023';
  end if;
  if p_operation in ('text_chunks','hybrid_chunks') then
    expected_value:=public.shadow_eval_image_metadata_v1(p_guard,
      array(select value::uuid from pg_catalog.jsonb_array_elements_text(p_row->'image_ids')));
    if p_row->'images' is distinct from expected_value
    then raise exception 'shadow_eval_result_image_projection' using errcode='22023'; end if;
    for entry in select value from pg_catalog.jsonb_array_elements(p_row->'images') loop
      target_id:=(entry->>'id')::uuid;
      if side='candidate' then
        dep:=public.shadow_eval_result_candidate_unit_v1(p_guard,doc,'image',target_id,null,null);
        refs:=refs||pg_catalog.jsonb_build_array(dep.artifact_ref);rels:=rels||dep.relationships;
      else
        refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,'document_images','image',target_id,doc));
        graph:=public.shadow_eval_result_origin_graph_v1(p_guard,doc,'document_images','image',target_id);
        refs:=refs||(graph->'refs');rels:=rels||(graph->'relationships');
      end if;
    end loop;
  end if;

  if side='candidate' and p_operation in ('text_chunks','ranking_metadata','related_documents') then
    expected_value:=case when p_operation='text_chunks' then p_row->'document_labels' else p_row->'labels' end;
    if pg_catalog.jsonb_typeof(expected_value) is distinct from 'array'
    then raise exception 'shadow_eval_result_label_projection' using errcode='22023'; end if;
    for entry in select value from pg_catalog.jsonb_array_elements(expected_value) loop
      label_id:=(entry->>'id')::uuid;
      select count(*) into n from public.document_generation_inventory i
      where i.document_id=doc and i.index_generation_id=member.index_generation_id
        and i.family='generated_labels' and i.disposition='retained'
        and i.artifact_ref->>'tag'='candidate_projection'
        and i.artifact_ref->>'slot'='generated_labels' and i.artifact_ref->>'itemId'=label_id::text;
      if n=1 then
        dep:=public.shadow_eval_result_candidate_unit_v1(p_guard,doc,'label',label_id,'generated_labels',label_id);
        refs:=refs||pg_catalog.jsonb_build_array(dep.artifact_ref);rels:=rels||dep.relationships;
      elsif n=0 then
        refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,'document_labels','label',label_id,doc));
        graph:=public.shadow_eval_result_origin_graph_v1(p_guard,doc,'document_labels','label',label_id);
        refs:=refs||(graph->'refs');rels:=rels||(graph->'relationships');
      else raise exception 'shadow_eval_result_label_population' using errcode='22023';
      end if;
    end loop;
    if (case when p_operation='text_chunks' then p_row->'document_summary' else p_row->'summary' end) is distinct from 'null'::jsonb then
      dep:=public.shadow_eval_result_candidate_unit_v1(p_guard,doc,'summary',doc,'summary',null);
      refs:=refs||pg_catalog.jsonb_build_array(dep.artifact_ref);rels:=rels||dep.relationships;
    end if;
  end if;
  if side='candidate' then
    for entry in select distinct value from pg_catalog.jsonb_array_elements(rels) loop
      select count(*) into n from public.document_generation_inventory i
      where i.document_id=doc and i.index_generation_id=member.index_generation_id
        and i.family=entry->'target'->>'family' and i.unit_key=entry->'target'->>'key'
        and i.disposition='retained' and i.artifact_ref is not null;
      if n<>1 then raise exception 'shadow_eval_result_relationship_target' using errcode='22023'; end if;
      select * into strict dep from public.document_generation_inventory i
      where i.document_id=doc and i.index_generation_id=member.index_generation_id
        and i.family=entry->'target'->>'family' and i.unit_key=entry->'target'->>'key'
        and i.disposition='retained' and i.artifact_ref is not null;
      refs:=refs||pg_catalog.jsonb_build_array(dep.artifact_ref);
    end loop;
  end if;  select coalesce(pg_catalog.jsonb_agg(value order by public.shadow_node_value_text_v1(value)),'[]'::jsonb)
    into refs from (select distinct value from pg_catalog.jsonb_array_elements(refs)) dedup;
  select coalesce(pg_catalog.jsonb_agg(value order by public.shadow_node_value_text_v1(value)),'[]'::jsonb)
    into rels from (select distinct value from pg_catalog.jsonb_array_elements(rels)) dedup;
  return pg_catalog.jsonb_build_object('part',p_part,'index',p_index,'view',view_value,'refs',refs,'relationships',rels);
exception when others then
  if sqlerrm like 'shadow_eval_%' then raise; end if;
  raise exception 'shadow_eval_result_occurrence' using errcode='22023';
end $$;
alter function public.shadow_eval_result_occurrence_v1(jsonb,text,text,integer,jsonb) owner to postgres;
revoke all on function public.shadow_eval_result_occurrence_v1(jsonb,text,text,integer,jsonb) from public,anon,authenticated,service_role;

create or replace function public.shadow_eval_result_aggregate_refs_v1(p_guard jsonb,p_operation text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare side text:=p_guard->>'side';refs jsonb:='[]'::jsonb;doc uuid;
  origin jsonb:=public.shadow_eval_result_origin_v1(p_guard);e jsonb;
  u public.document_generation_inventory%rowtype;a public.rag_aliases%rowtype;s jsonb;
begin
  if p_operation not in ('corpus_terms','correct_terms')
  then raise exception 'shadow_eval_result_aggregate' using errcode='22023'; end if;
  for doc in
    select d.id from public.shadow_eval_documents_v1(p_guard) d
    where d.status='indexed' and (p_operation='corpus_terms' or d.owner_id is null)
    order by d.id
  loop
    s:=public.shadow_eval_result_binding_v1(p_guard,doc);
    refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,'documents','document',doc,doc));
    if side='candidate' then
      u:=public.shadow_eval_result_candidate_unit_v1(p_guard,doc,'document',doc,'worker_metadata',null);
      refs:=refs||pg_catalog.jsonb_build_array(u.artifact_ref);
      refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_projection_ref_v1(p_guard,doc,'document_counts',null));
    end if;
    if p_operation='corpus_terms' then
      if side='baseline' then
        for e in select x.value from pg_catalog.jsonb_array_elements(origin->'rows'->'document_chunks') x(value)
          where (x.value->>'canonicalPayload')::jsonb->>'document_id'=doc::text
            and public.shadow_eval_generation_matches_v1(
              p_guard,doc,((x.value->>'canonicalPayload')::jsonb->>'index_generation_id')::uuid,'chunks')
          order by x.value->>'digest'
        loop refs:=refs||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'tag','origin_row','owner','chunk','rowId',((e->>'canonicalPayload')::jsonb->>'id')::uuid,'rowDigest',e->'digest')); end loop;
      else
        for u in select * from public.document_generation_inventory
          where document_id=doc and index_generation_id=(p_guard->>'candidateGenerationId')::uuid
            and family='chunks' and disposition='retained' and artifact_ref->>'tag'='candidate_row'
          order by unit_key collate "C"
        loop refs:=refs||pg_catalog.jsonb_build_array(u.artifact_ref); end loop;
      end if;
    end if;
  end loop;
  if p_operation='correct_terms' then
    for a in select * from public.shadow_eval_aliases_v1(p_guard)
      where enabled and owner_id is null order by id
    loop
      if a.metadata->>'document_id' is not null then doc:=(a.metadata->>'document_id')::uuid;
      else
        select d.value::uuid into strict doc
        from pg_catalog.jsonb_array_elements_text(p_guard->'documentIds') with ordinality d(value,ord)
        join pg_catalog.jsonb_array_elements(p_guard->'sourceBindings') b(value) on b.value->>'documentId'=d.value
        where exists(select 1 from pg_catalog.jsonb_array_elements_text(b.value->'manualAliasIds') m(value) where m.value=a.id::text)
        order by d.ord limit 1;
      end if;
      perform public.shadow_eval_result_binding_v1(p_guard,doc);
      if side='baseline' or a.metadata->>'generated_by' is distinct from 'local-worker' then
        refs:=refs||pg_catalog.jsonb_build_array(public.shadow_eval_result_origin_ref_v1(p_guard,'rag_aliases','alias',a.id,doc));
      else
        u:=public.shadow_eval_result_candidate_unit_v1(p_guard,doc,'alias',a.id,'producer_aliases',a.id);
        refs:=refs||pg_catalog.jsonb_build_array(u.artifact_ref);
      end if;
    end loop;
  end if;
  select coalesce(pg_catalog.jsonb_agg(value order by public.shadow_node_value_text_v1(value)),'[]'::jsonb)
    into refs from (select distinct value from pg_catalog.jsonb_array_elements(refs)) dedup;
  return refs;
end $$;
alter function public.shadow_eval_result_aggregate_refs_v1(jsonb,text) owner to postgres;
revoke all on function public.shadow_eval_result_aggregate_refs_v1(jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.shadow_eval_result_v1(p_guard jsonb,p_result jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare op text:=p_guard->>'operation';sources jsonb:='[]'::jsonb;r jsonb;ord bigint;call_value jsonb:=p_guard->'call';
  payload jsonb;refs jsonb;request_payload jsonb;
begin
  begin request_payload:=(p_guard->'requestEnvelope'->>'canonicalPayload')::jsonb;
  exception when others then raise exception 'invalid_shadow_eval_result_guard' using errcode='22023'; end;
  if pg_catalog.jsonb_typeof(p_guard) is distinct from 'object'
    or (p_guard->>'side' in ('baseline','candidate')) is not true
    or pg_catalog.jsonb_typeof(p_guard->'documentIds') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_guard->'sourceBindings') is distinct from 'array'
    or pg_catalog.jsonb_typeof(call_value) is distinct from 'object' or call_value->>'operation' is distinct from op
    or p_guard->'requestEnvelope'->>'domain' is distinct from 'u04-evaluation-request-v1'
    or request_payload->>'kind' is distinct from 'u04-evaluation-request-v1'
    or pg_catalog.jsonb_typeof(p_guard->'requestEnvelope'->'digest') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_guard->'observedAt') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_guard->'observedOriginEnvelope') is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_guard->'controls') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_guard->'environment'->'reviewedEnvironmentDigest') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_guard->'environment'->'operation') is distinct from 'object'
    or p_guard->'environment'->'operation'->>'operation' is distinct from op
    or (op in ('aliases','corpus_terms','correct_terms','text_chunks','hybrid_chunks','vector_chunks',
      'lookup_chunks','lookup_chunk_terms','lookup_chunk_prefix','lookup_documents','lookup_document_terms',
      'table_facts','embedding_fields','index_units','memory_cards_hybrid','memory_cards_lexical',
      'chunks_by_ids','chunks_by_indexes','documents','ranking_metadata','related_documents','quality',
      'images_by_ids','images_by_pages','visual_rows','adjacent_chunks')) is not true
  then raise exception 'invalid_shadow_eval_result_guard' using errcode='22023'; end if;
  if p_guard->>'side'='baseline' and
    (p_guard->'candidateGenerationId' is distinct from 'null'::jsonb or p_guard->'controls' is distinct from '[]'::jsonb)
  then raise exception 'invalid_shadow_eval_result_guard' using errcode='22023'; end if;
  if p_guard->>'side'='candidate' and
    (pg_catalog.jsonb_typeof(p_guard->'candidateGenerationId') is distinct from 'string'
      or pg_catalog.jsonb_array_length(p_guard->'controls')<>pg_catalog.jsonb_array_length(p_guard->'documentIds'))
  then raise exception 'invalid_shadow_eval_result_guard' using errcode='22023'; end if;

  if op='correct_terms' then
    if pg_catalog.jsonb_typeof(p_result) is distinct from 'string' then raise exception 'invalid_shadow_eval_result_shape'; end if;
    if pg_catalog.length(pg_catalog.btrim(call_value->'originalArguments'->>'input_query'))=0
      or not exists(select 1 from pg_catalog.unnest(pg_catalog.regexp_split_to_array(
        pg_catalog.lower(call_value->'originalArguments'->>'input_query'),'\s+')) token
        where pg_catalog.length(token)>=4)
    then refs:='[]'::jsonb;
    else refs:=public.shadow_eval_result_aggregate_refs_v1(p_guard,op);
    end if;
    sources:=pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'part','value','index',null,'view',null,'refs',refs,'relationships','[]'::jsonb));
  elsif op='aliases' then
    if pg_catalog.jsonb_typeof(p_result) is distinct from 'object'
      or (select array_agg(key order by key) from pg_catalog.jsonb_object_keys(p_result) key)
        is distinct from array['ownerRows','publicRows']::text[]
      or pg_catalog.jsonb_typeof(p_result->'ownerRows') is distinct from 'array'
      or pg_catalog.jsonb_typeof(p_result->'publicRows') is distinct from 'array'
    then raise exception 'invalid_shadow_eval_result_shape'; end if;
    for r,ord in select value,n-1 from pg_catalog.jsonb_array_elements(p_result->'ownerRows') with ordinality x(value,n)
    loop sources:=sources||pg_catalog.jsonb_build_array(public.shadow_eval_result_occurrence_v1(p_guard,op,'ownerRows',ord::integer,r)); end loop;
    for r,ord in select value,n-1 from pg_catalog.jsonb_array_elements(p_result->'publicRows') with ordinality x(value,n)
    loop sources:=sources||pg_catalog.jsonb_build_array(public.shadow_eval_result_occurrence_v1(p_guard,op,'publicRows',ord::integer,r)); end loop;
  else
    if pg_catalog.jsonb_typeof(p_result) is distinct from 'array' then raise exception 'invalid_shadow_eval_result_shape'; end if;
    if op='corpus_terms' then
      refs:=public.shadow_eval_result_aggregate_refs_v1(p_guard,op);
      for r,ord in select value,n-1 from pg_catalog.jsonb_array_elements(p_result) with ordinality x(value,n) loop
        if pg_catalog.jsonb_typeof(r) is distinct from 'object' then raise exception 'invalid_shadow_eval_result_shape'; end if;
        sources:=sources||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'part','rows','index',ord,'view',null,'refs',refs,'relationships','[]'::jsonb));
      end loop;
    else
      for r,ord in select value,n-1 from pg_catalog.jsonb_array_elements(p_result) with ordinality x(value,n)
      loop sources:=sources||pg_catalog.jsonb_build_array(public.shadow_eval_result_occurrence_v1(p_guard,op,'rows',ord::integer,r)); end loop;
    end if;
  end if;
  if pg_catalog.jsonb_array_length(p_guard->'documentIds')=0 and sources is distinct from '[]'::jsonb
    and op not in ('corpus_terms','correct_terms')
  then raise exception 'shadow_eval_result_empty_scope' using errcode='22023'; end if;

  payload:=pg_catalog.jsonb_build_object(
    'kind','u04-evaluation-read-result-v1','version',1,'operation',op,
    'requestDigest',p_guard->'requestEnvelope'->'digest','call',call_value,'observedAt',p_guard->'observedAt',
    'guard',pg_catalog.jsonb_build_object('mode','same_statement_logical_equality',
      'observedOriginEnvelope',p_guard->'observedOriginEnvelope','controls',p_guard->'controls'),
    'environment',pg_catalog.jsonb_build_object('reviewedEnvironmentDigest',
      p_guard->'environment'->'reviewedEnvironmentDigest','operation',p_guard->'environment'->'operation'),
    'result',p_result,'sources',sources);
  return public.shadow_pg_bundle_v1(payload,'evaluation_report');
exception when others then
  if sqlerrm like 'shadow_eval_%' or sqlerrm like 'invalid_shadow_eval_%' then raise; end if;
  raise exception 'invalid_shadow_eval_result' using errcode='22023';
end $$;
alter function public.shadow_eval_result_v1(jsonb,jsonb) owner to postgres;
revoke all on function public.shadow_eval_result_v1(jsonb,jsonb) from public,anon,authenticated,service_role;

-- U04 final source-only correction: candidate pages remain invisible to active publication state,
-- and only the completed service mutation entrypoints become callable. This authors repository
-- state only; it does not execute SQL, grant live privileges, or activate a wave.
create or replace function public.document_publication_state_digest(
  p_document_id uuid,
  p_expected_owner_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'document', to_jsonb(d) - array['owner_id', 'created_at', 'updated_at', 'search_tsv', 'title_search_tsv'],
          'pages', coalesce((select jsonb_agg(to_jsonb(p) - array['created_at', 'updated_at'] order by p.page_number, p.id) from public.document_pages p where p.document_id = d.id and public.is_committed_document_generation(p.index_generation_id, d.index_generation_id)), '[]'::jsonb),
          'images', coalesce((select jsonb_agg(to_jsonb(i) - array['created_at', 'updated_at'] order by i.page_number nulls last, i.id) from public.document_images i where i.document_id = d.id and public.is_committed_artifact_generation(i.metadata, d.metadata)), '[]'::jsonb),
          'labels', coalesce((select jsonb_agg(to_jsonb(l) - array['owner_id', 'created_at', 'updated_at'] order by l.id) from public.document_labels l where l.document_id = d.id), '[]'::jsonb),
          'summaries', coalesce((select jsonb_agg(to_jsonb(s) - array['owner_id', 'created_at', 'updated_at'] order by s.id) from public.document_summaries s where s.document_id = d.id), '[]'::jsonb),
          'sections', coalesce((select jsonb_agg(to_jsonb(s) - array['owner_id', 'created_at', 'updated_at'] order by s.section_index, s.id) from public.document_sections s where s.document_id = d.id and public.is_committed_artifact_generation(s.metadata, d.metadata)), '[]'::jsonb),
          'memory_cards', coalesce((select jsonb_agg(to_jsonb(m) - array['owner_id', 'embedding', 'search_tsv', 'created_at', 'updated_at'] order by m.id) from public.document_memory_cards m where m.document_id = d.id and public.is_committed_artifact_generation(m.metadata, d.metadata)), '[]'::jsonb),
          'chunks', coalesce((select jsonb_agg(to_jsonb(c) - array['embedding', 'search_tsv', 'created_at'] order by c.chunk_index, c.id) from public.document_chunks c where c.document_id = d.id and (public.is_committed_document_generation(c.index_generation_id, d.index_generation_id) or public.is_committed_artifact_generation(c.metadata, d.metadata))), '[]'::jsonb),
          'table_facts', coalesce((select jsonb_agg(to_jsonb(f) - array['owner_id', 'search_tsv', 'created_at'] order by f.id) from public.document_table_facts f where f.document_id = d.id and public.is_committed_artifact_generation(f.metadata, d.metadata)), '[]'::jsonb),
          'embedding_fields', coalesce((select jsonb_agg(to_jsonb(f) - array['owner_id', 'embedding', 'search_tsv', 'created_at'] order by f.id) from public.document_embedding_fields f where f.document_id = d.id and public.is_committed_artifact_generation(f.metadata, d.metadata)), '[]'::jsonb),
          'index_quality', coalesce((select to_jsonb(q) - array['owner_id', 'updated_at'] from public.document_index_quality q where q.document_id = d.id), '{}'::jsonb),
          'index_units', coalesce((select jsonb_agg(to_jsonb(u) - array['owner_id', 'embedding', 'search_tsv', 'created_at', 'updated_at'] order by u.id) from public.document_index_units u where u.document_id = d.id and public.is_committed_artifact_generation(u.metadata, d.metadata)), '[]'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.documents d
  where d.id = p_document_id
    and d.owner_id = p_expected_owner_id;
$$;
alter function public.document_publication_state_digest(uuid,uuid) owner to postgres;
revoke all on function public.document_publication_state_digest(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.document_publication_state_digest(uuid,uuid) to service_role;

grant execute on function public.enqueue_shadow_reindex_generation(jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.write_shadow_generation_inventory(jsonb,uuid,jsonb,jsonb) to service_role;
grant execute on function public.write_shadow_generation_pages(jsonb,uuid,jsonb) to service_role;
grant execute on function public.persist_shadow_summary_projection(jsonb,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.persist_shadow_quality_projection(jsonb,uuid,jsonb,jsonb) to service_role;
grant execute on function public.persist_shadow_deep_memory_projection(jsonb,uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.persist_shadow_worker_projection(jsonb,uuid,jsonb,jsonb,jsonb) to service_role;
