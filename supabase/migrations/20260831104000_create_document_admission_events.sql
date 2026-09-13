-- Trusted administrator and backend document admission.
--
-- Both public entrypoints authenticate their own actor and delegate to one
-- private transactional core.  The append-only event stores bounded authority
-- metadata and digests only; raw filenames, storage paths, and document bodies
-- remain confined to the private document input.

create table if not exists public.trusted_ingestion_backend_principals (
  principal text primary key,
  capability_sha256 text not null,
  staging_owner_id uuid not null references auth.users(id) on delete restrict,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trusted_ingestion_backend_principals_name_check
    check (length(principal) between 1 and 200 and principal = btrim(principal) and principal !~ '[[:cntrl:]]'),
  constraint trusted_ingestion_backend_principals_capability_sha256_check
    check (capability_sha256 ~ '^sha256:[0-9a-f]{64}$')
);

create table if not exists public.document_admission_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  ingestion_job_id uuid not null,
  staging_owner_id uuid not null references auth.users(id) on delete restrict,
  source_channel text not null,
  actor_kind text not null,
  administrator_id uuid,
  backend_principal text,
  correlation_id uuid not null,
  admission_policy_version text not null,
  content_sha256 text not null,
  file_name_sha256 text not null,
  storage_path_sha256 text not null,
  mime_type text not null,
  byte_count bigint not null,
  authority jsonb not null,
  admission_digest text not null,
  document_input_digest text not null,
  request_digest text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint document_admission_events_source_channel_check
    check (source_channel in ('admin_api', 'backend_import')),
  constraint document_admission_events_actor_kind_check
    check (actor_kind in ('administrator', 'trusted_backend')),
  constraint document_admission_events_actor_identity_check
    check (
      (actor_kind = 'administrator' and source_channel = 'admin_api'
        and administrator_id is not null and backend_principal is null)
      or
      (actor_kind = 'trusted_backend' and source_channel = 'backend_import'
        and administrator_id is null and backend_principal is not null)
    ),
  constraint document_admission_events_backend_principal_check
    check (backend_principal is null or (
      length(backend_principal) between 1 and 200
      and backend_principal = btrim(backend_principal)
      and backend_principal !~ '[[:cntrl:]]'
    )),
  constraint document_admission_events_policy_check
    check (admission_policy_version = 'trusted-document-admission-v1'),
  constraint document_admission_events_content_sha256_check
    check (content_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_file_name_sha256_check
    check (file_name_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_storage_path_sha256_check
    check (storage_path_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_admission_digest_check
    check (admission_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_document_input_digest_check
    check (document_input_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_request_digest_check
    check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_byte_count_check
    check (byte_count between 1 and 157286400),
  constraint document_admission_events_authority_check
    check (jsonb_typeof(authority) = 'object')
);

create unique index if not exists document_admission_events_admin_replay_uidx
  on public.document_admission_events(source_channel, administrator_id, correlation_id)
  where actor_kind = 'administrator';

create unique index if not exists document_admission_events_backend_replay_uidx
  on public.document_admission_events(source_channel, backend_principal, correlation_id)
  where actor_kind = 'trusted_backend';

create unique index if not exists document_admission_events_document_uidx
  on public.document_admission_events(document_id);

create unique index if not exists document_admission_events_job_uidx
  on public.document_admission_events(ingestion_job_id);

alter table public.trusted_ingestion_backend_principals enable row level security;
alter table public.document_admission_events enable row level security;

revoke all on table public.trusted_ingestion_backend_principals
  from public, anon, authenticated, service_role;
revoke all on table public.document_admission_events
  from public, anon, authenticated, service_role;

create or replace function public.reject_document_admission_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'document_admission_events_append_only' using errcode = '55000';
end;
$$;

drop trigger if exists reject_document_admission_event_update on public.document_admission_events;
create trigger reject_document_admission_event_update
before update on public.document_admission_events
for each row execute function public.reject_document_admission_event_mutation();

drop trigger if exists reject_document_admission_event_delete on public.document_admission_events;
create trigger reject_document_admission_event_delete
before delete on public.document_admission_events
for each row execute function public.reject_document_admission_event_mutation();

create or replace function public.trusted_document_admission_core(
  p_admission jsonb,
  p_document jsonb,
  p_replay_only boolean,
  p_actor_kind text,
  p_administrator_id uuid,
  p_backend_principal text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_document_id uuid;
  v_staging_owner_id uuid;
  v_correlation_id uuid;
  v_import_batch_id uuid;
  v_supersedes_document_id uuid;
  v_authority jsonb;
  v_authority_key text;
  v_date_key text;
  v_date_value text;
  v_content_hex text;
  v_admission_digest text;
  v_document_input_digest text;
  v_request_digest text;
  v_actor_identity text;
  v_constraint_name text;
  v_event_id uuid := gen_random_uuid();
  v_job_id uuid := gen_random_uuid();
  v_max_attempts integer;
  v_metadata jsonb;
  v_existing_event public.document_admission_events%rowtype;
  v_document public.documents%rowtype;
  v_job public.ingestion_jobs%rowtype;
begin
  if pg_catalog.jsonb_typeof(p_admission) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_document) is distinct from 'object'
    or p_replay_only is null
  then
    raise exception 'invalid_trusted_document_admission';
  end if;

  if not p_admission ?& array[
      'document_id', 'staging_owner_id', 'source_channel', 'content_sha256',
      'file_name_sha256', 'storage_path_sha256', 'mime_type', 'byte_count',
      'correlation_id', 'admission_policy_version', 'authority'
    ]
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_admission) as key
      where key <> all(array[
        'document_id', 'staging_owner_id', 'source_channel', 'content_sha256',
        'file_name_sha256', 'storage_path_sha256', 'mime_type', 'byte_count',
        'correlation_id', 'admission_policy_version', 'authority'
      ])
    )
  then
    raise exception 'invalid_trusted_document_admission_keys';
  end if;

  if not p_document ?& array[
      'id', 'owner_id', 'title', 'description', 'file_name', 'file_type',
      'file_size', 'storage_path', 'content_hash', 'metadata', 'max_attempts'
    ]
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_document) as key
      where key <> all(array[
        'id', 'owner_id', 'title', 'description', 'file_name', 'file_type',
        'file_size', 'storage_path', 'content_hash', 'source_path',
        'import_batch_id', 'metadata', 'max_attempts'
      ])
    )
  then
    raise exception 'invalid_trusted_document_input_keys';
  end if;

  begin
    v_document_id := (p_admission->>'document_id')::uuid;
    v_staging_owner_id := (p_admission->>'staging_owner_id')::uuid;
    v_correlation_id := (p_admission->>'correlation_id')::uuid;
    if p_document ? 'import_batch_id' and p_document->'import_batch_id' is distinct from 'null'::jsonb then
      v_import_batch_id := (p_document->>'import_batch_id')::uuid;
    end if;
  exception when invalid_text_representation then
    raise exception 'invalid_trusted_document_uuid';
  end;

  if p_admission->>'document_id' is distinct from v_document_id::text
    or p_admission->>'staging_owner_id' is distinct from v_staging_owner_id::text
    or p_admission->>'correlation_id' is distinct from v_correlation_id::text
    or p_document->>'id' is distinct from v_document_id::text
    or p_document->>'owner_id' is distinct from v_staging_owner_id::text
    or (v_import_batch_id is not null and p_document->>'import_batch_id' is distinct from v_import_batch_id::text)
    or p_admission->>'document_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_admission->>'staging_owner_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_admission->>'correlation_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (v_import_batch_id is not null and p_document->>'import_batch_id'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  then
    raise exception 'invalid_trusted_document_identity';
  end if;

  if p_actor_kind = 'administrator' then
    if p_administrator_id is null or p_backend_principal is not null
      or p_admission->>'source_channel' is distinct from 'admin_api'
      or v_staging_owner_id is distinct from p_administrator_id
      or v_import_batch_id is not null
      or p_document ? 'source_path'
    then
      raise exception 'invalid_administrator_admission_scope';
    end if;
    v_actor_identity := p_administrator_id::text;
  elsif p_actor_kind = 'trusted_backend' then
    if p_administrator_id is not null or p_backend_principal is null
      or p_admission->>'source_channel' is distinct from 'backend_import'
      or v_import_batch_id is null
      or not p_document ? 'source_path'
      or p_document->'source_path' is not distinct from 'null'::jsonb
    then
      raise exception 'invalid_backend_admission_scope';
    end if;
    v_actor_identity := p_backend_principal;
  else
    raise exception 'invalid_trusted_document_actor';
  end if;

  if p_admission->>'admission_policy_version' is distinct from 'trusted-document-admission-v1'
    or p_admission->>'content_sha256' !~ '^sha256:[0-9a-f]{64}$'
    or p_admission->>'file_name_sha256' !~ '^sha256:[0-9a-f]{64}$'
    or p_admission->>'storage_path_sha256' !~ '^sha256:[0-9a-f]{64}$'
    or (p_admission->>'mime_type' in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    )) is not true
    or pg_catalog.jsonb_typeof(p_admission->'byte_count') is distinct from 'number'
    or (p_admission->>'byte_count')::numeric <> pg_catalog.trunc((p_admission->>'byte_count')::numeric)
    or (p_admission->>'byte_count')::numeric not between 1 and 157286400
  then
    raise exception 'invalid_trusted_document_admission';
  end if;

  v_content_hex := pg_catalog.substring(p_admission->>'content_sha256' from 8);
  if p_document->>'content_hash' is distinct from v_content_hex
    or p_document->>'file_type' is distinct from p_admission->>'mime_type'
    or pg_catalog.jsonb_typeof(p_document->'file_size') is distinct from 'number'
    or (p_document->>'file_size')::numeric is distinct from (p_admission->>'byte_count')::numeric
    or pg_catalog.jsonb_typeof(p_document->'title') is distinct from 'string'
    or pg_catalog.length(pg_catalog.btrim(p_document->>'title')) not between 1 and 180
    or p_document->>'title' is distinct from pg_catalog.btrim(p_document->>'title')
    or p_document->>'title' ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(p_document->'file_name') is distinct from 'string'
    or pg_catalog.length(p_document->>'file_name') not between 1 and 255
    or p_document->>'file_name' is distinct from pg_catalog.btrim(p_document->>'file_name')
    or p_document->>'file_name' ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(p_document->'storage_path') is distinct from 'string'
    or pg_catalog.length(p_document->>'storage_path') not between 1 and 1024
    or p_document->>'storage_path' is distinct from pg_catalog.btrim(p_document->>'storage_path')
    or p_document->>'storage_path' ~ '[[:cntrl:]]'
    or (p_document->'description' is distinct from 'null'::jsonb
      and (pg_catalog.jsonb_typeof(p_document->'description') is distinct from 'string'
        or pg_catalog.length(p_document->>'description') not between 1 and 1000
        or p_document->>'description' is distinct from pg_catalog.btrim(p_document->>'description')
        or p_document->>'description' ~ '[[:cntrl:]]'))
    or pg_catalog.jsonb_typeof(p_document->'metadata') is distinct from 'object'
    -- PostgreSQL's jsonb text encoding is the authoritative database resource bound.
    -- Callers may preflight compact canonical JSON bytes, but jsonb adds formatting.
    or pg_catalog.octet_length((p_document->'metadata')::text) > 65536
    or 'sha256:' || pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_document->>'file_name', 'UTF8'), 'sha256'), 'hex')
      is distinct from p_admission->>'file_name_sha256'
    or 'sha256:' || pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_document->>'storage_path', 'UTF8'), 'sha256'), 'hex')
      is distinct from p_admission->>'storage_path_sha256'
  then
    raise exception 'invalid_trusted_document_input';
  end if;

  if p_document ? 'source_path'
    and p_document->'source_path' is distinct from 'null'::jsonb
    and (pg_catalog.jsonb_typeof(p_document->'source_path') is distinct from 'string'
      or pg_catalog.length(p_document->>'source_path') not between 1 and 4096
      or p_document->>'source_path' is distinct from pg_catalog.btrim(p_document->>'source_path')
      or p_document->>'source_path' ~ '[[:cntrl:]]')
  then
    raise exception 'invalid_trusted_document_source_path';
  end if;

  if pg_catalog.jsonb_typeof(p_document->'max_attempts') is distinct from 'number'
    or (p_document->>'max_attempts')::numeric <> pg_catalog.trunc((p_document->>'max_attempts')::numeric)
    or (p_document->>'max_attempts')::numeric not between 1 and 100
  then
    raise exception 'invalid_trusted_document_max_attempts';
  end if;
  v_max_attempts := (p_document->>'max_attempts')::integer;

  v_authority := p_admission->'authority';
  if pg_catalog.jsonb_typeof(v_authority) is distinct from 'object'
    or not v_authority ?& array[
      'version', 'sourceRole', 'authorityBasis', 'licencePolicy',
      'rightsEvidenceRef', 'publisher', 'jurisdiction', 'publicationDate',
      'effectiveDate', 'reviewDate', 'expiryDate', 'currentness',
      'supersedesDocumentId', 'purpose', 'supportedFeatures', 'providerProcessing'
    ]
  then
    raise exception 'invalid_trusted_document_authority';
  end if;

  for v_authority_key in select key from pg_catalog.jsonb_object_keys(v_authority) as key loop
    if v_authority_key <> all(array[
      'version', 'sourceRole', 'authorityBasis', 'licencePolicy',
      'rightsEvidenceRef', 'publisher', 'jurisdiction', 'publicationDate',
      'effectiveDate', 'reviewDate', 'expiryDate', 'currentness',
      'supersedesDocumentId', 'purpose', 'supportedFeatures', 'providerProcessing'
    ]) then
      raise exception 'invalid_trusted_document_authority_keys';
    end if;
  end loop;

  if v_authority->'version' is distinct from '1'::jsonb
    or (v_authority->>'sourceRole' in (
      'local_guideline', 'clinical_guideline', 'clinical_reference',
      'service_directory', 'form_reference', 'tool_reference', 'safety_alert',
      'regulatory', 'quality_standard', 'legal', 'subsidy',
      'professional_review', 'service_policy'
    )) is not true
    or v_authority->>'authorityBasis' is distinct from
      case p_actor_kind when 'administrator' then 'administrator_template' else 'backend_manifest' end
    or (v_authority->>'licencePolicy' in ('review_required', 'public_index_permitted')) is not true
    or pg_catalog.jsonb_typeof(v_authority->'rightsEvidenceRef') is distinct from 'string'
    or pg_catalog.length(v_authority->>'rightsEvidenceRef') not between 1 and 500
    or v_authority->>'rightsEvidenceRef' is distinct from pg_catalog.btrim(v_authority->>'rightsEvidenceRef')
    or v_authority->>'rightsEvidenceRef' ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(v_authority->'publisher') is distinct from 'string'
    or pg_catalog.length(v_authority->>'publisher') not between 1 and 300
    or v_authority->>'publisher' is distinct from pg_catalog.btrim(v_authority->>'publisher')
    or v_authority->>'publisher' ~ '[[:cntrl:]]'
    or v_authority->>'jurisdiction' is distinct from 'Australia'
    or (v_authority->>'currentness' in ('current', 'unknown')) is not true
    or v_authority->>'purpose' is distinct from 'clinical_retrieval'
    or (v_authority->>'providerProcessing' in ('permitted', 'forbidden')) is not true
    or pg_catalog.jsonb_typeof(v_authority->'supportedFeatures') is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_authority->'supportedFeatures') not between 1 and 3
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_authority->'supportedFeatures') as features(feature)
      where pg_catalog.jsonb_typeof(feature) is distinct from 'string'
        or (feature #>> '{}' in ('text', 'tables', 'images')) is not true
    )
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(v_authority->'supportedFeatures'))
      <> (select pg_catalog.count(distinct feature) from pg_catalog.jsonb_array_elements_text(v_authority->'supportedFeatures') feature)
    or v_authority->'supportedFeatures' is distinct from (
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(feature) order by
        case feature when 'images' then 1 when 'tables' then 2 when 'text' then 3 end)
      from pg_catalog.jsonb_array_elements_text(v_authority->'supportedFeatures') feature
    )
  then
    raise exception 'invalid_trusted_document_authority';
  end if;

  if p_document->'metadata'->>'corpus_scope' is distinct from 'uploaded_local'
    or p_document->'metadata'->>'content_mode' is distinct from 'indexed_content'
    or p_document->'metadata'->'authority' is distinct from v_authority
  then
    raise exception 'invalid_trusted_document_authority_binding';
  end if;

  foreach v_date_key in array array['publicationDate', 'effectiveDate', 'reviewDate', 'expiryDate'] loop
    if v_authority->v_date_key is distinct from 'null'::jsonb then
      if pg_catalog.jsonb_typeof(v_authority->v_date_key) is distinct from 'string'
        or v_authority->>v_date_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then
        raise exception 'invalid_trusted_document_authority_date';
      end if;
      v_date_value := v_authority->>v_date_key;
      begin
        perform v_date_value::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'invalid_trusted_document_authority_date';
      end;
    end if;
  end loop;

  if v_authority->'supersedesDocumentId' is distinct from 'null'::jsonb then
    begin
      v_supersedes_document_id := (v_authority->>'supersedesDocumentId')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_trusted_document_supersedes_id';
    end;
    if v_authority->>'supersedesDocumentId' is distinct from v_supersedes_document_id::text
      or v_supersedes_document_id = v_document_id
    then
      raise exception 'invalid_trusted_document_supersedes_id';
    end if;
  end if;

  v_admission_digest := 'sha256:' || pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_admission::text, 'UTF8'), 'sha256'), 'hex');
  v_document_input_digest := 'sha256:' || pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_document::text, 'UTF8'), 'sha256'), 'hex');
  v_request_digest := 'sha256:' || pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'actor_kind', p_actor_kind,
      'actor_identity', v_actor_identity,
      'admission_digest', v_admission_digest,
      'document_input_digest', v_document_input_digest
    )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'trusted-document-admission:replay:' || p_actor_kind || ':' || v_actor_identity || ':' ||
      (p_admission->>'source_channel') || ':' || v_correlation_id::text,
    0
  ));

  select event.* into v_existing_event
  from public.document_admission_events event
  where event.source_channel = p_admission->>'source_channel'
    and event.correlation_id = v_correlation_id
    and event.actor_kind = p_actor_kind
    and event.administrator_id is not distinct from p_administrator_id
    and event.backend_principal is not distinct from p_backend_principal
  for share;

  if found then
    if v_existing_event.request_digest is distinct from v_request_digest then
      raise exception 'admission_replay_conflict';
    end if;

    select document.* into v_document
    from public.documents document
    where document.id = v_existing_event.document_id
      and document.owner_id = v_existing_event.staging_owner_id
      and document.content_hash = v_content_hex;

    select job.* into v_job
    from public.ingestion_jobs job
    where job.id = v_existing_event.ingestion_job_id
      and job.document_id = v_existing_event.document_id;

    if v_document.id is null or v_job.id is null then
      raise exception 'admission_replay_state_missing' using errcode = '55000';
    end if;

    return pg_catalog.jsonb_build_object(
      'outcome', 'replayed',
      'admission_event_id', v_existing_event.id,
      'document', pg_catalog.to_jsonb(v_document),
      'job', pg_catalog.to_jsonb(v_job)
    );
  end if;

  if p_replay_only then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'trusted-document-admission:content:' || v_staging_owner_id::text || ':' || v_content_hex,
    0
  ));

  if exists (
    select 1 from public.documents document
    where document.owner_id = v_staging_owner_id
      and document.content_hash = v_content_hex
  ) then
    raise exception 'duplicate_content';
  end if;

  if exists (select 1 from public.documents document where document.id = v_document_id) then
    raise exception 'document_identity_conflict';
  end if;

  -- Retain only caller metadata used for source naming, provenance, and admission diagnostics.
  -- Clinical review, extraction, catalogue, and indexing authority is established
  -- by their owning server workflows rather than by either public admission RPC.
  select coalesce(pg_catalog.jsonb_object_agg(item.key, item.value), '{}'::jsonb)
  into v_metadata
  from pg_catalog.jsonb_each(p_document->'metadata') as item(key, value)
  where item.key = any(array[
    'original_file_name',
    'original_title',
    'smart_title_base',
    'smart_title_group_key',
    'smart_title_duplicate_index',
    'smart_title_duplicate_reason',
    'version',
    'max_upload_mb',
    'queue_batch_size'
  ]);

  v_metadata := v_metadata || pg_catalog.jsonb_build_object(
    'source_title', p_document->>'title',
    'uploaded_by', v_staging_owner_id,
    'source_path', case when p_document ? 'source_path' then p_document->'source_path' else 'null'::jsonb end,
    'import_batch_id', v_import_batch_id,
    'admission_max_attempts', v_max_attempts,
    'confidentiality_scope', 'guidelines-only',
    'content_hash', v_content_hex,
    'uploaded_at', v_now,
    'admission_event_id', v_event_id,
    'admission_policy_version', 'trusted-document-admission-v1',
    'authority', v_authority,
    'corpus_scope', 'uploaded_local',
    'content_mode', 'indexed_content',
    'source_role', v_authority->>'sourceRole',
    'authority_basis', v_authority->>'authorityBasis',
    'licence_policy', v_authority->>'licencePolicy',
    'rights_evidence_ref', v_authority->>'rightsEvidenceRef',
    'publisher', v_authority->>'publisher',
    'jurisdiction', 'Australia',
    'publication_date', v_authority->'publicationDate',
    'effective_date', v_authority->'effectiveDate',
    'review_date', v_authority->'reviewDate',
    'expiry_date', v_authority->'expiryDate',
    'publisher_code', null,
    'indexed_at', null,
    'document_status', v_authority->>'currentness',
    'clinical_validation_status', 'unverified',
    'extraction_quality', 'unknown',
    'supersedes_document_id', v_authority->'supersedesDocumentId',
    'purpose', 'clinical_retrieval',
    'supported_features', v_authority->'supportedFeatures',
    'provider_processing', v_authority->>'providerProcessing',
    'technical_ready', false,
    'passage_ready', false,
    'provider_ready', false
  );

  begin
    insert into public.documents (
      id, owner_id, title, description, file_name, file_type, file_size,
      storage_path, content_hash, source_path, import_batch_id, status, metadata
    ) values (
      v_document_id,
      v_staging_owner_id,
      p_document->>'title',
      case when p_document->'description' is distinct from 'null'::jsonb
        then p_document->>'description' else null end,
      p_document->>'file_name',
      p_document->>'file_type',
      (p_document->>'file_size')::bigint,
      p_document->>'storage_path',
      v_content_hex,
      case when p_document ? 'source_path' and p_document->'source_path' is distinct from 'null'::jsonb
        then p_document->>'source_path' else null end,
      v_import_batch_id,
      'queued',
      v_metadata
    ) returning * into v_document;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'documents_owner_content_hash_unique_idx' then
      raise exception 'duplicate_content';
    elsif v_constraint_name = 'documents_pkey' then
      raise exception 'document_identity_conflict';
    end if;
    raise;
  end;

  insert into public.ingestion_jobs (
    id, document_id, batch_id, status, stage, progress, max_attempts
  ) values (
    v_job_id, v_document.id, v_import_batch_id, 'pending', 'queued', 0, v_max_attempts
  ) returning * into v_job;

  insert into public.document_admission_events (
    id, document_id, ingestion_job_id, staging_owner_id, source_channel,
    actor_kind, administrator_id, backend_principal, correlation_id,
    admission_policy_version, content_sha256, file_name_sha256,
    storage_path_sha256, mime_type, byte_count, authority,
    admission_digest, document_input_digest, request_digest, created_at
  ) values (
    v_event_id, v_document.id, v_job.id, v_staging_owner_id,
    p_admission->>'source_channel', p_actor_kind, p_administrator_id,
    p_backend_principal, v_correlation_id, 'trusted-document-admission-v1',
    p_admission->>'content_sha256', p_admission->>'file_name_sha256',
    p_admission->>'storage_path_sha256', p_admission->>'mime_type',
    (p_admission->>'byte_count')::bigint, v_authority,
    v_admission_digest, v_document_input_digest, v_request_digest, v_now
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'created',
    'admission_event_id', v_event_id,
    'document', pg_catalog.to_jsonb(v_document),
    'job', pg_catalog.to_jsonb(v_job)
  );
end;
$$;

alter function public.trusted_document_admission_core(jsonb, jsonb, boolean, text, uuid, text)
  owner to postgres;
revoke all on function public.trusted_document_admission_core(jsonb, jsonb, boolean, text, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.admit_administrator_document(
  p_admission jsonb,
  p_document jsonb,
  p_replay_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_recent_assurance boolean := false;
begin
  if v_uid is null
    or pg_catalog.jsonb_typeof(v_jwt) is distinct from 'object'
    or v_jwt->>'role' is distinct from 'authenticated'
    or v_jwt->>'sub' is distinct from v_uid::text
    or v_jwt#>>'{app_metadata,site_role}' is distinct from 'administrator'
    or v_jwt->>'aal' is distinct from 'aal2'
    or pg_catalog.jsonb_typeof(v_jwt->'amr') is distinct from 'array'
  then
    raise exception 'administrator_assurance_required';
  end if;

  select exists(
    select 1
    from pg_catalog.jsonb_array_elements(v_jwt->'amr') as methods(amr)
    where pg_catalog.jsonb_typeof(amr) = 'object'
      and amr->>'method' in ('password', 'otp', 'totp', 'webauthn')
      and case when pg_catalog.jsonb_typeof(amr->'timestamp') = 'number' then
        pg_catalog.to_timestamp((amr->>'timestamp')::double precision) <= v_now
          and pg_catalog.to_timestamp((amr->>'timestamp')::double precision) >= v_now - interval '900 seconds'
      else false end
  )
  into v_recent_assurance
  ;

  if not v_recent_assurance then
    raise exception 'administrator_recent_authentication_required';
  end if;

  return public.trusted_document_admission_core(
    p_admission, p_document, p_replay_only, 'administrator', v_uid, null
  );
end;
$$;

alter function public.admit_administrator_document(jsonb, jsonb, boolean) owner to postgres;
revoke all on function public.admit_administrator_document(jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admit_administrator_document(jsonb, jsonb, boolean)
  to authenticated;

create or replace function public.admit_backend_document(
  p_admission jsonb,
  p_document jsonb,
  p_principal text,
  p_capability text,
  p_replay_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_principal public.trusted_ingestion_backend_principals%rowtype;
  v_capability_sha256 text;
begin
  if auth.jwt()->>'role' is distinct from 'service_role'
    or pg_catalog.length(p_principal) not between 1 and 200
    or p_principal is distinct from pg_catalog.btrim(p_principal)
    or p_principal ~ '[[:cntrl:]]'
    or p_capability !~ '^[0-9a-f]{64}$'
  then
    raise exception 'trusted_backend_authority_required';
  end if;

  v_capability_sha256 := 'sha256:' || pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_capability, 'UTF8'), 'sha256'), 'hex');

  select principal.* into v_principal
  from public.trusted_ingestion_backend_principals principal
  where principal.principal = p_principal
    and principal.enabled
  for share;

  if not found or v_principal.capability_sha256 is distinct from v_capability_sha256 then
    raise exception 'trusted_backend_authority_required';
  end if;

  if p_admission->>'staging_owner_id' is distinct from v_principal.staging_owner_id::text then
    raise exception 'trusted_backend_staging_owner_mismatch';
  end if;

  return public.trusted_document_admission_core(
    p_admission, p_document, p_replay_only, 'trusted_backend', null, v_principal.principal
  );
end;
$$;

alter function public.admit_backend_document(jsonb, jsonb, text, text, boolean) owner to postgres;
revoke all on function public.admit_backend_document(jsonb, jsonb, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admit_backend_document(jsonb, jsonb, text, text, boolean)
  to service_role;

-- Preserve the old signature only as an explicit denial.  Possession of a
-- generic service credential no longer confers document-admission authority.
create or replace function public.create_uploaded_document_with_ingestion_job(
  p_document jsonb,
  p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'trusted_document_admission_required' using errcode = '42501';
end;
$$;

alter function public.create_uploaded_document_with_ingestion_job(jsonb, integer) owner to postgres;
revoke all on function public.create_uploaded_document_with_ingestion_job(jsonb, integer)
  from public, anon, authenticated, service_role;

revoke all on function public.reject_document_admission_event_mutation()
  from public, anon, authenticated, service_role;
