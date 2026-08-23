-- Final effective public-source lifecycle authority hardening.
-- Source-only migration: no acquisition or publication operation is performed here.

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
  return 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
    'source_catalogue_key', v_version.source_catalogue_key,
    'source_policy_version', v_version.source_policy_version,
    'source_policy_digest', v_version.source_policy_digest,
    'activation_event_id', v_version.activation_event_id,
    'exact_canonical_url', v_version.exact_canonical_url,
    'exact_version_url', v_version.exact_version_url,
    'exact_version', v_version.exact_version,
    'content_hash', v_version.content_hash,
    'staged_content_hash', v_version.staged_content_hash,
    'licence_evidence_digest', v_version.licence_evidence_digest,
    'staging_owner_id', v_version.staging_owner_id,
    'supersedes_version_id', v_version.supersedes_version_id,
    'document_id', v_document.id,
    'document_owner_id', v_document.owner_id,
    'source_path', v_document.source_path,
    'storage_path', v_document.storage_path,
    'document_content_hash', v_document.content_hash,
    'file_type', v_document.file_type,
    'file_size', v_document.file_size,
    'corpus_scope', v_document.metadata->>'corpus_scope',
    'content_mode', v_document.metadata->>'content_mode',
    'licence_policy', v_document.metadata->>'licence_policy',
    'source_policy_checked', v_document.metadata->>'source_policy_checked',
    'public_source_lifecycle', v_document.metadata->>'public_source_lifecycle',
    'source_content_type', v_document.metadata->>'source_content_type',
    'source_content_byte_length', v_document.metadata->>'source_content_byte_length',
    'source_content_provenance', v_document.metadata->>'source_content_provenance',
    'content_identity_verdict', v_document.metadata->>'content_identity_verdict',
    'content_identity_hash', v_document.metadata->>'content_identity_hash',
    'content_identity_verdict_version', v_document.metadata->>'content_identity_verdict_version',
    'canonical_storage_path', v_document.metadata->>'canonical_storage_path',
    'target_lifecycle', 'shadow'
  )::text, 'UTF8'), 'sha256'), 'hex');
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
  v_policy_version text := btrim(coalesce(p_manifest->>'sourcePolicyVersion', ''));
  v_policy_digest text := btrim(coalesce(p_manifest->>'sourcePolicyDigest', ''));
  v_decision text := btrim(coalesce(p_manifest->>'decision', ''));
  v_reason text := btrim(coalesce(p_manifest->>'reason', ''));
  v_operator_id uuid;
  v_sequence bigint;
  v_evidence text[];
  v_active public.public_source_versions%rowtype;
begin
  if coalesce(p_manifest->>'version', '') <> '1'
     or v_catalogue_key = ''
     or v_policy_version <> 'australian-source-policy-v1'
     or v_policy_digest <> 'sha256:02dcc095258338d0c355af79dfa1889c024f25f385b553e5b6c802207546855d'
     or v_decision not in ('activate', 'quarantine', 'retire')
     or v_reason = '' or length(v_reason) > 1000
  then raise exception 'Invalid public source activation manifest'; end if;
  if v_decision = 'activate' and v_catalogue_key not in (
    'wa-health', 'wa-chief-psychiatrist', 'wa-legislation', 'tga', 'acsqhc',
    'australian-health-disability-ageing', 'nhmrc', 'ranzcp', 'racgp', 'pbs',
    'australian-prescriber', 'nsw-health', 'queensland-health', 'sa-health',
    'victoria-health', 'tasmania-health', 'nt-health', 'act-health'
  ) then raise exception 'Public source is excluded, link-only, historical, or unknown'; end if;
  begin v_operator_id := (p_manifest->>'operatorId')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid public source activation operator'; end;
  select array_agg(value order by ordinal) into v_evidence
  from jsonb_array_elements_text(coalesce(p_manifest->'evidenceReferences', '[]'::jsonb))
    with ordinality evidence(value, ordinal);
  if cardinality(v_evidence) not between 1 and 50
     or exists (select 1 from unnest(v_evidence) value where btrim(value) = '')
     or cardinality(v_evidence) <> (select count(distinct value) from unnest(v_evidence) value)
  then raise exception 'Invalid public source activation evidence'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public_source:' || v_catalogue_key, 0));
  perform 1 from public.public_source_activation_events
    where source_catalogue_key = v_catalogue_key
    order by source_sequence desc limit 1 for update;
  select coalesce(max(source_sequence), 0) + 1 into v_sequence
    from public.public_source_activation_events where source_catalogue_key = v_catalogue_key;

  if v_decision in ('quarantine', 'retire') then
    select * into v_active from public.public_source_versions
      where source_catalogue_key = v_catalogue_key and lifecycle = 'active' for update;
    if found then
      perform public.make_public_source_version_ineligible(v_active.id, 'quarantined');
      update public.public_source_versions set lifecycle = 'quarantined', updated_at = now()
      where id = v_active.id;
      perform public.bump_public_source_serving_authority();
    end if;
  end if;

  insert into public.public_source_activation_events(
    source_catalogue_key, source_policy_version, source_policy_digest, decision,
    operator_id, reason, evidence_references, source_sequence
  ) values (
    v_catalogue_key, v_policy_version, v_policy_digest, v_decision,
    v_operator_id, v_reason, v_evidence, v_sequence
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;

create or replace function public.create_public_source_fetch_manifest(
  p_source_catalogue_key text, p_source_policy_version text, p_source_policy_digest text,
  p_activation_event_id uuid, p_exact_url text, p_exact_version text,
  p_licence_evidence_digest text, p_staging_owner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_event public.public_source_activation_events%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public_source:' || p_source_catalogue_key, 0));
  select * into v_event from public.public_source_activation_events
  where source_catalogue_key = p_source_catalogue_key
  order by source_sequence desc limit 1 for update;
  if not found or v_event.id is distinct from p_activation_event_id
     or v_event.decision is distinct from 'activate'
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
    'targetLifecycle', 'shadow');
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public_source:' || coalesce(p_version->>'catalogueKey', ''), 0));
  select * into v_event from public.public_source_activation_events
  where source_catalogue_key = p_version->>'catalogueKey'
  order by source_sequence desc limit 1 for update;
  if not found or v_event.id is distinct from v_activation_event_id
     or v_event.decision is distinct from 'activate'
     or v_event.source_policy_version is distinct from 'australian-source-policy-v1'
     or v_event.source_policy_digest is distinct from 'sha256:02dcc095258338d0c355af79dfa1889c024f25f385b553e5b6c802207546855d'
  then raise exception 'Public source staging requires latest activation authority'; end if;

  select * into v_existing from public.public_source_versions
  where source_catalogue_key = p_version->>'catalogueKey'
    and exact_version_url = p_version->>'exactUrl' and content_hash = p_version->>'contentHash'
  for update;
  if found then
    select * into v_document from public.documents where id = v_existing.staging_document_id for update;
    v_digest := public.public_source_acquisition_identity_digest(v_existing.id);
    if not found
       or coalesce(p_version->>'lifecycle', '') <> 'shadow'
       or v_existing.lifecycle is distinct from 'shadow'
       or v_existing.source_policy_version is distinct from v_event.source_policy_version
       or v_existing.source_policy_digest is distinct from v_event.source_policy_digest
       or v_existing.exact_canonical_url is distinct from p_version->>'exactCanonicalUrl'
       or v_existing.exact_version_url is distinct from p_version->>'exactUrl'
       or v_existing.exact_version is distinct from p_version->>'exactVersion'
       or v_existing.content_hash is distinct from p_version->>'contentHash'
       or v_existing.staged_content_hash is distinct from p_version->>'stagedContentHash'
       or v_existing.licence_evidence_digest is distinct from p_version->>'licenceEvidenceDigest'
       or v_existing.staging_owner_id is distinct from v_owner_id
       or v_existing.activation_event_id is distinct from v_activation_event_id
       or v_existing.supersedes_version_id is distinct from v_supersedes_version_id
       or v_existing.acquisition_identity_digest is distinct from v_digest
       or v_document.owner_id is distinct from v_owner_id
       or v_document.source_path is distinct from p_version->>'exactUrl'
       or v_document.storage_path is distinct from v_document.metadata->>'canonical_storage_path'
       or v_document.content_hash is distinct from p_version->>'stagedContentHash'
       or v_document.file_type is distinct from p_version->>'stagedContentType'
       or v_document.file_size::text is distinct from p_version->>'stagedByteLength'
       or v_document.metadata->>'corpus_scope' is distinct from 'australian_public'
       or v_document.metadata->>'source_catalogue_key' is distinct from p_version->>'catalogueKey'
       or v_document.metadata->>'source_policy_version' is distinct from v_event.source_policy_version
       or v_document.metadata->>'source_policy_digest' is distinct from v_event.source_policy_digest
       or v_document.metadata->>'source_activation_event_id' is distinct from v_activation_event_id::text
       or v_document.metadata->>'source_canonical_url' is distinct from p_version->>'exactCanonicalUrl'
       or v_document.metadata->>'source_exact_url' is distinct from p_version->>'exactUrl'
       or v_document.metadata->>'source_exact_version' is distinct from p_version->>'exactVersion'
       or v_document.metadata->>'source_content_hash' is distinct from p_version->>'contentHash'
       or v_document.metadata->>'content_hash' is distinct from p_version->>'stagedContentHash'
       or v_document.metadata->>'source_content_type' is distinct from p_version->>'sourceContentType'
       or v_document.metadata->>'source_content_byte_length' is distinct from p_version->>'sourceByteLength'
       or v_document.metadata->>'source_content_provenance' is distinct from 'digest_only'
       or v_document.metadata->>'content_mode' is distinct from 'indexed_content'
       or v_document.metadata->>'licence_policy' is distinct from 'public_index_permitted'
       or v_document.metadata->>'licence_evidence_digest' is distinct from p_version->>'licenceEvidenceDigest'
       or v_document.metadata->>'source_policy_checked' is distinct from 'true'
       or v_document.metadata->>'public_source_lifecycle' is distinct from 'shadow'
       or v_document.metadata->>'content_identity_verdict' is distinct from 'clear'
       or v_document.metadata->>'content_identity_hash' is distinct from p_version->>'stagedContentHash'
       or v_document.metadata->>'content_identity_verdict_version' is distinct from 'public-source-content-identity-v1'
    then raise exception 'Public source resumable shadow identity mismatch'; end if;
    return jsonb_build_object('outcome', 'resumed', 'versionId', v_existing.id,
      'documentId', v_existing.staging_document_id, 'ownerId', v_existing.staging_owner_id,
      'acquisitionIdentityDigest', v_digest);
  end if;
  if not (p_version ? 'stagingDocumentId') then return jsonb_build_object('outcome', 'missing'); end if;

  select * into v_document from public.documents where id = v_document_id for update;
  if not found
     or coalesce(p_version->>'lifecycle', '') <> 'shadow'
     or v_document.owner_id is distinct from v_owner_id
     or v_document.source_path is distinct from p_version->>'exactUrl'
     or v_document.storage_path is distinct from v_document.metadata->>'canonical_storage_path'
     or v_document.content_hash is distinct from p_version->>'stagedContentHash'
     or v_document.file_type is distinct from p_version->>'stagedContentType'
     or v_document.file_size::text is distinct from p_version->>'stagedByteLength'
     or v_document.metadata->>'corpus_scope' is distinct from 'australian_public'
     or v_document.metadata->>'source_catalogue_key' is distinct from p_version->>'catalogueKey'
     or v_document.metadata->>'source_policy_version' is distinct from v_event.source_policy_version
     or v_document.metadata->>'source_policy_digest' is distinct from v_event.source_policy_digest
     or v_document.metadata->>'source_activation_event_id' is distinct from v_activation_event_id::text
     or v_document.metadata->>'source_canonical_url' is distinct from p_version->>'exactCanonicalUrl'
     or v_document.metadata->>'source_exact_url' is distinct from p_version->>'exactUrl'
     or v_document.metadata->>'source_exact_version' is distinct from p_version->>'exactVersion'
     or v_document.metadata->>'source_content_hash' is distinct from p_version->>'contentHash'
     or v_document.metadata->>'content_hash' is distinct from p_version->>'stagedContentHash'
     or v_document.metadata->>'source_content_type' is distinct from p_version->>'sourceContentType'
     or v_document.metadata->>'source_content_byte_length' is distinct from p_version->>'sourceByteLength'
     or v_document.metadata->>'source_content_provenance' is distinct from 'digest_only'
     or v_document.metadata->>'content_mode' is distinct from 'indexed_content'
     or v_document.metadata->>'licence_policy' is distinct from 'public_index_permitted'
     or v_document.metadata->>'licence_evidence_digest' is distinct from p_version->>'licenceEvidenceDigest'
     or v_document.metadata->>'source_policy_checked' is distinct from 'true'
     or v_document.metadata->>'public_source_lifecycle' is distinct from 'shadow'
     or v_document.metadata->>'content_identity_verdict' is distinct from 'clear'
     or v_document.metadata->>'content_identity_hash' is distinct from p_version->>'stagedContentHash'
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

create or replace function public.make_public_source_version_ineligible(p_version_id uuid, p_target_lifecycle text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.public_source_versions%rowtype;
  v_document public.documents%rowtype;
begin
  if p_target_lifecycle not in ('superseded', 'quarantined', 'tombstoned')
  then raise exception 'Public source exit lifecycle is invalid'; end if;
  select * into strict v_version from public.public_source_versions where id = p_version_id for update;
  select * into strict v_document from public.documents where id = v_version.staging_document_id for update;
  perform 1 from public.document_pages where document_id = v_document.id for update;
  perform 1 from public.document_images where document_id = v_document.id for update;
  perform 1 from public.document_labels where document_id = v_document.id for update;
  perform 1 from public.document_summaries where document_id = v_document.id for update;
  perform 1 from public.document_sections where document_id = v_document.id for update;
  perform 1 from public.document_memory_cards where document_id = v_document.id for update;
  perform 1 from public.document_chunks where document_id = v_document.id for update;
  perform 1 from public.document_table_facts where document_id = v_document.id for update;
  perform 1 from public.document_embedding_fields where document_id = v_document.id for update;
  perform 1 from public.document_index_quality where document_id = v_document.id for update;
  perform 1 from public.document_index_units where document_id = v_document.id for update;
  begin
    perform 1 from public.ingestion_jobs where document_id = v_document.id for update nowait;
    perform 1 from public.indexing_v3_agent_jobs where document_id = v_document.id for update nowait;
  exception when lock_not_available then raise exception 'Public source exit has active ingestion work'; end;
  if exists (select 1 from public.ingestion_jobs where document_id = v_document.id and status in ('pending', 'processing'))
     or exists (select 1 from public.indexing_v3_agent_jobs where document_id = v_document.id
       and status not in ('completed', 'needs_enrichment_artifacts')
       and enrichment_status in ('pending', 'failed', 'processing') and attempt_count < max_attempts)
  then raise exception 'Public source exit has active ingestion work'; end if;
  perform pg_catalog.set_config('app.public_source_lifecycle_exit', v_version.id::text, true);
  update public.document_labels set owner_id = v_version.staging_owner_id, updated_at = now() where document_id = v_version.staging_document_id;
  update public.document_summaries set owner_id = v_version.staging_owner_id, updated_at = now() where document_id = v_version.staging_document_id;
  update public.document_sections set owner_id = v_version.staging_owner_id, updated_at = now() where document_id = v_version.staging_document_id;
  update public.document_memory_cards set owner_id = v_version.staging_owner_id, updated_at = now() where document_id = v_version.staging_document_id;
  update public.document_table_facts set owner_id = v_version.staging_owner_id where document_id = v_version.staging_document_id;
  update public.document_embedding_fields set owner_id = v_version.staging_owner_id where document_id = v_version.staging_document_id;
  update public.document_index_quality set owner_id = v_version.staging_owner_id, updated_at = now() where document_id = v_version.staging_document_id;
  update public.document_index_units set owner_id = v_version.staging_owner_id, updated_at = now() where document_id = v_version.staging_document_id;
  update public.documents set owner_id = v_version.staging_owner_id,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'public_corpus', false, 'public_source_lifecycle', p_target_lifecycle), updated_at = now()
  where id = v_version.staging_document_id;
  perform pg_catalog.set_config('app.public_source_lifecycle_exit', '', true);
  delete from public.rag_response_cache where owner_id is null and cache_kind in ('search', 'answer');
end;
$$;

create or replace function public.make_public_source_version_ineligible(p_version_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$ begin perform public.make_public_source_version_ineligible(p_version_id, 'quarantined'); end; $$;

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
  v_latest_event public.public_source_activation_events%rowtype;
  v_old_version_id uuid;
  v_new_version_id uuid;
  v_approval_id uuid;
  v_reviewed_generation_id uuid;
  v_current_digest text;
begin
  begin
    v_old_version_id := nullif(p_activation->>'expectedOldVersionId', '')::uuid;
    v_new_version_id := (p_activation->>'newVersionId')::uuid;
    v_approval_id := (p_activation->>'publicationApprovalId')::uuid;
    v_reviewed_generation_id := (p_activation->>'reviewedIndexGenerationId')::uuid;
  exception when invalid_text_representation then raise exception 'Public source activation identity is invalid'; end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'public_source:' || coalesce(p_activation->>'catalogueKey', ''), 0));
  select * into v_latest_event from public.public_source_activation_events
    where source_catalogue_key = p_activation->>'catalogueKey'
    order by source_sequence desc limit 1 for update;
  select * into v_new_version from public.public_source_versions where id = v_new_version_id for update;
  if not found or v_new_version.source_catalogue_key is distinct from p_activation->>'catalogueKey'
     or v_new_version.lifecycle is distinct from 'approved'
     or v_new_version.exact_version_url is distinct from p_activation->>'newExactVersionUrl'
     or v_new_version.content_hash is distinct from p_activation->>'newContentHash'
     or v_latest_event.id is distinct from v_new_version.activation_event_id
     or v_latest_event.decision is distinct from 'activate'
     or v_latest_event.source_policy_version is distinct from v_new_version.source_policy_version
     or v_latest_event.source_policy_digest is distinct from v_new_version.source_policy_digest
  then raise exception 'Public source activation new-version identity mismatch'; end if;

  if v_old_version_id is null then
    perform 1 from public.public_source_versions
      where source_catalogue_key = v_new_version.source_catalogue_key and lifecycle = 'active' for update;
    if found or v_new_version.supersedes_version_id is not null
    then raise exception 'Public source first activation requires no active predecessor'; end if;
  else
    select * into v_old_version from public.public_source_versions where id = v_old_version_id for update;
    if not found or v_old_version.source_catalogue_key is distinct from v_new_version.source_catalogue_key
       or v_old_version.lifecycle is distinct from 'active'
       or v_old_version.exact_version_url is distinct from p_activation->>'expectedOldExactVersionUrl'
       or v_old_version.content_hash is distinct from p_activation->>'expectedOldContentHash'
       or v_new_version.supersedes_version_id is distinct from v_old_version.id
    then raise exception 'Public source activation old-version identity mismatch'; end if;
  end if;

  select * into v_document from public.documents where id = v_new_version.staging_document_id for update;
  perform 1 from public.document_pages where document_id = v_document.id for update;
  perform 1 from public.document_images where document_id = v_document.id for update;
  perform 1 from public.document_labels where document_id = v_document.id for update;
  perform 1 from public.document_summaries where document_id = v_document.id for update;
  perform 1 from public.document_sections where document_id = v_document.id for update;
  perform 1 from public.document_memory_cards where document_id = v_document.id for update;
  perform 1 from public.document_chunks where document_id = v_document.id for update;
  perform 1 from public.document_table_facts where document_id = v_document.id for update;
  perform 1 from public.document_embedding_fields where document_id = v_document.id for update;
  perform 1 from public.document_index_quality where document_id = v_document.id for update;
  perform 1 from public.document_index_units where document_id = v_document.id for update;
  begin
    perform 1 from public.ingestion_jobs where document_id = v_document.id for update nowait;
    perform 1 from public.indexing_v3_agent_jobs where document_id = v_document.id for update nowait;
  exception when lock_not_available then raise exception 'Public source activation has active ingestion work'; end;
  if exists (select 1 from public.ingestion_jobs where document_id = v_document.id and status in ('pending', 'processing'))
     or exists (select 1 from public.indexing_v3_agent_jobs where document_id = v_document.id
       and status not in ('completed', 'needs_enrichment_artifacts')
       and enrichment_status in ('pending', 'failed', 'processing') and attempt_count < max_attempts)
  then raise exception 'Public source activation has active ingestion work'; end if;
  if v_document.status is distinct from 'indexed'
     or v_document.owner_id is distinct from v_new_version.staging_owner_id
     or v_document.metadata->>'corpus_scope' is distinct from 'australian_public'
     or v_document.metadata->>'content_mode' is distinct from 'indexed_content'
     or v_document.metadata->>'licence_policy' is distinct from 'public_index_permitted'
     or v_document.metadata->>'document_status' is distinct from 'current'
     or coalesce(v_document.metadata->>'change_state', '') not in ('unchanged', 'changed')
     or nullif(btrim(coalesce(v_document.metadata->>'superseded_by_document_id', '')), '') is not null
  then raise exception 'Public source activation document is not indexed and current'; end if;
  if exists (
    select 1 from public.document_labels where document_id = v_document.id and owner_id is distinct from v_new_version.staging_owner_id
    union all select 1 from public.document_summaries where document_id = v_document.id and owner_id is distinct from v_new_version.staging_owner_id
    union all select 1 from public.document_sections where document_id = v_document.id and owner_id is distinct from v_new_version.staging_owner_id
    union all select 1 from public.document_memory_cards where document_id = v_document.id and owner_id is distinct from v_new_version.staging_owner_id
    union all select 1 from public.document_table_facts where document_id = v_document.id and owner_id is distinct from v_new_version.staging_owner_id
    union all select 1 from public.document_embedding_fields where document_id = v_document.id and owner_id is distinct from v_new_version.staging_owner_id
    union all select 1 from public.document_index_quality where document_id = v_document.id and owner_id is distinct from v_new_version.staging_owner_id
    union all select 1 from public.document_index_units where document_id = v_document.id and owner_id is distinct from v_new_version.staging_owner_id
  ) then raise exception 'Public source activation document has mismatched artifact ownership'; end if;

  select * into v_approval from public.document_publication_approvals
  where id = v_approval_id and document_id = v_document.id
    and expected_prior_owner_id = v_new_version.staging_owner_id and decision = 'approved'
    and source_catalogue_key = v_new_version.source_catalogue_key
    and source_policy_version = v_new_version.source_policy_version
    and reviewed_index_generation_id = v_reviewed_generation_id
    and reviewed_state_digest = p_activation->>'reviewedStateDigest'
    and manifest_digest = p_activation->>'manifestDigest' for share;
  v_current_digest := public.public_source_acquisition_identity_digest(v_new_version.id);
  if not found or v_document.index_generation_id is distinct from v_approval.reviewed_index_generation_id
     or public.document_publication_state_digest(v_document.id, v_new_version.staging_owner_id)
       is distinct from v_approval.reviewed_state_digest
     or v_current_digest is distinct from v_new_version.acquisition_identity_digest
     or v_current_digest is distinct from p_activation->>'expectedAcquisitionIdentityDigest'
  then raise exception 'Public source acquisition identity changed after review'; end if;

  if v_old_version_id is not null then
    perform public.make_public_source_version_ineligible(v_old_version.id, 'superseded');
    update public.public_source_versions set lifecycle = 'superseded', updated_at = now() where id = v_old_version.id;
  end if;
  update public.public_source_versions set lifecycle = 'active', publication_approval_id = v_approval.id,
    publication_manifest_digest = v_approval.manifest_digest,
    publication_reviewed_state_digest = v_approval.reviewed_state_digest,
    publication_reviewed_index_generation_id = v_approval.reviewed_index_generation_id, updated_at = now()
  where id = v_new_version.id;
  update public.documents set owner_id = null, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'public_corpus', true, 'public_source_lifecycle', 'active',
    'publication_approval_id', v_approval.id, 'publication_manifest_digest', v_approval.manifest_digest,
    'publication_reviewed_state_digest', v_approval.reviewed_state_digest,
    'publication_source_catalogue_key', v_approval.source_catalogue_key,
    'publication_source_policy_version', v_approval.source_policy_version,
    'publication_reviewed_index_generation_id', v_approval.reviewed_index_generation_id,
    'published_at', now()), updated_at = now()
  where id = v_document.id and owner_id = v_new_version.staging_owner_id;
  update public.document_labels set owner_id = null, updated_at = now() where document_id = v_document.id and owner_id = v_new_version.staging_owner_id;
  update public.document_summaries set owner_id = null, updated_at = now() where document_id = v_document.id and owner_id = v_new_version.staging_owner_id;
  update public.document_sections set owner_id = null, updated_at = now() where document_id = v_document.id and owner_id = v_new_version.staging_owner_id;
  update public.document_memory_cards set owner_id = null, updated_at = now() where document_id = v_document.id and owner_id = v_new_version.staging_owner_id;
  update public.document_table_facts set owner_id = null where document_id = v_document.id and owner_id = v_new_version.staging_owner_id;
  update public.document_embedding_fields set owner_id = null where document_id = v_document.id and owner_id = v_new_version.staging_owner_id;
  update public.document_index_quality set owner_id = null, updated_at = now() where document_id = v_document.id and owner_id = v_new_version.staging_owner_id;
  update public.document_index_units set owner_id = null, updated_at = now() where document_id = v_document.id and owner_id = v_new_version.staging_owner_id;
  delete from public.rag_response_cache where owner_id is null and cache_kind in ('search', 'answer');
  perform public.bump_public_source_serving_authority();
  return jsonb_build_object('oldVersionId', v_old_version_id, 'oldLifecycle',
    case when v_old_version_id is null then null else 'superseded' end,
    'newVersionId', v_new_version.id, 'newLifecycle', 'active');
end;
$$;

revoke all on function public.transition_public_source_version(uuid, text, text, text, text, text, uuid)
  from public, anon, authenticated;
drop function public.transition_public_source_version(uuid, text, text, text, text, text, uuid);

create or replace function public.transition_public_source_version(
  p_version_id uuid, p_expected_catalogue_key text, p_expected_exact_version_url text,
  p_expected_content_hash text, p_expected_lifecycle text, p_new_lifecycle text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_version public.public_source_versions%rowtype; v_document public.documents%rowtype; v_allowed boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'public_source:' || p_expected_catalogue_key, 0));
  select * into v_version from public.public_source_versions where id = p_version_id for update;
  select * into v_document from public.documents where id = v_version.staging_document_id for update;
  if not found or v_version.source_catalogue_key is distinct from p_expected_catalogue_key
     or v_version.exact_version_url is distinct from p_expected_exact_version_url
     or v_version.content_hash is distinct from p_expected_content_hash
     or v_version.lifecycle is distinct from p_expected_lifecycle
     or v_document.source_path is distinct from v_version.exact_version_url
     or v_document.content_hash is distinct from v_version.staged_content_hash
  then raise exception 'Public source version identity changed after review'; end if;
  v_allowed := case v_version.lifecycle
    when 'discovered' then p_new_lifecycle in ('shadow', 'quarantined', 'tombstoned')
    when 'shadow' then p_new_lifecycle in ('approved', 'quarantined', 'tombstoned')
    when 'approved' then p_new_lifecycle in ('quarantined', 'tombstoned')
    when 'active' then p_new_lifecycle in ('superseded', 'quarantined', 'tombstoned')
    when 'quarantined' then p_new_lifecycle = 'tombstoned'
    else false end;
  if not v_allowed then raise exception 'Invalid public source lifecycle transition'; end if;
  if v_version.lifecycle = 'active' then
    perform public.make_public_source_version_ineligible(v_version.id, p_new_lifecycle);
  end if;
  update public.public_source_versions set lifecycle = p_new_lifecycle, updated_at = now() where id = v_version.id;
  if v_version.lifecycle = 'active' then perform public.bump_public_source_serving_authority(); end if;
  return jsonb_build_object('versionId', v_version.id, 'lifecycle', p_new_lifecycle);
end;
$$;

create or replace function public.record_unchanged_public_source_check(p_check jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_version public.public_source_versions%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'public_source:' || coalesce(p_check->>'expectedCatalogueKey', ''), 0));
  select * into v_version from public.public_source_versions where id = (p_check->>'expectedVersionId')::uuid for update;
  if not found or v_version.lifecycle <> 'active'
     or v_version.source_catalogue_key is distinct from p_check->>'expectedCatalogueKey'
     or v_version.exact_version_url is distinct from p_check->>'expectedExactVersionUrl'
     or v_version.exact_version is distinct from p_check->>'expectedExactVersion'
     or v_version.content_hash is distinct from p_check->>'expectedContentHash'
     or p_check->>'outcome' is distinct from 'unchanged'
  then raise exception 'Public source unchanged identity mismatch'; end if;
  insert into public.audit_logs(owner_id, action, resource_type, resource_id, metadata)
  select v_version.staging_owner_id, 'public_source_change_checked', 'public_source_version', v_version.id::text,
    jsonb_build_object('catalogue_key', v_version.source_catalogue_key, 'outcome', 'unchanged')
  where not exists (select 1 from public.audit_logs where action = 'public_source_change_checked'
    and resource_type = 'public_source_version' and resource_id = v_version.id::text
    and metadata->>'outcome' = 'unchanged');
  return jsonb_build_object('outcome', 'unchanged', 'versionId', v_version.id);
exception when invalid_text_representation then raise exception 'Public source unchanged identity mismatch';
end;
$$;

create or replace function public.tombstone_public_source_version_for_review(
  p_version_id uuid, p_expected_catalogue_key text, p_expected_exact_version_url text,
  p_expected_exact_version text, p_expected_content_hash text, p_reason_code text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_version public.public_source_versions%rowtype;
begin
  if p_reason_code not in ('publisher_http_404', 'publisher_http_410')
  then raise exception 'Public source withdrawal reason code is invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'public_source:' || p_expected_catalogue_key, 0));
  select * into v_version from public.public_source_versions where id = p_version_id for update;
  if not found or v_version.lifecycle not in ('active', 'tombstoned')
     or v_version.source_catalogue_key is distinct from p_expected_catalogue_key
     or v_version.exact_version_url is distinct from p_expected_exact_version_url
     or v_version.exact_version is distinct from p_expected_exact_version
     or v_version.content_hash is distinct from p_expected_content_hash
  then raise exception 'Public source current active identity mismatch'; end if;
  if v_version.lifecycle = 'active' then
    perform public.make_public_source_version_ineligible(v_version.id, 'tombstoned');
    update public.public_source_versions set lifecycle = 'tombstoned', updated_at = now() where id = v_version.id;
    perform public.bump_public_source_serving_authority();
  end if;
  insert into public.audit_logs(owner_id, action, resource_type, resource_id, metadata)
  select v_version.staging_owner_id, 'public_source_withdrawal_review_required', 'public_source_version',
    v_version.id::text, jsonb_build_object('catalogue_key', v_version.source_catalogue_key,
      'exact_version', v_version.exact_version, 'reason_code', p_reason_code, 'review_status', 'pending_human_review')
  where not exists (select 1 from public.audit_logs where action = 'public_source_withdrawal_review_required'
    and resource_type = 'public_source_version' and resource_id = v_version.id::text);
  return jsonb_build_object('outcome', 'tombstoned', 'reviewQueued', true);
end;
$$;

create or replace function public.public_source_document_is_serving_eligible(p_document_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case
    when document.metadata->>'corpus_scope' = 'australian_public'
      and nullif(btrim(document.metadata->>'source_catalogue_key'), '') is null then false
    when document.metadata->>'source_catalogue_key' is null then true
    else exists (
      select 1
      from public.public_source_versions version
      join public.document_publication_approvals approval
        on approval.id = version.publication_approval_id
       and approval.document_id = document.id
       and approval.expected_prior_owner_id = version.staging_owner_id
       and approval.decision = 'approved'
       and approval.source_catalogue_key = version.source_catalogue_key
       and approval.source_policy_version = version.source_policy_version
       and approval.reviewed_index_generation_id = version.publication_reviewed_index_generation_id
       and approval.reviewed_state_digest = version.publication_reviewed_state_digest
       and approval.manifest_digest = version.publication_manifest_digest
      where version.staging_document_id = document.id
        and version.source_catalogue_key = document.metadata->>'source_catalogue_key'
        and version.lifecycle = 'active'
        and document.owner_id is null
        and document.status = 'indexed'
        and document.index_generation_id = approval.reviewed_index_generation_id
        and document.metadata->>'publication_approval_id' = approval.id::text
    )
  end
  from public.documents document where document.id = p_document_id;
$$;

create or replace function public.require_active_public_source_version_for_publication()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.owner_id is null
     and (new.metadata->>'corpus_scope' = 'australian_public'
       or new.metadata->>'source_catalogue_key' is not null)
     and not public.public_source_document_is_serving_eligible(new.id)
  then raise exception 'Catalogue-tagged public document requires its exact active public source version'; end if;
  return new;
end;
$$;

-- Re-own every historical P02 publication that cannot prove an exact active P05 version.
-- The accepted P02 approval supplies the real prior owner; missing owner evidence aborts
-- the migration instead of fabricating an identity.
create temporary table public_source_orphaned_publications on commit drop as
select document.id as document_id, approval.expected_prior_owner_id as owner_id
from public.documents document
left join lateral (
  select candidate.expected_prior_owner_id
  from public.document_publication_approvals candidate
  where candidate.document_id = document.id and candidate.decision = 'approved'
    and candidate.id::text = document.metadata->>'publication_approval_id'
  order by candidate.approved_at desc, candidate.id desc limit 1
) approval on true
where document.owner_id is null
  and (document.metadata->>'corpus_scope' = 'australian_public'
    or document.metadata->>'source_catalogue_key' is not null)
  and not public.public_source_document_is_serving_eligible(document.id);

do $$
begin
  if exists (select 1 from public_source_orphaned_publications where owner_id is null)
  then raise exception 'Historical public source publication lacks a real prior owner'; end if;
  alter table public.documents disable trigger documents_require_publication_approval;
  update public.document_labels artifact set owner_id = orphan.owner_id, updated_at = now()
    from public_source_orphaned_publications orphan where artifact.document_id = orphan.document_id;
  update public.document_summaries artifact set owner_id = orphan.owner_id, updated_at = now()
    from public_source_orphaned_publications orphan where artifact.document_id = orphan.document_id;
  update public.document_sections artifact set owner_id = orphan.owner_id, updated_at = now()
    from public_source_orphaned_publications orphan where artifact.document_id = orphan.document_id;
  update public.document_memory_cards artifact set owner_id = orphan.owner_id, updated_at = now()
    from public_source_orphaned_publications orphan where artifact.document_id = orphan.document_id;
  update public.document_table_facts artifact set owner_id = orphan.owner_id
    from public_source_orphaned_publications orphan where artifact.document_id = orphan.document_id;
  update public.document_embedding_fields artifact set owner_id = orphan.owner_id
    from public_source_orphaned_publications orphan where artifact.document_id = orphan.document_id;
  update public.document_index_quality artifact set owner_id = orphan.owner_id, updated_at = now()
    from public_source_orphaned_publications orphan where artifact.document_id = orphan.document_id;
  update public.document_index_units artifact set owner_id = orphan.owner_id, updated_at = now()
    from public_source_orphaned_publications orphan where artifact.document_id = orphan.document_id;
  update public.documents document set owner_id = orphan.owner_id,
    metadata = coalesce(document.metadata, '{}'::jsonb) || jsonb_build_object(
      'public_corpus', false, 'public_source_lifecycle', 'quarantined'), updated_at = now()
  from public_source_orphaned_publications orphan where document.id = orphan.document_id;
  alter table public.documents enable trigger documents_require_publication_approval;
  if exists (select 1 from public_source_orphaned_publications) then
    delete from public.rag_response_cache where owner_id is null and cache_kind in ('search', 'answer');
    perform public.bump_public_source_serving_authority();
  end if;
end;
$$;

create or replace function public.require_active_public_source_artifact_for_publication()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.owner_id is null and not public.public_source_document_is_serving_eligible(new.document_id)
  then raise exception 'Public source artifact requires its exact active source version'; end if;
  return new;
end;
$$;

drop trigger if exists public_source_document_labels_require_active_version on public.document_labels;
create constraint trigger public_source_document_labels_require_active_version after insert or update on public.document_labels deferrable initially immediate for each row execute function public.require_active_public_source_artifact_for_publication();
drop trigger if exists public_source_document_summaries_require_active_version on public.document_summaries;
create constraint trigger public_source_document_summaries_require_active_version after insert or update on public.document_summaries deferrable initially immediate for each row execute function public.require_active_public_source_artifact_for_publication();
drop trigger if exists public_source_document_sections_require_active_version on public.document_sections;
create constraint trigger public_source_document_sections_require_active_version after insert or update on public.document_sections deferrable initially immediate for each row execute function public.require_active_public_source_artifact_for_publication();
drop trigger if exists public_source_document_memory_cards_require_active_version on public.document_memory_cards;
create constraint trigger public_source_document_memory_cards_require_active_version after insert or update on public.document_memory_cards deferrable initially immediate for each row execute function public.require_active_public_source_artifact_for_publication();
drop trigger if exists public_source_document_table_facts_require_active_version on public.document_table_facts;
create constraint trigger public_source_document_table_facts_require_active_version after insert or update on public.document_table_facts deferrable initially immediate for each row execute function public.require_active_public_source_artifact_for_publication();
drop trigger if exists public_source_document_embedding_fields_require_active_version on public.document_embedding_fields;
create constraint trigger public_source_document_embedding_fields_require_active_version after insert or update on public.document_embedding_fields deferrable initially immediate for each row execute function public.require_active_public_source_artifact_for_publication();
drop trigger if exists public_source_document_index_quality_require_active_version on public.document_index_quality;
create constraint trigger public_source_document_index_quality_require_active_version after insert or update on public.document_index_quality deferrable initially immediate for each row execute function public.require_active_public_source_artifact_for_publication();
drop trigger if exists public_source_document_index_units_require_active_version on public.document_index_units;
create constraint trigger public_source_document_index_units_require_active_version after insert or update on public.document_index_units deferrable initially immediate for each row execute function public.require_active_public_source_artifact_for_publication();

revoke all on function public.public_source_acquisition_identity_digest(uuid) from public, anon, authenticated;
revoke all on function public.record_public_source_activation_event(jsonb) from public, anon, authenticated;
revoke all on function public.create_public_source_fetch_manifest(text, text, text, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.stage_public_source_version(jsonb) from public, anon, authenticated;
revoke all on function public.make_public_source_version_ineligible(uuid) from public, anon, authenticated;
revoke all on function public.make_public_source_version_ineligible(uuid, text) from public, anon, authenticated;
revoke all on function public.activate_public_source_version(jsonb) from public, anon, authenticated;
revoke all on function public.transition_public_source_version(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_unchanged_public_source_check(jsonb) from public, anon, authenticated;
revoke all on function public.tombstone_public_source_version_for_review(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.require_active_public_source_artifact_for_publication() from public, anon, authenticated;
revoke all on function public.public_source_document_is_serving_eligible(uuid) from public, anon, authenticated;
revoke all on function public.require_active_public_source_version_for_publication() from public, anon, authenticated;

grant execute on function public.record_public_source_activation_event(jsonb) to service_role;
grant execute on function public.create_public_source_fetch_manifest(text, text, text, uuid, text, text, text, uuid) to service_role;
grant execute on function public.stage_public_source_version(jsonb) to service_role;
grant execute on function public.activate_public_source_version(jsonb) to service_role;
grant execute on function public.transition_public_source_version(uuid, text, text, text, text, text) to service_role;
grant execute on function public.record_unchanged_public_source_check(jsonb) to service_role;
grant execute on function public.tombstone_public_source_version_for_review(uuid, text, text, text, text, text) to service_role;
