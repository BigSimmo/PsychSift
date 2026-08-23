-- Bind Australian public activation to the exact source policy, committed
-- generation, and reviewed document state approved by an operator. Historical
-- version-1 approvals remain readable but cannot activate australian_public rows.

alter table public.document_publication_approvals
  add column if not exists source_catalogue_key text,
  add column if not exists source_policy_version text,
  add column if not exists reviewed_index_generation_id uuid;

alter table public.document_publication_approvals
  drop constraint if exists document_publication_approvals_v2_evidence_complete;
alter table public.document_publication_approvals
  add constraint document_publication_approvals_v2_evidence_complete
  check (
    (source_catalogue_key is null and source_policy_version is null and reviewed_index_generation_id is null)
    or
    (source_catalogue_key is not null and source_policy_version is not null and reviewed_index_generation_id is not null)
  );

alter table public.document_publication_approvals enable row level security;
revoke all on table public.document_publication_approvals from public, anon, authenticated;
grant select, insert on table public.document_publication_approvals to service_role;

drop trigger if exists document_publication_approvals_immutable on public.document_publication_approvals;
create trigger document_publication_approvals_immutable
before update or delete on public.document_publication_approvals
for each row execute function public.prevent_document_publication_approval_mutation();

create or replace function public.require_document_publication_approval_state_digest()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_metadata jsonb;
  v_index_generation_id uuid;
begin
  if new.reviewed_state_digest is null then
    raise exception 'publication approval requires a reviewed content/state digest';
  end if;

  select d.metadata, d.index_generation_id
  into v_metadata, v_index_generation_id
  from public.documents d
  where d.id = new.document_id
  for share;
  if not found then
    raise exception 'publication approval document % was not found', new.document_id;
  end if;

  if v_metadata->>'corpus_scope' = 'australian_public' then
    if new.source_catalogue_key is null
      or new.source_policy_version is null
      or new.reviewed_index_generation_id is null then
      raise exception 'Australian publication approval requires version-2 source and generation evidence';
    end if;
    if new.reviewed_index_generation_id is distinct from v_index_generation_id then
      raise exception 'Australian publication approval generation does not match the committed document generation';
    end if;
    if v_metadata->>'source_catalogue_key' is distinct from new.source_catalogue_key
      or v_metadata->>'source_policy_version' is distinct from new.source_policy_version then
      raise exception 'Australian publication approval source policy does not match document metadata';
    end if;
    if v_metadata->>'content_mode' is distinct from 'indexed_content'
      or v_metadata->>'licence_policy' is distinct from 'public_index_permitted' then
      raise exception 'Australian publication approval requires publicly indexable content';
    end if;
    if v_metadata->>'document_status' is distinct from 'current'
      or v_metadata->>'change_state' = 'withdrawn' then
      raise exception 'Australian publication approval requires a current non-withdrawn source';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.require_document_publication_approval_state_digest() from public, anon, authenticated;

drop trigger if exists document_publication_approvals_require_state_digest on public.document_publication_approvals;
create trigger document_publication_approvals_require_state_digest
before insert on public.document_publication_approvals
for each row execute function public.require_document_publication_approval_state_digest();

create or replace function public.guard_document_publication_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_approval public.document_publication_approvals%rowtype;
  v_approval_id uuid;
  v_manifest_digest text;
  v_reviewed_state_digest text;
  v_current_state_digest text;
  v_old_australian_public boolean;
  v_new_australian_public boolean;
  v_old_reviewed_document jsonb;
  v_new_reviewed_document jsonb;
  v_old_reviewed_metadata jsonb;
  v_new_reviewed_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    if new.owner_id is null then
      raise exception 'public documents must be created as owned rows before approved publication';
    end if;
    return new;
  end if;

  v_old_australian_public := coalesce(old.metadata->>'corpus_scope' = 'australian_public', false);
  v_new_australian_public := coalesce(new.metadata->>'corpus_scope' = 'australian_public', false);
  v_old_reviewed_document := to_jsonb(old) - array['owner_id', 'updated_at', 'metadata'];
  v_new_reviewed_document := to_jsonb(new) - array['owner_id', 'updated_at', 'metadata'];
  v_old_reviewed_metadata := coalesce(old.metadata, '{}'::jsonb) - array[
    'public_corpus',
    'publication_approval_id',
    'publication_manifest_digest',
    'publication_reviewed_state_digest',
    'publication_source_catalogue_key',
    'publication_source_policy_version',
    'publication_reviewed_index_generation_id',
    'published_at'
  ];
  v_new_reviewed_metadata := coalesce(new.metadata, '{}'::jsonb) - array[
    'public_corpus',
    'publication_approval_id',
    'publication_manifest_digest',
    'publication_reviewed_state_digest',
    'publication_source_catalogue_key',
    'publication_source_policy_version',
    'publication_reviewed_index_generation_id',
    'published_at'
  ];

  if old.owner_id is not null and new.owner_id is null then
    if v_new_australian_public and not v_old_australian_public then
      raise exception 'version-1 or non-Australian reviewed state cannot activate an Australian public document';
    end if;
    if v_new_reviewed_document is distinct from v_old_reviewed_document
      or v_new_reviewed_metadata is distinct from v_old_reviewed_metadata then
      raise exception 'public document target reviewed state changed during publication';
    end if;

    begin
      v_approval_id := nullif(new.metadata->>'publication_approval_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'public document transition has an invalid publication approval id';
    end;
    v_manifest_digest := lower(coalesce(new.metadata->>'publication_manifest_digest', ''));
    v_reviewed_state_digest := lower(coalesce(new.metadata->>'publication_reviewed_state_digest', ''));
    if v_approval_id is null
      or v_manifest_digest !~ '^[0-9a-f]{64}$'
      or v_reviewed_state_digest !~ '^[0-9a-f]{64}$' then
      raise exception 'public document transition requires publication approval evidence';
    end if;

    select approval.* into v_approval
    from public.document_publication_approvals approval
    where approval.id = v_approval_id
      and approval.document_id = old.id
      and approval.expected_prior_owner_id = old.owner_id
      and approval.decision = 'approved'
      and approval.manifest_digest = v_manifest_digest
      and approval.reviewed_state_digest = v_reviewed_state_digest;
    if not found then
      raise exception 'public document transition approval does not match the reviewed document state';
    end if;

    if v_new_australian_public then
      if v_approval.source_catalogue_key is null
        or v_approval.source_policy_version is null
        or v_approval.reviewed_index_generation_id is null
        or new.metadata->>'publication_source_catalogue_key' is distinct from v_approval.source_catalogue_key
        or new.metadata->>'publication_source_policy_version' is distinct from v_approval.source_policy_version
        or new.metadata->>'publication_reviewed_index_generation_id'
          is distinct from v_approval.reviewed_index_generation_id::text then
        raise exception 'historical version-1 approval cannot activate an Australian public document';
      end if;
      if new.index_generation_id is distinct from v_approval.reviewed_index_generation_id
        or new.metadata->>'source_catalogue_key' is distinct from v_approval.source_catalogue_key
        or new.metadata->>'source_policy_version' is distinct from v_approval.source_policy_version then
        raise exception 'Australian public document policy or committed generation changed after approval';
      end if;
      if new.metadata->>'content_mode' is distinct from 'indexed_content'
        or new.metadata->>'licence_policy' is distinct from 'public_index_permitted'
        or new.metadata->>'document_status' is distinct from 'current'
        or new.metadata->>'change_state' = 'withdrawn' then
        raise exception 'Australian public document is not active, current, and publicly indexable';
      end if;
    end if;

    perform 1 from public.document_pages where document_id = old.id for update;
    perform 1 from public.document_images where document_id = old.id for update;
    perform 1 from public.document_labels where document_id = old.id for update;
    perform 1 from public.document_summaries where document_id = old.id for update;
    perform 1 from public.document_sections where document_id = old.id for update;
    perform 1 from public.document_memory_cards where document_id = old.id for update;
    perform 1 from public.document_chunks where document_id = old.id for update;
    perform 1 from public.document_table_facts where document_id = old.id for update;
    perform 1 from public.document_embedding_fields where document_id = old.id for update;
    perform 1 from public.document_index_quality where document_id = old.id for update;
    perform 1 from public.document_index_units where document_id = old.id for update;

    begin
      perform 1 from public.ingestion_jobs where document_id = old.id for update nowait;
      perform 1 from public.indexing_v3_agent_jobs where document_id = old.id for update nowait;
    exception when lock_not_available then
      raise exception 'public document transition has active ingestion work';
    end;
    if exists (
      select 1 from public.ingestion_jobs
      where document_id = old.id and status in ('pending', 'processing')
    ) or exists (
      select 1 from public.indexing_v3_agent_jobs
      where document_id = old.id
        and status not in ('completed', 'needs_enrichment_artifacts')
        and enrichment_status in ('pending', 'failed', 'processing')
        and attempt_count < max_attempts
    ) then
      raise exception 'public document transition has active ingestion work';
    end if;

    v_current_state_digest := public.document_publication_state_digest(old.id, old.owner_id);
    if v_current_state_digest is distinct from v_reviewed_state_digest then
      raise exception 'public document transition content changed after review';
    end if;
  elsif old.owner_id is null and new.owner_id is not null and v_old_australian_public then
    raise exception 'Australian public reviewed state is immutable after activation';
  elsif old.owner_id is null and new.owner_id is null and (v_old_australian_public or v_new_australian_public) then
    if not (v_old_australian_public and v_new_australian_public)
      or v_new_reviewed_document is distinct from v_old_reviewed_document
      or v_new_reviewed_metadata is distinct from v_old_reviewed_metadata then
      raise exception 'Australian public reviewed state is immutable after activation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_document_publication_transition() from public, anon, authenticated;

create or replace function public.activate_approved_public_documents(
  p_manifest jsonb,
  p_expected_state_digest text,
  p_expected_generation_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_document public.documents%rowtype;
  v_document_id uuid;
  v_expected_owner_id uuid;
  v_expected_state_digest text;
  v_expected_index_generation_id uuid;
  v_source_catalogue_key text;
  v_source_policy_version text := coalesce(p_manifest->>'sourcePolicyVersion', '');
  v_current_state_digest text;
  v_computed_batch_state_digest text;
  v_manifest_generation_ids uuid[];
  v_approval_id uuid;
  v_manifest_digest text;
  v_approved_count integer;
  v_results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_manifest) is distinct from 'object'
    or coalesce(p_manifest->>'version', '') <> '2' then
    raise exception 'Australian activation requires a publication manifest version 2';
  end if;
  if coalesce(p_manifest->>'sourcePolicyVersion', '') <> 'australian-source-policy-v1' then
    raise exception 'Australian activation source policy version is unsupported';
  end if;
  if jsonb_typeof(p_manifest->'documents') is distinct from 'array'
    or jsonb_array_length(p_manifest->'documents') < 1 then
    raise exception 'Australian activation documents must be a non-empty JSON array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_manifest->'documents') entry
    where coalesce(entry->>'documentId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (
        entry->>'decision' = 'approved'
        and (
          coalesce(entry->>'expectedOwnerId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or coalesce(entry->>'expectedIndexGenerationId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or coalesce(entry->>'expectedStateDigest', '') !~ '^[0-9a-f]{64}$'
          or nullif(trim(entry->>'sourceCatalogueKey'), '') is null
        )
      )
  ) then
    raise exception 'Australian activation manifest contains invalid approved document evidence';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_manifest->'documents') entry
    group by (entry->>'documentId')::uuid
    having count(*) > 1
  ) then
    raise exception 'Australian activation manifest contains duplicate document ids';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_manifest->'documents') entry
    where entry->>'decision' = 'approved'
    group by (entry->>'expectedIndexGenerationId')::uuid
    having count(*) > 1
  ) then
    raise exception 'Australian activation manifest contains duplicate generation ids';
  end if;

  select count(*)::integer,
         array_agg((entry->>'expectedIndexGenerationId')::uuid order by (entry->>'documentId')::uuid),
         encode(
           extensions.digest(
             convert_to(
               string_agg(
                 ((entry->>'documentId')::uuid)::text || ':' || (entry->>'expectedStateDigest'),
                 E'\n' order by (entry->>'documentId')::uuid
               ),
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         )
  into v_approved_count, v_manifest_generation_ids, v_computed_batch_state_digest
  from jsonb_array_elements(p_manifest->'documents') with ordinality as item(entry, ordinality)
  where entry->>'decision' = 'approved';

  if v_approved_count < 1 then
    raise exception 'Australian activation manifest has no approved documents';
  end if;
  if lower(trim(coalesce(p_expected_state_digest, ''))) !~ '^[0-9a-f]{64}$'
    or lower(trim(p_expected_state_digest)) is distinct from v_computed_batch_state_digest then
    raise exception 'Australian activation reviewed-state confirmation does not match the manifest';
  end if;
  if p_expected_generation_ids is null
    or p_expected_generation_ids is distinct from v_manifest_generation_ids then
    raise exception 'Australian activation generation confirmation does not match the manifest';
  end if;

  for v_entry in
    select entry
    from jsonb_array_elements(p_manifest->'documents') with ordinality as item(entry, ordinality)
    where entry->>'decision' = 'approved'
    order by (entry->>'documentId')::uuid
  loop
    begin
      v_document_id := (v_entry->>'documentId')::uuid;
      v_expected_owner_id := (v_entry->>'expectedOwnerId')::uuid;
      v_expected_index_generation_id := (v_entry->>'expectedIndexGenerationId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Australian activation manifest contains an invalid UUID';
    end;
    v_expected_state_digest := lower(coalesce(v_entry->>'expectedStateDigest', ''));
    v_source_catalogue_key := nullif(trim(v_entry->>'sourceCatalogueKey'), '');

    select * into v_document
    from public.documents
    where id = v_document_id
    for update;
    if not found then
      raise exception 'Australian activation document % was not found', v_document_id;
    end if;
    if v_document.owner_id is distinct from v_expected_owner_id then
      raise exception 'Australian activation document % owner changed', v_document_id;
    end if;
    if v_document.status <> 'indexed' then
      raise exception 'Australian activation document % is not indexed', v_document_id;
    end if;
    if v_document.metadata->>'corpus_scope' is distinct from 'australian_public'
      or v_document.metadata->>'source_catalogue_key' is distinct from v_source_catalogue_key
      or v_document.metadata->>'source_policy_version' is distinct from v_source_policy_version then
      raise exception 'Australian activation document % source policy metadata changed', v_document_id;
    end if;
    if v_document.metadata->>'content_mode' is distinct from 'indexed_content'
      or v_document.metadata->>'licence_policy' is distinct from 'public_index_permitted' then
      raise exception 'Australian activation document % is not publicly indexable', v_document_id;
    end if;
    if v_document.metadata->>'document_status' is distinct from 'current'
      or v_document.metadata->>'change_state' = 'withdrawn' then
      raise exception 'Australian activation document % is not current and non-withdrawn', v_document_id;
    end if;
    if v_document.index_generation_id is distinct from v_expected_index_generation_id then
      raise exception 'Australian activation document % committed generation changed', v_document_id;
    end if;

    perform 1 from public.document_pages where document_id = v_document_id for update;
    perform 1 from public.document_images where document_id = v_document_id for update;
    perform 1 from public.document_labels where document_id = v_document_id for update;
    perform 1 from public.document_summaries where document_id = v_document_id for update;
    perform 1 from public.document_sections where document_id = v_document_id for update;
    perform 1 from public.document_memory_cards where document_id = v_document_id for update;
    perform 1 from public.document_chunks where document_id = v_document_id for update;
    perform 1 from public.document_table_facts where document_id = v_document_id for update;
    perform 1 from public.document_embedding_fields where document_id = v_document_id for update;
    perform 1 from public.document_index_quality where document_id = v_document_id for update;
    perform 1 from public.document_index_units where document_id = v_document_id for update;

    begin
      perform 1 from public.ingestion_jobs where document_id = v_document_id for update nowait;
      perform 1 from public.indexing_v3_agent_jobs where document_id = v_document_id for update nowait;
    exception when lock_not_available then
      raise exception 'Australian activation document % has active ingestion work', v_document_id;
    end;
    if exists (
      select 1 from public.ingestion_jobs
      where document_id = v_document_id and status in ('pending', 'processing')
    ) or exists (
      select 1 from public.indexing_v3_agent_jobs
      where document_id = v_document_id
        and status not in ('completed', 'needs_enrichment_artifacts')
        and enrichment_status in ('pending', 'failed', 'processing')
        and attempt_count < max_attempts
    ) then
      raise exception 'Australian activation document % has active ingestion work', v_document_id;
    end if;

    select approval.id, approval.manifest_digest into v_approval_id, v_manifest_digest
    from public.document_publication_approvals approval
    where approval.document_id = v_document_id
      and approval.expected_prior_owner_id = v_expected_owner_id
      and approval.approving_operator_id = (p_manifest->>'approvingOperatorId')::uuid
      and approval.decision = 'approved'
      and approval.reason = p_manifest->>'reason'
      and approval.evidence_references = array(
        select jsonb_array_elements_text(p_manifest->'evidenceReferences')
      )
      and approval.reviewed_state_digest = v_expected_state_digest
      and approval.reviewed_index_generation_id = v_expected_index_generation_id
      and approval.source_catalogue_key = v_source_catalogue_key
      and approval.source_policy_version = v_source_policy_version
    order by approval.approved_at desc, approval.id desc
    limit 1;
    if v_approval_id is null then
      raise exception 'Australian activation document % lacks matching approved version-2 evidence', v_document_id;
    end if;

    if exists (
      select 1 from public.document_labels where document_id = v_document_id and owner_id is distinct from v_expected_owner_id
      union all select 1 from public.document_summaries where document_id = v_document_id and owner_id is distinct from v_expected_owner_id
      union all select 1 from public.document_sections where document_id = v_document_id and owner_id is distinct from v_expected_owner_id
      union all select 1 from public.document_memory_cards where document_id = v_document_id and owner_id is distinct from v_expected_owner_id
      union all select 1 from public.document_table_facts where document_id = v_document_id and owner_id is distinct from v_expected_owner_id
      union all select 1 from public.document_embedding_fields where document_id = v_document_id and owner_id is distinct from v_expected_owner_id
      union all select 1 from public.document_index_quality where document_id = v_document_id and owner_id is distinct from v_expected_owner_id
      union all select 1 from public.document_index_units where document_id = v_document_id and owner_id is distinct from v_expected_owner_id
    ) then
      raise exception 'Australian activation document % has mismatched artifact ownership', v_document_id;
    end if;

    v_current_state_digest := public.document_publication_state_digest(v_document_id, v_expected_owner_id);
    if v_current_state_digest is distinct from v_expected_state_digest then
      raise exception 'Australian activation document % changed after review', v_document_id;
    end if;

    update public.document_labels set owner_id = null, updated_at = now() where document_id = v_document_id;
    update public.document_summaries set owner_id = null, updated_at = now() where document_id = v_document_id;
    update public.document_sections set owner_id = null, updated_at = now() where document_id = v_document_id;
    update public.document_memory_cards set owner_id = null, updated_at = now() where document_id = v_document_id;
    update public.document_table_facts set owner_id = null where document_id = v_document_id;
    update public.document_embedding_fields set owner_id = null where document_id = v_document_id;
    update public.document_index_quality set owner_id = null, updated_at = now() where document_id = v_document_id;
    update public.document_index_units set owner_id = null, updated_at = now() where document_id = v_document_id;

    update public.documents
    set owner_id = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'public_corpus', true,
          'publication_approval_id', v_approval_id,
          'publication_manifest_digest', v_manifest_digest,
          'publication_reviewed_state_digest', v_expected_state_digest,
          'publication_source_catalogue_key', v_source_catalogue_key,
          'publication_source_policy_version', v_source_policy_version,
          'publication_reviewed_index_generation_id', v_expected_index_generation_id,
          'published_at', now()
        ),
        updated_at = now()
    where id = v_document_id;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'document_id', v_document_id,
      'previous_owner_id', v_expected_owner_id,
      'approval_id', v_approval_id,
      'manifest_digest', v_manifest_digest,
      'reviewed_state_digest', v_expected_state_digest,
      'reviewed_index_generation_id', v_expected_index_generation_id,
      'source_catalogue_key', v_source_catalogue_key,
      'source_policy_version', v_source_policy_version,
      'outcome', 'activated'
    ));
  end loop;

  return jsonb_build_object(
    'version', 2,
    'source_policy_version', v_source_policy_version,
    'reviewed_batch_state_digest', v_computed_batch_state_digest,
    'activated_count', v_approved_count,
    'documents', v_results
  );
end;
$$;

revoke all on function public.activate_approved_public_documents(jsonb, text, uuid[]) from public, anon, authenticated;
grant execute on function public.activate_approved_public_documents(jsonb, text, uuid[]) to service_role;
