-- Consolidate public-source serving, lifecycle, replacement, and cache authority.
-- Source-only migration: applying it and operating acquisition remain separate approvals.

alter table public.public_source_activation_events
  add column source_sequence bigint;

alter table public.public_source_activation_events disable trigger public_source_activation_events_immutable;
with numbered as (
  select id, row_number() over (
    partition by source_catalogue_key order by created_at, id
  )::bigint as source_sequence
  from public.public_source_activation_events
)
update public.public_source_activation_events event
set source_sequence = numbered.source_sequence
from numbered
where numbered.id = event.id;
alter table public.public_source_activation_events enable trigger public_source_activation_events_immutable;

alter table public.public_source_activation_events
  alter column source_sequence set not null;
alter table public.public_source_activation_events
  add constraint public_source_activation_events_source_sequence_key
  unique (source_catalogue_key, source_sequence);

alter table public.public_source_versions
  drop constraint if exists public_source_versions_lifecycle_check;
alter table public.public_source_versions
  add constraint public_source_versions_lifecycle_check
  check (lifecycle in ('discovered', 'shadow', 'approved', 'active', 'superseded', 'quarantined', 'tombstoned'));
alter table public.public_source_versions
  add column if not exists acquisition_identity_digest text
  check (acquisition_identity_digest is null or acquisition_identity_digest ~ '^sha256:[0-9a-f]{64}$');

create or replace function public.guard_public_source_version_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array[
        'lifecycle', 'extraction_generation_id', 'index_generation_id',
        'publication_approval_id', 'publication_manifest_digest',
        'publication_reviewed_state_digest', 'publication_reviewed_index_generation_id',
        'acquisition_identity_digest', 'updated_at'
      ]) is distinct from (to_jsonb(old) - array[
        'lifecycle', 'extraction_generation_id', 'index_generation_id',
        'publication_approval_id', 'publication_manifest_digest',
        'publication_reviewed_state_digest', 'publication_reviewed_index_generation_id',
        'acquisition_identity_digest', 'updated_at'
      ])
     or (old.acquisition_identity_digest is not null
       and new.acquisition_identity_digest is distinct from old.acquisition_identity_digest)
  then raise exception 'public source version identity is immutable'; end if;
  return new;
end;
$$;

create table public.public_source_serving_authority (
  singleton boolean primary key default true check (singleton),
  lifecycle_epoch bigint not null default 1 check (lifecycle_epoch > 0),
  updated_at timestamptz not null default now()
);
insert into public.public_source_serving_authority(singleton) values (true)
on conflict (singleton) do nothing;
alter table public.public_source_serving_authority enable row level security;
revoke all on table public.public_source_serving_authority from public, anon, authenticated;
grant select on table public.public_source_serving_authority to service_role;

create or replace function public.bump_public_source_serving_authority()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_epoch bigint;
begin
  update public.public_source_serving_authority
  set lifecycle_epoch = lifecycle_epoch + 1, updated_at = pg_catalog.clock_timestamp()
  where singleton
  returning lifecycle_epoch into v_epoch;
  return v_epoch;
end;
$$;

create or replace function public.activate_public_source_version(p_activation jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_version public.public_source_versions%rowtype;
  v_new_version public.public_source_versions%rowtype;
  v_document public.documents%rowtype;
  v_approval public.document_publication_approvals%rowtype;
  v_old_version_id uuid;
  v_new_version_id uuid;
  v_approval_id uuid;
  v_reviewed_generation_id uuid;
  v_current_digest text;
begin
  begin
    v_old_version_id := (p_activation->>'expectedOldVersionId')::uuid;
    v_new_version_id := (p_activation->>'newVersionId')::uuid;
    v_approval_id := (p_activation->>'publicationApprovalId')::uuid;
    v_reviewed_generation_id := (p_activation->>'reviewedIndexGenerationId')::uuid;
  exception when invalid_text_representation then raise exception 'Public source activation identity is invalid'; end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public_source_lifecycle:' || coalesce(p_activation->>'catalogueKey', ''), 0)
  );
  select * into v_old_version from public.public_source_versions
    where id = v_old_version_id for update;
  if not found or v_old_version.source_catalogue_key is distinct from p_activation->>'catalogueKey'
     or v_old_version.lifecycle is distinct from 'active'
     or v_old_version.exact_version_url is distinct from p_activation->>'expectedOldExactVersionUrl'
     or v_old_version.content_hash is distinct from p_activation->>'expectedOldContentHash'
  then raise exception 'Public source activation old-version identity mismatch'; end if;

  select * into v_new_version from public.public_source_versions
    where id = v_new_version_id for update;
  if not found or v_new_version.source_catalogue_key is distinct from p_activation->>'catalogueKey'
     or v_new_version.lifecycle is distinct from 'approved'
     or v_new_version.exact_version_url is distinct from p_activation->>'newExactVersionUrl'
     or v_new_version.content_hash is distinct from p_activation->>'newContentHash'
     or v_new_version.supersedes_version_id is distinct from v_old_version.id
  then raise exception 'Public source activation new-version identity mismatch'; end if;

  select * into v_document from public.documents
    where id = v_new_version.staging_document_id for update;
  select * into v_approval from public.document_publication_approvals
    where id = v_approval_id and document_id = v_document.id
      and expected_prior_owner_id = v_new_version.staging_owner_id
      and decision = 'approved'
      and source_catalogue_key = v_new_version.source_catalogue_key
      and source_policy_version = v_new_version.source_policy_version
      and reviewed_index_generation_id = v_reviewed_generation_id
      and reviewed_state_digest = p_activation->>'reviewedStateDigest'
      and manifest_digest = p_activation->>'manifestDigest'
    for share;
  v_current_digest := public.public_source_acquisition_identity_digest(v_new_version.id);
  if not found
     or v_current_digest is distinct from v_new_version.acquisition_identity_digest
     or v_current_digest is distinct from p_activation->>'expectedAcquisitionIdentityDigest'
     or v_document.index_generation_id is distinct from v_approval.reviewed_index_generation_id
     or public.document_publication_state_digest(v_document.id, v_new_version.staging_owner_id)
       is distinct from v_approval.reviewed_state_digest
     or v_document.metadata->>'source_catalogue_key' is distinct from v_new_version.source_catalogue_key
     or v_document.metadata->>'source_policy_version' is distinct from v_new_version.source_policy_version
     or v_document.metadata->>'source_policy_digest' is distinct from v_new_version.source_policy_digest
     or v_document.metadata->>'source_activation_event_id' is distinct from v_new_version.activation_event_id::text
     or v_document.metadata->>'source_canonical_url' is distinct from v_new_version.exact_canonical_url
     or v_document.metadata->>'source_exact_url' is distinct from v_new_version.exact_version_url
     or v_document.metadata->>'source_exact_version' is distinct from v_new_version.exact_version
     or v_document.metadata->>'source_content_hash' is distinct from v_new_version.content_hash
     or v_document.metadata->>'content_hash' is distinct from v_new_version.staged_content_hash
     or v_document.metadata->>'licence_evidence_digest' is distinct from v_new_version.licence_evidence_digest
     or v_document.metadata->>'content_identity_verdict' is distinct from 'clear'
     or v_document.metadata->>'content_identity_hash' is distinct from v_new_version.staged_content_hash
     or v_document.metadata->>'content_identity_verdict_version' is distinct from 'public-source-content-identity-v1'
  then raise exception 'Public source acquisition identity changed after review'; end if;

  -- Retire first and publish second inside this transaction: no committed gap or dual serving state exists.
  perform public.make_public_source_version_ineligible(v_old_version.id);
  update public.public_source_versions
    set lifecycle = 'superseded', updated_at = now()
    where id = v_old_version.id;
  update public.public_source_versions
    set lifecycle = 'active', publication_approval_id = v_approval.id,
        publication_manifest_digest = v_approval.manifest_digest,
        publication_reviewed_state_digest = v_approval.reviewed_state_digest,
        publication_reviewed_index_generation_id = v_approval.reviewed_index_generation_id,
        updated_at = now()
    where id = v_new_version.id;

  update public.document_labels set owner_id = null, updated_at = now() where document_id = v_document.id;
  update public.document_summaries set owner_id = null, updated_at = now() where document_id = v_document.id;
  update public.document_sections set owner_id = null, updated_at = now() where document_id = v_document.id;
  update public.document_memory_cards set owner_id = null, updated_at = now() where document_id = v_document.id;
  update public.document_table_facts set owner_id = null where document_id = v_document.id;
  update public.document_embedding_fields set owner_id = null where document_id = v_document.id;
  update public.document_index_quality set owner_id = null, updated_at = now() where document_id = v_document.id;
  update public.document_index_units set owner_id = null, updated_at = now() where document_id = v_document.id;
  update public.documents
    set owner_id = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'public_corpus', true, 'public_source_lifecycle', 'active',
          'publication_approval_id', v_approval.id,
          'publication_manifest_digest', v_approval.manifest_digest,
          'publication_reviewed_state_digest', v_approval.reviewed_state_digest,
          'publication_reviewed_index_generation_id', v_approval.reviewed_index_generation_id
        ),
        updated_at = now()
    where id = v_document.id;
  delete from public.rag_response_cache where owner_id is null and cache_kind in ('search', 'answer');
  perform public.bump_public_source_serving_authority();
  return jsonb_build_object('oldVersionId', v_old_version.id, 'oldLifecycle', 'superseded',
    'newVersionId', v_new_version.id, 'newLifecycle', 'active');
end;
$$;

create or replace function public.record_unchanged_public_source_check(p_check jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_version public.public_source_versions%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public_source_lifecycle:' || coalesce(p_check->>'expectedCatalogueKey', ''), 0)
  );
  select * into v_version from public.public_source_versions
    where id = (p_check->>'expectedVersionId')::uuid for update;
  if not found or v_version.lifecycle <> 'active'
     or v_version.source_catalogue_key is distinct from p_check->>'expectedCatalogueKey'
     or v_version.exact_version_url is distinct from p_check->>'expectedExactVersionUrl'
     or v_version.exact_version is distinct from p_check->>'expectedExactVersion'
     or v_version.content_hash is distinct from p_check->>'expectedContentHash'
     or p_check->>'outcome' is distinct from 'unchanged'
  then raise exception 'Public source unchanged identity mismatch'; end if;
  insert into public.audit_logs(owner_id, action, resource_type, resource_id, metadata)
  values (v_version.staging_owner_id, 'public_source_change_checked', 'public_source_version',
    v_version.id::text, jsonb_build_object('catalogue_key', v_version.source_catalogue_key, 'outcome', 'unchanged'));
  return jsonb_build_object('outcome', 'unchanged', 'versionId', v_version.id);
exception when invalid_text_representation then
  raise exception 'Public source unchanged identity mismatch';
end;
$$;

create or replace function public.transition_public_source_version(
  p_version_id uuid, p_expected_catalogue_key text, p_expected_exact_version_url text,
  p_expected_content_hash text, p_expected_lifecycle text, p_new_lifecycle text,
  p_activation_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_version public.public_source_versions%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'public_source_lifecycle:' || p_expected_catalogue_key, 0));
  select * into v_version from public.public_source_versions where id = p_version_id for update;
  if not found or v_version.source_catalogue_key is distinct from p_expected_catalogue_key
     or v_version.exact_version_url is distinct from p_expected_exact_version_url
     or v_version.content_hash is distinct from p_expected_content_hash
     or v_version.lifecycle is distinct from p_expected_lifecycle
  then raise exception 'Public source version identity changed after review'; end if;
  if p_new_lifecycle = 'active' then
    raise exception 'Public source activation requires activate_public_source_version atomic swap';
  end if;
  if p_new_lifecycle not in ('approved', 'quarantined', 'tombstoned') then
    raise exception 'Invalid public source lifecycle transition';
  end if;
  if v_version.lifecycle = 'active' then perform public.make_public_source_version_ineligible(v_version.id); end if;
  update public.public_source_versions set lifecycle = p_new_lifecycle, updated_at = now() where id = v_version.id;
  return jsonb_build_object('versionId', v_version.id, 'lifecycle', p_new_lifecycle);
end;
$$;

create or replace function public.tombstone_public_source_version_for_review(
  p_version_id uuid, p_expected_catalogue_key text, p_expected_exact_version_url text,
  p_expected_exact_version text, p_expected_content_hash text, p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_version public.public_source_versions%rowtype;
begin
  if p_reason_code not in ('publisher_http_404', 'publisher_http_410') then
    raise exception 'Public source withdrawal reason code is invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'public_source_lifecycle:' || p_expected_catalogue_key, 0));
  select * into v_version from public.public_source_versions where id = p_version_id for update;
  if not found or v_version.lifecycle not in ('active', 'tombstoned')
     or v_version.source_catalogue_key is distinct from p_expected_catalogue_key
     or v_version.exact_version_url is distinct from p_expected_exact_version_url
     or v_version.exact_version is distinct from p_expected_exact_version
     or v_version.content_hash is distinct from p_expected_content_hash
  then raise exception 'Public source current active identity mismatch'; end if;
  if v_version.lifecycle = 'active' then
    perform public.make_public_source_version_ineligible(v_version.id);
    update public.public_source_versions set lifecycle = 'tombstoned', updated_at = now() where id = v_version.id;
  end if;
  insert into public.audit_logs(owner_id, action, resource_type, resource_id, metadata)
  select v_version.staging_owner_id, 'public_source_withdrawal_review_required',
    'public_source_version', v_version.id::text,
    jsonb_build_object('catalogue_key', v_version.source_catalogue_key,
      'exact_version', v_version.exact_version, 'reason_code', p_reason_code,
      'review_status', 'pending_human_review')
  where not exists (select 1 from public.audit_logs where action = 'public_source_withdrawal_review_required'
    and resource_type = 'public_source_version' and resource_id = v_version.id::text);
  return jsonb_build_object('outcome', 'tombstoned', 'reviewQueued', true);
end;
$$;

-- Retrieval-owner inventory. These service-role RPCs all read owner-null rows; the immediate
-- public_source_documents_require_active_version constraint makes the exact active version a
-- transactional prerequisite for every one, including their metadata/topic fallback layers.
-- retrieval-owner: match_document_chunks_text_v2
-- retrieval-owner: match_document_chunks_hybrid_v2
-- retrieval-owner: match_document_chunks_v2
-- retrieval-owner: get_related_document_metadata_v2
-- retrieval-owner: match_document_lookup_chunks_text_v2
-- retrieval-owner: match_documents_for_query_v2
-- retrieval-owner: match_document_table_facts_text_v2
-- retrieval-owner: match_document_embedding_fields_hybrid_v2
-- retrieval-owner: match_document_index_units_hybrid_v2
-- retrieval-owner: match_document_memory_cards_hybrid_v3

create or replace function public.public_source_serving_authority_stamp()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lifecycle_epoch::text
  from public.public_source_serving_authority
  where singleton;
$$;

create or replace function public.public_source_document_is_serving_eligible(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when document.metadata->>'source_catalogue_key' is null then true
    else exists (
      select 1
      from public.public_source_versions version
      where version.staging_document_id = p_document_id
        and version.source_catalogue_key = document.metadata->>'source_catalogue_key'
        and version.lifecycle = 'active'
        and document.owner_id is null
    )
  end
  from public.documents document
  where document.id = p_document_id;
$$;

create or replace function public.require_active_public_source_version_for_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is null
     and new.metadata->>'source_catalogue_key' is not null
     and not exists (
       select 1
       from public.public_source_versions version
       where version.lifecycle = 'active'
         and version.staging_document_id = new.id
         and version.source_catalogue_key = new.metadata->>'source_catalogue_key'
     )
  then
    raise exception 'Catalogue-tagged public document requires its exact active public source version';
  end if;
  return new;
end;
$$;

drop trigger if exists public_source_documents_require_active_version on public.documents;
create constraint trigger public_source_documents_require_active_version
after insert or update on public.documents
deferrable initially immediate
for each row execute function public.require_active_public_source_version_for_publication();

create or replace function public.guard_document_publication_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_approval public.document_publication_approvals%rowtype;
  v_approval_id uuid;
  v_reviewed_state_digest text;
  v_old_australian_public boolean;
  v_new_australian_public boolean;
  v_old_reviewed_document jsonb;
  v_new_reviewed_document jsonb;
  v_old_reviewed_metadata jsonb;
  v_new_reviewed_metadata jsonb;
  v_exit_version public.public_source_versions%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.owner_id is null then
      raise exception 'public documents must be created as owned rows before approved publication';
    end if;
    return new;
  end if;
  v_old_australian_public := coalesce(old.metadata->>'corpus_scope' = 'australian_public', false);
  v_new_australian_public := coalesce(new.metadata->>'corpus_scope' = 'australian_public', false);
  v_old_reviewed_document := to_jsonb(old) - array[
    'owner_id', 'updated_at', 'metadata', 'search_tsv', 'title_search_tsv', 'index_generation_id'
  ];
  v_new_reviewed_document := to_jsonb(new) - array[
    'owner_id', 'updated_at', 'metadata', 'search_tsv', 'title_search_tsv', 'index_generation_id'
  ];

  if old.owner_id is not null and new.owner_id is null then
    v_old_reviewed_metadata := coalesce(old.metadata, '{}'::jsonb) - array[
      'public_corpus', 'publication_approval_id', 'publication_manifest_digest',
      'publication_reviewed_state_digest', 'publication_source_catalogue_key',
      'publication_source_policy_version', 'publication_reviewed_index_generation_id', 'published_at',
      'public_source_lifecycle'
    ];
    v_new_reviewed_metadata := coalesce(new.metadata, '{}'::jsonb) - array[
      'public_corpus', 'publication_approval_id', 'publication_manifest_digest',
      'publication_reviewed_state_digest', 'publication_source_catalogue_key',
      'publication_source_policy_version', 'publication_reviewed_index_generation_id', 'published_at',
      'public_source_lifecycle'
    ];
    if (v_new_australian_public and not v_old_australian_public)
       or v_new_reviewed_document is distinct from v_old_reviewed_document
       or v_new_reviewed_metadata is distinct from v_old_reviewed_metadata
    then raise exception 'public document target reviewed state changed during publication'; end if;
    begin v_approval_id := nullif(new.metadata->>'publication_approval_id', '')::uuid;
    exception when invalid_text_representation then raise exception 'public document transition approval is invalid'; end;
    v_reviewed_state_digest := lower(coalesce(new.metadata->>'publication_reviewed_state_digest', ''));
    select * into v_approval from public.document_publication_approvals approval
    where approval.id = v_approval_id and approval.document_id = old.id
      and approval.expected_prior_owner_id = old.owner_id and approval.decision = 'approved'
      and approval.manifest_digest = new.metadata->>'publication_manifest_digest'
      and approval.reviewed_state_digest = v_reviewed_state_digest
      and approval.reviewed_index_generation_id = new.index_generation_id
      and approval.source_catalogue_key = new.metadata->>'source_catalogue_key'
      and approval.source_policy_version = new.metadata->>'source_policy_version';
    if not found
       or public.document_publication_state_digest(old.id, old.owner_id) is distinct from v_reviewed_state_digest
       or new.metadata->>'content_mode' is distinct from 'indexed_content'
       or new.metadata->>'licence_policy' is distinct from 'public_index_permitted'
       or new.metadata->>'document_status' is distinct from 'current'
       or coalesce(new.metadata->>'change_state', '') not in ('unchanged', 'changed')
       or nullif(btrim(coalesce(new.metadata->>'superseded_by_document_id', '')), '') is not null
    then raise exception 'public document transition approval does not match reviewed state'; end if;
  elsif old.owner_id is null and new.owner_id is not null and v_old_australian_public then
    begin
      select * into v_exit_version from public.public_source_versions version
      where version.id = nullif(pg_catalog.current_setting('app.public_source_lifecycle_exit', true), '')::uuid
        and version.staging_document_id = old.id and version.staging_owner_id = new.owner_id
      for update;
    exception when invalid_text_representation then
      raise exception 'Australian public reviewed state is immutable after activation';
    end;
    if not found then raise exception 'Australian public reviewed state is immutable after activation'; end if;
  elsif old.owner_id is null and new.owner_id is null and (v_old_australian_public or v_new_australian_public) then
    if not (v_old_australian_public and v_new_australian_public)
       or v_new_reviewed_document is distinct from v_old_reviewed_document
       or new.metadata is distinct from old.metadata
    then raise exception 'Australian public reviewed state is immutable after activation'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.public_source_acquisition_identity_digest(p_version_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version public.public_source_versions%rowtype;
  v_document public.documents%rowtype;
begin
  select * into strict v_version from public.public_source_versions where id = p_version_id;
  select * into strict v_document from public.documents where id = v_version.staging_document_id;
  return 'sha256:' || encode(extensions.digest(convert_to(
    jsonb_build_object(
      'source_policy_digest', v_version.source_policy_digest,
      'activation_event_id', v_version.activation_event_id,
      'exact_canonical_url', v_version.exact_canonical_url,
      'exact_version_url', v_version.exact_version_url,
      'exact_version', v_version.exact_version,
      'content_hash', v_version.content_hash,
      'staged_content_hash', v_version.staged_content_hash,
      'licence_evidence_digest', v_version.licence_evidence_digest,
      'source_content_type', v_document.metadata->>'source_content_type',
      'source_content_byte_length', v_document.metadata->>'source_content_byte_length',
      'content_identity_verdict', v_document.metadata->>'content_identity_verdict',
      'content_identity_hash', v_document.metadata->>'content_identity_hash',
      'content_identity_verdict_version', v_document.metadata->>'content_identity_verdict_version',
      'canonical_storage_path', v_document.metadata->>'canonical_storage_path',
      'source_policy_version', v_version.source_policy_version,
      'staging_owner_id', v_version.staging_owner_id,
      'target_lifecycle', 'shadow'
    )::text, 'UTF8'), 'sha256'), 'hex');
end;
$$;

create or replace function public.make_public_source_version_ineligible(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_version public.public_source_versions%rowtype;
begin
  select * into strict v_version
  from public.public_source_versions
  where id = p_version_id
  for update;
  perform pg_catalog.set_config('app.public_source_lifecycle_exit', v_version.id::text, true);

  update public.document_labels set owner_id = v_version.staging_owner_id, updated_at = now()
    where document_id = v_version.staging_document_id;
  update public.document_summaries set owner_id = v_version.staging_owner_id, updated_at = now()
    where document_id = v_version.staging_document_id;
  update public.document_sections set owner_id = v_version.staging_owner_id, updated_at = now()
    where document_id = v_version.staging_document_id;
  update public.document_memory_cards set owner_id = v_version.staging_owner_id, updated_at = now()
    where document_id = v_version.staging_document_id;
  update public.document_table_facts set owner_id = v_version.staging_owner_id
    where document_id = v_version.staging_document_id;
  update public.document_embedding_fields set owner_id = v_version.staging_owner_id
    where document_id = v_version.staging_document_id;
  update public.document_index_quality set owner_id = v_version.staging_owner_id, updated_at = now()
    where document_id = v_version.staging_document_id;
  update public.document_index_units set owner_id = v_version.staging_owner_id, updated_at = now()
    where document_id = v_version.staging_document_id;
  update public.documents
  set owner_id = v_version.staging_owner_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'public_corpus', false,
        'public_source_lifecycle', 'superseded'
      ),
      updated_at = now()
  where id = v_version.staging_document_id;
  perform pg_catalog.set_config('app.public_source_lifecycle_exit', '', true);

  delete from public.rag_response_cache
  where owner_id is null and cache_kind in ('search', 'answer');
  perform public.bump_public_source_serving_authority();
end;
$$;

do $$
declare v_version record;
begin
  for v_version in
    select version.id
    from public.public_source_versions version
    join public.documents document on document.id = version.staging_document_id
    where document.owner_id is null and version.lifecycle <> 'active'
    order by version.source_catalogue_key, version.id
  loop
    perform public.make_public_source_version_ineligible(v_version.id);
  end loop;
end;
$$;

create or replace function public.record_public_source_activation_event(p_manifest jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_catalogue_key text := btrim(coalesce(p_manifest->>'catalogueKey', ''));
  v_decision text := btrim(coalesce(p_manifest->>'decision', ''));
  v_operator_id uuid;
  v_sequence bigint;
  v_evidence text[];
begin
  if coalesce(p_manifest->>'version', '') <> '1'
     or v_catalogue_key = ''
     or v_decision not in ('activate', 'quarantine', 'retire')
     or p_manifest->>'sourcePolicyVersion' <> 'australian-source-policy-v1'
     or p_manifest->>'sourcePolicyDigest' <> 'sha256:02dcc095258338d0c355af79dfa1889c024f25f385b553e5b6c802207546855d'
     or btrim(coalesce(p_manifest->>'reason', '')) = ''
  then raise exception 'Invalid public source activation manifest'; end if;
  begin v_operator_id := (p_manifest->>'operatorId')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid public source activation operator'; end;
  select array_agg(value order by ordinal) into v_evidence
  from jsonb_array_elements_text(coalesce(p_manifest->'evidenceReferences', '[]'::jsonb))
    with ordinality evidence(value, ordinal);
  if cardinality(v_evidence) not between 1 and 50 then
    raise exception 'Invalid public source activation evidence';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_catalogue_key, 0));
  perform 1 from public.public_source_activation_events
    where source_catalogue_key = v_catalogue_key
    order by source_sequence desc limit 1 for update;
  select coalesce(max(source_sequence), 0) + 1 into v_sequence
    from public.public_source_activation_events where source_catalogue_key = v_catalogue_key;

  if v_decision in ('quarantine', 'retire') then
    perform public.make_public_source_version_ineligible(id)
    from public.public_source_versions
    where source_catalogue_key = v_catalogue_key and lifecycle = 'active';
    update public.public_source_versions
    set lifecycle = 'quarantined', updated_at = now()
    where source_catalogue_key = v_catalogue_key and lifecycle = 'active';
  end if;

  insert into public.public_source_activation_events(
    source_catalogue_key, source_policy_version, source_policy_digest, decision,
    operator_id, reason, evidence_references, source_sequence
  ) values (
    v_catalogue_key, p_manifest->>'sourcePolicyVersion', p_manifest->>'sourcePolicyDigest',
    v_decision, v_operator_id, btrim(p_manifest->>'reason'), v_evidence, v_sequence
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;

create or replace function public.create_public_source_fetch_manifest(
  p_source_catalogue_key text,
  p_source_policy_version text,
  p_source_policy_digest text,
  p_activation_event_id uuid,
  p_exact_url text,
  p_exact_version text,
  p_licence_evidence_digest text,
  p_staging_owner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_event public.public_source_activation_events%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_source_catalogue_key, 0));
  select * into v_event from public.public_source_activation_events
  where source_catalogue_key = p_source_catalogue_key
  order by source_sequence desc limit 1 for update;
  if not found or v_event.id is distinct from p_activation_event_id or v_event.decision <> 'activate'
     or v_event.source_policy_version is distinct from p_source_policy_version
     or v_event.source_policy_digest is distinct from p_source_policy_digest
  then raise exception 'Only an exact active source definition may create a fetch manifest'; end if;
  if p_exact_url !~ '^https://' or position('#' in p_exact_url) > 0
     or btrim(coalesce(p_exact_version, '')) = ''
     or p_licence_evidence_digest !~ '^sha256:[0-9a-f]{64}$' or p_staging_owner_id is null
  then raise exception 'Public source fetch manifest identity is invalid'; end if;
  return jsonb_build_object(
    'schemaVersion', 'public-source-acquisition-v1', 'sourcePolicyVersion', p_source_policy_version,
    'sourcePolicyDigest', p_source_policy_digest, 'sourceActivationEventId', p_activation_event_id,
    'catalogueKey', p_source_catalogue_key, 'exactUrl', p_exact_url, 'exactVersion', p_exact_version,
    'licenceEvidenceDigest', p_licence_evidence_digest, 'stagingOwnerId', p_staging_owner_id,
    'targetLifecycle', 'shadow'
  );
end;
$$;

create or replace function public.stage_public_source_version(p_version jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.public_source_activation_events%rowtype;
  v_existing public.public_source_versions%rowtype;
  v_document public.documents%rowtype;
  v_document_id uuid;
  v_owner_id uuid;
  v_activation_event_id uuid;
  v_supersedes_version_id uuid;
  v_version_id uuid;
  v_digest text;
begin
  begin
    v_document_id := nullif(p_version->>'stagingDocumentId', '')::uuid;
    v_owner_id := (p_version->>'stagingOwnerId')::uuid;
    v_activation_event_id := (p_version->>'activationEventId')::uuid;
    v_supersedes_version_id := nullif(p_version->>'supersedesVersionId', '')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid public source staging identity'; end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_version->>'catalogueKey', 0));
  select * into v_event from public.public_source_activation_events
    where source_catalogue_key = p_version->>'catalogueKey'
    order by source_sequence desc limit 1 for update;
  if not found or v_event.id is distinct from v_activation_event_id or v_event.decision <> 'activate'
  then raise exception 'Public source staging requires latest activation authority'; end if;

  select * into v_existing from public.public_source_versions
  where source_catalogue_key = p_version->>'catalogueKey'
    and exact_version_url = p_version->>'exactUrl' and content_hash = p_version->>'contentHash'
  for update;
  if found then
    if v_existing.lifecycle <> 'shadow'
       or v_existing.staging_owner_id is distinct from v_owner_id
       or v_existing.activation_event_id is distinct from v_activation_event_id
       or v_existing.exact_version is distinct from p_version->>'exactVersion'
       or v_existing.staged_content_hash is distinct from p_version->>'stagedContentHash'
       or v_existing.supersedes_version_id is distinct from v_supersedes_version_id
    then raise exception 'Public source resumable shadow identity mismatch'; end if;
    return jsonb_build_object('outcome', 'resumed', 'versionId', v_existing.id,
      'documentId', v_existing.staging_document_id, 'ownerId', v_existing.staging_owner_id);
  end if;
  if not (p_version ? 'stagingDocumentId') then return jsonb_build_object('outcome', 'missing'); end if;

  select * into v_document from public.documents where id = v_document_id for update;
  if not found or v_document.owner_id is distinct from v_owner_id
     or v_document.metadata->>'source_catalogue_key' is distinct from p_version->>'catalogueKey'
     or v_document.metadata->>'source_policy_digest' is distinct from v_event.source_policy_digest
     or v_document.metadata->>'source_exact_url' is distinct from p_version->>'exactUrl'
     or v_document.metadata->>'source_exact_version' is distinct from p_version->>'exactVersion'
     or v_document.metadata->>'content_identity_verdict' is distinct from 'clear'
     or v_document.metadata->>'content_identity_verdict_version' is distinct from 'public-source-content-identity-v1'
  then raise exception 'Public source staging policy or lifecycle mismatch'; end if;

  insert into public.public_source_versions(
    source_catalogue_key, source_policy_version, source_policy_digest, exact_canonical_url,
    exact_version_url, exact_version, content_hash, staged_content_hash, retrieved_at,
    licence_evidence_digest, staging_document_id, lifecycle, supersedes_version_id,
    activation_event_id, staging_owner_id
  ) values (
    p_version->>'catalogueKey', v_event.source_policy_version, v_event.source_policy_digest,
    p_version->>'exactCanonicalUrl', p_version->>'exactUrl', p_version->>'exactVersion',
    p_version->>'contentHash', p_version->>'stagedContentHash', (p_version->>'retrievedAt')::timestamptz,
    p_version->>'licenceEvidenceDigest', v_document_id, 'shadow', v_supersedes_version_id,
    v_activation_event_id, v_owner_id
  ) returning id into v_version_id;
  v_digest := public.public_source_acquisition_identity_digest(v_version_id);
  update public.public_source_versions set acquisition_identity_digest = v_digest where id = v_version_id;
  return jsonb_build_object('outcome', 'created', 'versionId', v_version_id,
    'documentId', v_document_id, 'ownerId', v_owner_id, 'acquisitionIdentityDigest', v_digest);
end;
$$;

revoke all on function public.bump_public_source_serving_authority() from public, anon, authenticated;
revoke all on function public.public_source_serving_authority_stamp() from public, anon, authenticated;
revoke all on function public.public_source_document_is_serving_eligible(uuid) from public, anon, authenticated;
revoke all on function public.require_active_public_source_version_for_publication() from public, anon, authenticated;
revoke all on function public.public_source_acquisition_identity_digest(uuid) from public, anon, authenticated;
revoke all on function public.make_public_source_version_ineligible(uuid) from public, anon, authenticated;
revoke all on function public.record_public_source_activation_event(jsonb) from public, anon, authenticated;
revoke all on function public.create_public_source_fetch_manifest(text, text, text, uuid, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.stage_public_source_version(jsonb) from public, anon, authenticated;
revoke all on function public.activate_public_source_version(jsonb) from public, anon, authenticated;
revoke all on function public.record_unchanged_public_source_check(jsonb) from public, anon, authenticated;
revoke all on function public.transition_public_source_version(uuid, text, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.tombstone_public_source_version_for_review(uuid, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.public_source_serving_authority_stamp() to service_role;
grant execute on function public.record_public_source_activation_event(jsonb) to service_role;
grant execute on function public.create_public_source_fetch_manifest(text, text, text, uuid, text, text, text, uuid)
  to service_role;
grant execute on function public.stage_public_source_version(jsonb) to service_role;
grant execute on function public.activate_public_source_version(jsonb) to service_role;
grant execute on function public.record_unchanged_public_source_check(jsonb) to service_role;
grant execute on function public.transition_public_source_version(uuid, text, text, text, text, text, uuid)
  to service_role;
grant execute on function public.tombstone_public_source_version_for_review(uuid, text, text, text, text, text)
  to service_role;
