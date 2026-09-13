-- U05 exact document-generation lifecycle. Source-only; no operation is performed here.

create or replace function public.document_generation_local_digest_v1(p_value jsonb)
returns text language sql immutable set search_path = '' as $$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(public.shadow_node_value_text_v1(p_value), 'UTF8'), 'sha256'),
    'hex'
  )
$$;
alter function public.document_generation_local_digest_v1(jsonb) owner to postgres;
revoke all on function public.document_generation_local_digest_v1(jsonb) from public,anon,authenticated,service_role;

create table public.document_index_generation_operations (
  id uuid primary key default gen_random_uuid(),
  operation_kind text not null
    check (operation_kind in ('promote','rollback','cleanup')),
  candidate_generation_id uuid,
  promotion_operation_id uuid,
  manifest_digest text not null unique,
  receipt_digest text not null unique,
  receipt jsonb not null,
  rollback_state jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint document_index_generation_operations_digests check (
    manifest_digest ~ '^sha256:[0-9a-f]{64}$'
    and receipt_digest ~ '^sha256:[0-9a-f]{64}$'
    and receipt->>'receiptDigest' = receipt_digest
  ),
  constraint document_index_generation_operations_shapes check (
    pg_catalog.jsonb_typeof(receipt) = 'object'
    and pg_catalog.jsonb_typeof(rollback_state) = 'array'
  )
);
alter table public.document_index_generation_operations owner to postgres;
alter table public.document_index_generation_operations enable row level security;
revoke all on table public.document_index_generation_operations from public,anon,authenticated,service_role;
grant select on table public.document_index_generation_operations to service_role;

create or replace function public.guard_document_index_generation_operations_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op not in ('INSERT') then
    raise exception 'document_generation_operation_append_only' using errcode='23514';
  end if;
  return null;
end $$;
alter function public.guard_document_index_generation_operations_append_only() owner to postgres;
revoke all on function public.guard_document_index_generation_operations_append_only() from public,anon,authenticated,service_role;
create trigger document_index_generation_operations_append_only
before update or delete or truncate on public.document_index_generation_operations
for each statement execute function public.guard_document_index_generation_operations_append_only();

alter table public.document_index_generations
  add column activated_at timestamptz,
  add column retained_until timestamptz,
  add column cleaned_at timestamptz,
  add column activation_operation_id uuid,
  add column last_operation_id uuid;

alter table public.document_index_generations
  drop constraint document_index_generations_state,
  drop constraint document_index_generations_lifecycle,
  add constraint document_index_generations_state check (state in ('reserved','building','staged','active','retained','abandoned')),
  add constraint document_index_generations_lifecycle check (
    (state='reserved' and first_lease_token is null and claimed_at is null
      and stage_receipt is null and stage_receipt_digest is null and staged_at is null
      and inventory_digest is null and candidate_projection_digest is null
      and activated_at is null and retained_until is null and cleaned_at is null)
    or (state='building' and first_lease_token is not null and claimed_at is not null
      and stage_receipt is null and stage_receipt_digest is null and staged_at is null
      and inventory_digest is null and candidate_projection_digest is null
      and activated_at is null and retained_until is null and cleaned_at is null)
    or (state='staged' and first_lease_token is not null and claimed_at is not null
      and stage_receipt is not null and stage_receipt_digest is not null and staged_at is not null
      and expected_inventory_digest is not null and inventory_digest is not null and candidate_projection_digest is not null
      and activated_at is null and retained_until is null and cleaned_at is null)
    or (state='active' and stage_receipt is not null and stage_receipt_digest is not null
      and staged_at is not null and activated_at is not null and retained_until is null and cleaned_at is null)
    or (state='retained' and stage_receipt is not null and stage_receipt_digest is not null
      and staged_at is not null and activated_at is not null and retained_until is not null)
    or state='abandoned'
  ),
  add constraint document_index_generations_cleanup_state check (
    cleaned_at is null or state in ('retained','abandoned')
  );

create unique index document_index_generations_one_active_per_document_uidx
  on public.document_index_generations(document_id) where state='active';

create or replace function public.document_generation_lifecycle_update_authorized_v1(
  p_old public.document_index_generations,p_new public.document_index_generations
)
returns boolean language sql stable security definer set search_path = '' as $$
  select current_user='postgres'
    and p_new.last_operation_id is not null
    and pg_catalog.to_jsonb(p_old)-array[
      'state','activated_at','retained_until','cleaned_at','activation_operation_id','last_operation_id'
    ] is not distinct from pg_catalog.to_jsonb(p_new)-array[
      'state','activated_at','retained_until','cleaned_at','activation_operation_id','last_operation_id'
    ]
    and exists(
      select 1 from public.document_index_generation_operations o
      where o.id=p_new.last_operation_id
        and o.created_at>=pg_catalog.transaction_timestamp()
        and (
          (o.operation_kind in ('promote','rollback') and exists(
            select 1 from pg_catalog.jsonb_array_elements(o.receipt->'transitions') t
            where t->>'documentId'=p_new.document_id::text
              and (
                (p_old.state='staged' and p_new.state='active'
                  and (t->>'toGenerationId')::uuid=p_new.index_generation_id
                  and p_new.activated_at=o.created_at and p_new.activation_operation_id=o.id
                  and p_new.retained_until is null and p_new.cleaned_at is null)
                or (p_old.state='active' and p_new.state='retained'
                  and (t->>'fromGenerationId')::uuid=p_old.index_generation_id
                  and p_new.retained_until=(t->>'retainedUntil')::timestamptz)
                or (p_old.state='retained' and p_new.state='active'
                  and (t->>'toGenerationId')::uuid=p_new.index_generation_id
                  and p_new.retained_until is null and p_new.cleaned_at is null)
              )
          ))
          or (o.operation_kind='cleanup' and p_new.state=p_old.state
            and p_old.state in ('retained','abandoned')
            and p_old.cleaned_at is null and p_new.cleaned_at=o.created_at
            and exists(select 1 from pg_catalog.jsonb_array_elements(o.receipt->'targets') t
              where t->>'documentId'=p_new.document_id::text
                and t->>'generationId'=p_new.index_generation_id::text))
        )
    )
$$;
alter function public.document_generation_lifecycle_update_authorized_v1(
  public.document_index_generations,public.document_index_generations
) owner to postgres;
revoke all on function public.document_generation_lifecycle_update_authorized_v1(
  public.document_index_generations,public.document_index_generations
) from public,anon,authenticated,service_role;

create or replace function public.guard_document_generation_lifecycle_update_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.document_generation_lifecycle_update_authorized_v1(old,new)
    then raise exception 'document_generation_lifecycle_update_not_authorized'; end if;
  return new;
end $$;
alter function public.guard_document_generation_lifecycle_update_v1() owner to postgres;
revoke all on function public.guard_document_generation_lifecycle_update_v1() from public,anon,authenticated,service_role;

drop trigger document_index_generations_immutability on public.document_index_generations;
create trigger document_index_generations_immutability_insert_delete
  before insert or delete on public.document_index_generations
  for each row execute function public.shadow_ledger_guard_v1();
create trigger document_index_generations_immutability_update
  before update on public.document_index_generations
  for each row when (not public.document_generation_lifecycle_update_authorized_v1(old,new))
  execute function public.shadow_ledger_guard_v1();
create trigger document_index_generations_lifecycle_update
  before update on public.document_index_generations
  for each row when (public.document_generation_lifecycle_update_authorized_v1(old,new))
  execute function public.guard_document_generation_lifecycle_update_v1();

-- Serving always follows the document pointer exactly. NULL remains the legacy
-- G0 identity only while the document pointer is also NULL.
create or replace function public.is_committed_document_generation(row_generation uuid,document_metadata jsonb)
returns boolean language sql stable set search_path = public,extensions,pg_temp as $$
  select row_generation is not distinct from
    nullif(coalesce(document_metadata,'{}'::jsonb)->>'index_generation_id','')::uuid
$$;
create or replace function public.is_committed_document_generation(row_generation uuid,document_generation uuid)
returns boolean language sql stable set search_path = public,extensions,pg_temp as $$
  select row_generation is not distinct from document_generation
$$;
create or replace function public.is_committed_artifact_generation(artifact_metadata jsonb,document_metadata jsonb)
returns boolean language sql stable set search_path = public,extensions,pg_temp as $$
  select nullif(coalesce(artifact_metadata,'{}'::jsonb)->>'index_generation_id','')::uuid
    is not distinct from
    nullif(coalesce(document_metadata,'{}'::jsonb)->>'index_generation_id','')::uuid
$$;
create or replace function public.is_committed_artifact_generation(artifact_generation_id uuid,document_metadata jsonb)
returns boolean language sql stable set search_path = public,extensions,pg_temp as $$
  select artifact_generation_id is not distinct from
    nullif(coalesce(document_metadata,'{}'::jsonb)->>'index_generation_id','')::uuid
$$;

create or replace function public.document_generation_serving_snapshot_v1(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_document public.documents%rowtype;
  v_summary jsonb;
  v_labels jsonb;
  v_quality jsonb;
  v_aliases jsonb;
begin
  select * into strict v_document from public.documents where id=p_document_id;
  select pg_catalog.to_jsonb(s) into v_summary
    from public.document_summaries s where s.document_id=p_document_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l)
      order by public.shadow_utf16_order_v1(l.id::text)),'[]'::jsonb)
    into v_labels
    from public.document_labels l where l.document_id=p_document_id and l.source='generated';
  select pg_catalog.to_jsonb(q) into v_quality
    from public.document_index_quality q where q.document_id=p_document_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a)
      order by public.shadow_utf16_order_v1(a.id::text)),'[]'::jsonb)
    into v_aliases from public.rag_aliases a
    where a.metadata->>'document_id'=p_document_id::text
      and a.metadata->>'generated_by'='local-worker';
  return pg_catalog.jsonb_build_object(
    'documentId',p_document_id,
    'document',pg_catalog.jsonb_build_object(
      'status',v_document.status,
      'page_count',v_document.page_count,
      'chunk_count',v_document.chunk_count,
      'image_count',v_document.image_count,
      'error_message',v_document.error_message,
      'metadata',v_document.metadata
    ),
    'summary',coalesce(v_summary,'null'::jsonb),
    'generatedLabels',v_labels,
    'quality',coalesce(v_quality,'null'::jsonb),
    'producerAliases',v_aliases
  );
end $$;
alter function public.document_generation_serving_snapshot_v1(uuid) owner to postgres;
revoke all on function public.document_generation_serving_snapshot_v1(uuid) from public,anon,authenticated,service_role;

create or replace function public.apply_document_generation_projection_v1(
  p_member public.document_index_generations,
  p_projection public.document_generation_projections
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_summary public.document_summaries%rowtype;
  v_label public.document_labels%rowtype;
  v_quality public.document_index_quality%rowtype;
  v_alias public.rag_aliases%rowtype;
  v_document public.documents%rowtype;
begin
  perform public.shadow_validate_projection_components_v1(p_member,p_projection);
  select * into strict v_document from public.documents where id=p_member.document_id for update;

  update public.documents set
    status=p_projection.document_counts->>'status',
    page_count=(p_projection.document_counts->>'page_count')::integer,
    chunk_count=(p_projection.document_counts->>'chunk_count')::integer,
    image_count=(p_projection.document_counts->>'image_count')::integer,
    error_message=p_projection.document_counts->>'error_message',
    metadata=v_document.metadata
      || (p_projection.worker_metadata-'index_generation_id')
      || coalesce(p_projection.deep_memory_metadata,'{}'::jsonb),
    updated_at=pg_catalog.clock_timestamp()
  where id=p_member.document_id;

  delete from public.document_summaries where document_id=p_member.document_id;
  if p_projection.summary is not null then
    select * into v_summary from pg_catalog.jsonb_populate_record(null::public.document_summaries,p_projection.summary);
    insert into public.document_summaries(
      id,document_id,owner_id,summary,clinical_specifics,source_chunk_ids,source_image_ids,model,metadata,
      generated_at,created_at,updated_at
    ) values (
      v_summary.id,v_summary.document_id,v_summary.owner_id,v_summary.summary,v_summary.clinical_specifics,
      v_summary.source_chunk_ids,v_summary.source_image_ids,v_summary.model,v_summary.metadata,
      v_summary.generated_at,v_summary.created_at,v_summary.updated_at
    );
  end if;

  delete from public.document_labels where document_id=p_member.document_id and source='generated';
  for v_label in select * from pg_catalog.jsonb_populate_recordset(
    null::public.document_labels,p_projection.generated_labels
  ) loop
    insert into public.document_labels(
      id,document_id,owner_id,label,label_type,source,confidence,metadata,created_at,updated_at
    ) values (
      v_label.id,v_label.document_id,v_label.owner_id,v_label.label,v_label.label_type,v_label.source,
      v_label.confidence,v_label.metadata,v_label.created_at,v_label.updated_at
    );
  end loop;

  delete from public.document_index_quality where document_id=p_member.document_id;
  if p_projection.quality is not null then
    select * into v_quality from pg_catalog.jsonb_populate_record(null::public.document_index_quality,p_projection.quality);
    insert into public.document_index_quality(
      document_id,owner_id,quality_score,extraction_quality,anchor_coverage,model_fallback_rate,noisy_unit_rate,
      retrievable_visual_hit,source_span_coverage,typed_unit_coverage,metrics,issues,updated_at
    ) values (
      v_quality.document_id,v_quality.owner_id,v_quality.quality_score,v_quality.extraction_quality,
      v_quality.anchor_coverage,v_quality.model_fallback_rate,v_quality.noisy_unit_rate,
      v_quality.retrievable_visual_hit,v_quality.source_span_coverage,v_quality.typed_unit_coverage,
      v_quality.metrics,v_quality.issues,v_quality.updated_at
    );
  end if;

  delete from public.rag_aliases a where a.metadata->>'document_id'=p_member.document_id::text
    and a.metadata->>'generated_by'='local-worker';
  for v_alias in select * from pg_catalog.jsonb_populate_recordset(
    null::public.rag_aliases,coalesce(p_projection.producer_aliases,'[]'::jsonb)
  ) loop
    if v_alias.metadata->>'document_id' is distinct from p_member.document_id::text
      or v_alias.metadata->>'generated_by' is distinct from 'local-worker'
      or v_alias.metadata->>'index_generation_id' is distinct from p_member.index_generation_id::text
      or v_alias.owner_id is distinct from p_member.owner_id
    then raise exception 'document_generation_alias_projection_mismatch'; end if;
    insert into public.rag_aliases(id,owner_id,alias,canonical,alias_type,weight,enabled,metadata,created_at,updated_at)
    values(v_alias.id,v_alias.owner_id,v_alias.alias,v_alias.canonical,v_alias.alias_type,v_alias.weight,
      v_alias.enabled,v_alias.metadata,v_alias.created_at,v_alias.updated_at);
  end loop;
end $$;
alter function public.apply_document_generation_projection_v1(public.document_index_generations,public.document_generation_projections) owner to postgres;
revoke all on function public.apply_document_generation_projection_v1(public.document_index_generations,public.document_generation_projections) from public,anon,authenticated,service_role;

create or replace function public.apply_document_generation_snapshot_v1(p_document_id uuid,p_snapshot jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_document jsonb;
  v_summary public.document_summaries%rowtype;
  v_label public.document_labels%rowtype;
  v_quality public.document_index_quality%rowtype;
  v_alias public.rag_aliases%rowtype;
begin
  if not public.shadow_keys_v1(p_snapshot,array[
      'documentId','document','summary','generatedLabels','quality','producerAliases'])
    or p_snapshot->>'documentId' is distinct from p_document_id::text
    or not public.shadow_keys_v1(p_snapshot->'document',array['status','page_count','chunk_count','image_count','error_message','metadata'])
    or pg_catalog.jsonb_typeof(p_snapshot->'generatedLabels') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_snapshot->'producerAliases') is distinct from 'array'
  then raise exception 'invalid_document_generation_snapshot'; end if;
  v_document:=p_snapshot->'document';
  update public.documents set
    status=v_document->>'status',
    page_count=(v_document->>'page_count')::integer,
    chunk_count=(v_document->>'chunk_count')::integer,
    image_count=(v_document->>'image_count')::integer,
    error_message=v_document->>'error_message',
    metadata=(v_document->'metadata')-'index_generation_id',
    updated_at=pg_catalog.clock_timestamp()
  where id=p_document_id;
  if not found then raise exception 'document_generation_snapshot_document_missing'; end if;

  delete from public.document_summaries where document_id=p_document_id;
  if p_snapshot->'summary'<>'null'::jsonb then
    select * into v_summary from pg_catalog.jsonb_populate_record(null::public.document_summaries,p_snapshot->'summary');
    if v_summary.document_id is distinct from p_document_id then raise exception 'invalid_document_generation_snapshot'; end if;
    insert into public.document_summaries(
      id,document_id,owner_id,summary,clinical_specifics,source_chunk_ids,source_image_ids,model,metadata,
      generated_at,created_at,updated_at
    ) values (
      v_summary.id,v_summary.document_id,v_summary.owner_id,v_summary.summary,v_summary.clinical_specifics,
      v_summary.source_chunk_ids,v_summary.source_image_ids,v_summary.model,v_summary.metadata,
      v_summary.generated_at,v_summary.created_at,v_summary.updated_at
    );
  end if;

  delete from public.document_labels where document_id=p_document_id and source='generated';
  for v_label in select * from pg_catalog.jsonb_populate_recordset(
    null::public.document_labels,p_snapshot->'generatedLabels'
  ) loop
    if v_label.document_id is distinct from p_document_id or v_label.source is distinct from 'generated'
      then raise exception 'invalid_document_generation_snapshot'; end if;
    insert into public.document_labels(
      id,document_id,owner_id,label,label_type,source,confidence,metadata,created_at,updated_at
    ) values (
      v_label.id,v_label.document_id,v_label.owner_id,v_label.label,v_label.label_type,v_label.source,
      v_label.confidence,v_label.metadata,v_label.created_at,v_label.updated_at
    );
  end loop;

  delete from public.document_index_quality where document_id=p_document_id;
  if p_snapshot->'quality'<>'null'::jsonb then
    select * into v_quality from pg_catalog.jsonb_populate_record(null::public.document_index_quality,p_snapshot->'quality');
    if v_quality.document_id is distinct from p_document_id then raise exception 'invalid_document_generation_snapshot'; end if;
    insert into public.document_index_quality(
      document_id,owner_id,quality_score,extraction_quality,anchor_coverage,model_fallback_rate,noisy_unit_rate,
      retrievable_visual_hit,source_span_coverage,typed_unit_coverage,metrics,issues,updated_at
    ) values (
      v_quality.document_id,v_quality.owner_id,v_quality.quality_score,v_quality.extraction_quality,
      v_quality.anchor_coverage,v_quality.model_fallback_rate,v_quality.noisy_unit_rate,
      v_quality.retrievable_visual_hit,v_quality.source_span_coverage,v_quality.typed_unit_coverage,
      v_quality.metrics,v_quality.issues,v_quality.updated_at
    );
  end if;

  delete from public.rag_aliases a where a.metadata->>'document_id'=p_document_id::text
    and a.metadata->>'generated_by'='local-worker';
  for v_alias in select * from pg_catalog.jsonb_populate_recordset(
    null::public.rag_aliases,p_snapshot->'producerAliases'
  ) loop
    if v_alias.metadata->>'document_id' is distinct from p_document_id::text
      or v_alias.metadata->>'generated_by' is distinct from 'local-worker'
    then raise exception 'invalid_document_generation_snapshot'; end if;
    insert into public.rag_aliases(id,owner_id,alias,canonical,alias_type,weight,enabled,metadata,created_at,updated_at)
    values(v_alias.id,v_alias.owner_id,v_alias.alias,v_alias.canonical,v_alias.alias_type,v_alias.weight,
      v_alias.enabled,v_alias.metadata,v_alias.created_at,v_alias.updated_at);
  end loop;
end $$;
alter function public.apply_document_generation_snapshot_v1(uuid,jsonb) owner to postgres;
revoke all on function public.apply_document_generation_snapshot_v1(uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.assert_document_generation_rights_current_v1(p_document_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if exists(select 1 from public.public_source_versions where staging_document_id=p_document_id)
    and public.public_source_document_is_serving_eligible(p_document_id) is not true
  then raise exception 'document_generation_rights_withdrawn'; end if;
end $$;
alter function public.assert_document_generation_rights_current_v1(uuid) owner to postgres;
revoke all on function public.assert_document_generation_rights_current_v1(uuid) from public,anon,authenticated,service_role;

-- U10 replaces this body with exact immutable technical-receipt resolution.
-- Until then every attempted promotion refuses; caller assertions never substitute.
create or replace function public.require_document_generation_technical_gate_v1(
  p_authorization_manifest jsonb,p_evaluation_report jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'document_generation_technical_gate_unavailable' using errcode='55000';
end $$;
alter function public.require_document_generation_technical_gate_v1(jsonb,jsonb) owner to postgres;
revoke all on function public.require_document_generation_technical_gate_v1(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.document_generation_legacy_baseline_proven_v1(
  p_operation_id uuid,p_document_id uuid,p_baseline_generation_id uuid,p_candidate_generation_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  with current_operation as (
    select * from public.document_index_generation_operations where id=p_operation_id
  ), promotion as (
    select p.* from current_operation o
    join public.document_index_generation_operations p
      on p.id=case when o.operation_kind='promote' then o.id else o.promotion_operation_id end
      and p.operation_kind='promote'
  ), saved as (
    select value from promotion p cross join lateral pg_catalog.jsonb_array_elements(p.rollback_state)
    where value->>'documentId'=p_document_id::text
  ), transition as (
    select value from promotion p cross join lateral pg_catalog.jsonb_array_elements(p.receipt->'transitions')
    where value->>'documentId'=p_document_id::text
  )
  select coalesce(
    (select pg_catalog.count(*)=1
      and pg_catalog.bool_and((s.value->>'snapshotDigest') is not distinct from
        public.document_generation_local_digest_v1(s.value->'previousServingSnapshot'))
      and pg_catalog.bool_and(s.value->>'snapshotDigest'=t.value->>'previousServingSnapshotDigest')
      and pg_catalog.bool_and((t.value->>'fromGenerationId')::uuid is not distinct from p_baseline_generation_id)
      and pg_catalog.bool_and((t.value->>'toGenerationId')::uuid=p_candidate_generation_id)
     from saved s cross join transition t
     where (p_baseline_generation_id is null or not exists(
       select 1 from public.shadow_reindex_waves w
       where w.candidate_generation_id=p_baseline_generation_id))
       and exists(select 1 from public.document_index_generations g
       join public.document_generation_baselines b
         on b.document_id=g.document_id and b.candidate_generation_id=g.index_generation_id
       where g.document_id=p_document_id and g.index_generation_id=p_candidate_generation_id
         and g.baseline_generation_id is not distinct from p_baseline_generation_id
         and b.baseline_generation_id is not distinct from p_baseline_generation_id
         and b.expected_state_digest=g.expected_state_digest
         and b.bundle_digest=g.baseline_bundle_digest)),false)
$$;
alter function public.document_generation_legacy_baseline_proven_v1(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function public.document_generation_legacy_baseline_proven_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.transition_document_index_generation_core(
  p_document_id uuid,p_expected_generation_id uuid,p_next_generation_id uuid,p_operation_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_document public.documents%rowtype;
  v_operation public.document_index_generation_operations%rowtype;
  v_transition jsonb;
  v_count bigint;
  v_retained_until timestamptz;
begin
  select * into strict v_operation from public.document_index_generation_operations
    where id=p_operation_id and operation_kind in ('promote','rollback') for share;
  select pg_catalog.count(*),pg_catalog.min(value::text)::jsonb into v_count,v_transition
    from pg_catalog.jsonb_array_elements(v_operation.receipt->'transitions')
    where value->>'documentId'=p_document_id::text;
  if v_count<>1
    or (v_transition->>'fromGenerationId')::uuid is distinct from p_expected_generation_id
    or (v_transition->>'toGenerationId')::uuid is distinct from p_next_generation_id
  then raise exception 'document_generation_transition_not_authorized'; end if;

  select * into strict v_document from public.documents where id=p_document_id for update;
  if v_document.index_generation_id is distinct from p_expected_generation_id
    then raise exception 'document_generation_pointer_changed'; end if;

  v_retained_until:=(v_transition->>'retainedUntil')::timestamptz;
  if v_operation.operation_kind='promote' then
    if v_document.status is distinct from 'indexed' or p_next_generation_id is null
      then raise exception 'document_generation_first_publication_forbidden'; end if;
    if exists(select 1 from public.document_index_generations
      where document_id=p_document_id and index_generation_id=p_expected_generation_id and state<>'active')
      then raise exception 'document_generation_baseline_not_active'; end if;
    if p_expected_generation_id is not null then
      update public.document_index_generations set
        state='retained',retained_until=v_retained_until,last_operation_id=p_operation_id
        where document_id=p_document_id and index_generation_id=p_expected_generation_id and state='active';
      if not found and not public.document_generation_legacy_baseline_proven_v1(
        p_operation_id,p_document_id,p_expected_generation_id,p_next_generation_id)
      then raise exception 'document_generation_baseline_proof_missing'; end if;
    elsif not public.document_generation_legacy_baseline_proven_v1(
      p_operation_id,p_document_id,null,p_next_generation_id)
    then raise exception 'document_generation_baseline_proof_missing'; end if;
    update public.document_index_generations set
      state='active',activated_at=v_operation.created_at,retained_until=null,cleaned_at=null,
      activation_operation_id=p_operation_id,last_operation_id=p_operation_id
      where document_id=p_document_id and index_generation_id=p_next_generation_id and state='staged';
    if not found then raise exception 'document_generation_candidate_not_staged'; end if;
  else
    if p_expected_generation_id is null then raise exception 'document_generation_rollback_source_required'; end if;
    update public.document_index_generations set
      state='retained',retained_until=v_retained_until,last_operation_id=p_operation_id
      where document_id=p_document_id and index_generation_id=p_expected_generation_id
        and state='active' and cleaned_at is null;
    if not found then raise exception 'document_generation_rollback_source_not_active'; end if;
    if p_next_generation_id is not null then
      update public.document_index_generations set
        state='active',retained_until=null,cleaned_at=null,last_operation_id=p_operation_id
        where document_id=p_document_id and index_generation_id=p_next_generation_id
          and state='retained' and cleaned_at is null;
      if not found and not public.document_generation_legacy_baseline_proven_v1(
        p_operation_id,p_document_id,p_next_generation_id,p_expected_generation_id)
      then raise exception 'document_generation_rollback_target_unavailable'; end if;
    elsif not public.document_generation_legacy_baseline_proven_v1(
      p_operation_id,p_document_id,null,p_expected_generation_id)
    then raise exception 'document_generation_rollback_target_unavailable'; end if;
  end if;

  update public.documents set
    metadata=case when p_next_generation_id is null then metadata-'index_generation_id'
      else pg_catalog.jsonb_set(metadata,'{index_generation_id}',pg_catalog.to_jsonb(p_next_generation_id),true) end,
    updated_at=pg_catalog.clock_timestamp()
  where id=p_document_id and index_generation_id is not distinct from p_expected_generation_id;
  if not found then raise exception 'document_generation_pointer_changed'; end if;
end $$;
alter function public.transition_document_index_generation_core(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function public.transition_document_index_generation_core(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.document_generation_cleanup_delete_authorized_v1(
  p_document_id uuid,p_generation_id uuid
)
returns boolean language sql stable set search_path = '' as $$
  select current_user='postgres' and exists(
    select 1
    from public.document_index_generation_operations o
    join public.document_index_generations g
      on g.document_id=p_document_id and g.index_generation_id=p_generation_id
    where o.operation_kind='cleanup'
      and o.created_at>=pg_catalog.transaction_timestamp()
      and g.state in ('retained','abandoned') and g.cleaned_at is null
      and not exists(select 1 from public.documents d
        where d.id=p_document_id and d.index_generation_id=p_generation_id)
      and exists(select 1 from pg_catalog.jsonb_array_elements(o.receipt->'targets') t
        where t->>'documentId'=p_document_id::text and t->>'generationId'=p_generation_id::text)
  )
$$;
alter function public.document_generation_cleanup_delete_authorized_v1(uuid,uuid) owner to postgres;
revoke all on function public.document_generation_cleanup_delete_authorized_v1(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.guard_document_generation_cleanup_delete_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.document_generation_cleanup_delete_authorized_v1(
    (pg_catalog.to_jsonb(old)->>'document_id')::uuid,
    (pg_catalog.to_jsonb(old)->>'index_generation_id')::uuid
  ) then raise exception 'document_generation_cleanup_delete_not_authorized'; end if;
  return old;
end $$;
alter function public.guard_document_generation_cleanup_delete_v1() owner to postgres;
revoke all on function public.guard_document_generation_cleanup_delete_v1() from public,anon,authenticated,service_role;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'document_pages','document_chunks','document_images','document_table_facts',
    'document_embedding_fields','document_index_units','document_sections','document_memory_cards'
  ] loop
    execute pg_catalog.format('drop trigger %I_shadow_retention on public.%I',v_table,v_table);
    execute pg_catalog.format(
      'create trigger %I_shadow_retention before insert or update on public.%I for each row execute function public.shadow_artifact_retention_guard_v1()',
      v_table,v_table);
    execute pg_catalog.format(
      'create trigger %I_u05_cleanup_delete before delete on public.%I for each row when (public.document_generation_cleanup_delete_authorized_v1(old.document_id,old.index_generation_id)) execute function public.guard_document_generation_cleanup_delete_v1()',
      v_table,v_table);
    execute pg_catalog.format(
      'create trigger %I_u05_retained_delete before delete on public.%I for each row when (not public.document_generation_cleanup_delete_authorized_v1(old.document_id,old.index_generation_id)) execute function public.shadow_artifact_retention_guard_v1()',
      v_table,v_table);
  end loop;
end $$;

create or replace function public.document_generation_cleanup_preview_v1(p_targets jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_target jsonb;
  v_document uuid;
  v_generation uuid;
  v_count bigint;
  v_total bigint:=0;
  v_private jsonb;
begin
  for v_target in select value from pg_catalog.jsonb_array_elements(p_targets) loop
    v_document:=(v_target->>'documentId')::uuid;
    v_generation:=(v_target->>'generationId')::uuid;
    select
      (select pg_catalog.count(*) from public.document_pages where document_id=v_document and index_generation_id=v_generation)
      +(select pg_catalog.count(*) from public.document_chunks where document_id=v_document and index_generation_id=v_generation)
      +(select pg_catalog.count(*) from public.document_images where document_id=v_document and index_generation_id=v_generation)
      +(select pg_catalog.count(*) from public.document_table_facts where document_id=v_document and index_generation_id=v_generation)
      +(select pg_catalog.count(*) from public.document_embedding_fields where document_id=v_document and index_generation_id=v_generation)
      +(select pg_catalog.count(*) from public.document_index_units where document_id=v_document and index_generation_id=v_generation)
      +(select pg_catalog.count(*) from public.document_sections where document_id=v_document and index_generation_id=v_generation)
      +(select pg_catalog.count(*) from public.document_memory_cards where document_id=v_document and index_generation_id=v_generation)
      +(select pg_catalog.count(*) from public.rag_aliases a
        where a.metadata->>'document_id'=v_document::text and a.metadata->>'generated_by'='local-worker'
          and a.metadata->>'artifact_generation_id'=(select p.deep_memory_artifact_generation_id::text
            from public.document_generation_projections p
            where p.document_id=v_document and p.index_generation_id=v_generation))
      into v_count;
    v_total:=v_total+v_count;
  end loop;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'documentId',i.document_id,'generationId',i.index_generation_id,'family',i.family,
      'unitKey',i.unit_key,'artifactRef',i.artifact_ref,'contentDigest',i.content_digest)
      order by public.shadow_utf16_order_v1(i.document_id::text),
        public.shadow_utf16_order_v1(i.index_generation_id::text),
        public.shadow_utf16_order_v1(i.family),public.shadow_utf16_order_v1(i.unit_key)),'[]'::jsonb)
    into v_private
    from public.document_generation_inventory i
    join lateral pg_catalog.jsonb_array_elements(p_targets) t on
      i.document_id=(t->>'documentId')::uuid and i.index_generation_id=(t->>'generationId')::uuid
    where i.artifact_ref->>'tag'='private_object';
  -- Evidence inventory only. Physical object deletion requires a separate
  -- disposal manifest that revalidates live/shared/new references and rights.
  return pg_catalog.jsonb_build_object(
    'deletedArtifactCount',v_total,'privateObjectReferenceInventory',v_private,
    'physicalDeletionAuthorized',false);
end $$;
alter function public.document_generation_cleanup_preview_v1(jsonb) owner to postgres;
revoke all on function public.document_generation_cleanup_preview_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.delete_document_index_generations_core(p_targets jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_operation public.document_index_generation_operations%rowtype;
  v_target jsonb;
  v_document uuid;
  v_generation uuid;
  v_count bigint;
  v_total bigint:=0;
  v_private jsonb:='[]'::jsonb;
begin
  select * into strict v_operation from public.document_index_generation_operations
    where id=p_operation_id and operation_kind='cleanup' for share;
  if v_operation.receipt->'targets' is distinct from p_targets
    then raise exception 'document_generation_cleanup_not_authorized'; end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'documentId',i.document_id,'generationId',i.index_generation_id,'family',i.family,
      'unitKey',i.unit_key,'artifactRef',i.artifact_ref,'contentDigest',i.content_digest)
      order by public.shadow_utf16_order_v1(i.document_id::text),
        public.shadow_utf16_order_v1(i.index_generation_id::text),
        public.shadow_utf16_order_v1(i.family),public.shadow_utf16_order_v1(i.unit_key)),'[]'::jsonb)
    into v_private
    from public.document_generation_inventory i
    join lateral pg_catalog.jsonb_array_elements(p_targets) t on
      i.document_id=(t->>'documentId')::uuid and i.index_generation_id=(t->>'generationId')::uuid
    where i.artifact_ref->>'tag'='private_object';

  for v_target in select value from pg_catalog.jsonb_array_elements(p_targets)
    order by public.shadow_utf16_order_v1(value->>'documentId'),public.shadow_utf16_order_v1(value->>'generationId')
  loop
    v_document:=(v_target->>'documentId')::uuid;
    v_generation:=(v_target->>'generationId')::uuid;
    perform 1 from public.documents where id=v_document for update;
    perform 1 from public.document_index_generations
      where document_id=v_document and index_generation_id=v_generation for update;
    if exists(select 1 from public.document_index_generations
        where document_id=v_document and index_generation_id=v_generation and state='active')
      or exists(select 1 from public.documents where id=v_document and index_generation_id=v_generation)
      then raise exception 'document_generation_cleanup_active_forbidden'; end if;

    delete from public.document_index_units where document_id=v_document and index_generation_id=v_generation;
    get diagnostics v_count=row_count;v_total:=v_total+v_count;
    delete from public.document_memory_cards where document_id=v_document and index_generation_id=v_generation;
    get diagnostics v_count=row_count;v_total:=v_total+v_count;
    delete from public.document_sections where document_id=v_document and index_generation_id=v_generation;
    get diagnostics v_count=row_count;v_total:=v_total+v_count;
    delete from public.document_embedding_fields where document_id=v_document and index_generation_id=v_generation;
    get diagnostics v_count=row_count;v_total:=v_total+v_count;
    delete from public.document_table_facts where document_id=v_document and index_generation_id=v_generation;
    get diagnostics v_count=row_count;v_total:=v_total+v_count;
    delete from public.document_images where document_id=v_document and index_generation_id=v_generation;
    get diagnostics v_count=row_count;v_total:=v_total+v_count;
    delete from public.document_chunks where document_id=v_document and index_generation_id=v_generation;
    get diagnostics v_count=row_count;v_total:=v_total+v_count;
    delete from public.document_pages where document_id=v_document and index_generation_id=v_generation;
    get diagnostics v_count=row_count;v_total:=v_total+v_count;
    delete from public.rag_aliases a where a.metadata->>'document_id'=v_document::text
      and a.metadata->>'generated_by'='local-worker'
      and a.metadata->>'artifact_generation_id'=(select p.deep_memory_artifact_generation_id::text
        from public.document_generation_projections p
        where p.document_id=v_document and p.index_generation_id=v_generation);
    get diagnostics v_count=row_count;v_total:=v_total+v_count;
  end loop;
  if v_total is distinct from (v_operation.receipt->>'deletedArtifactCount')::bigint
    or v_private is distinct from v_operation.receipt->'privateObjectReferenceInventory'
    or v_operation.receipt->'physicalDeletionAuthorized' is distinct from 'false'::jsonb
  then raise exception 'document_generation_cleanup_result_changed'; end if;
  return pg_catalog.jsonb_build_object(
    'deletedArtifactCount',v_total,
    'privateObjectReferenceInventory',v_private,'physicalDeletionAuthorized',false
  );
end $$;
alter function public.delete_document_index_generations_core(jsonb,uuid) owner to postgres;
revoke all on function public.delete_document_index_generations_core(jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function public.promote_shadow_document_generation(
  p_plan jsonb,p_stage_receipt jsonb,p_evaluation_report jsonb,p_authorization_manifest jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan_payload jsonb;
  v_plan jsonb;
  v_stage jsonb;
  v_evaluation jsonb;
  v_authorization jsonb;
  v_candidate uuid;
  v_document jsonb;
  v_member public.document_index_generations%rowtype;
  v_projection public.document_generation_projections%rowtype;
  v_current jsonb;
  v_previous jsonb;
  v_candidate_snapshot jsonb;
  v_rollback jsonb:='[]'::jsonb;
  v_transitions jsonb:='[]'::jsonb;
  v_receipt jsonb;
  v_existing public.document_index_generation_operations%rowtype;
  v_operation_id uuid:=gen_random_uuid();
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_retained_until timestamptz;
  v_ids jsonb;
  v_member_receipt jsonb;
  v_stage_member jsonb;
begin
  v_plan_payload:=public.shadow_node_payload_v1(p_plan,'plan');
  if not public.shadow_keys_v1(v_plan_payload,array['version','plan','audit']) then
    raise exception 'invalid_document_generation_plan'; end if;
  v_plan:=v_plan_payload->'plan';
  v_stage:=public.shadow_inventory_envelope_payload_v1(p_stage_receipt);
  v_evaluation:=public.shadow_node_payload_v1(p_evaluation_report,'evaluation_report');
  if p_stage_receipt->>'domain' is distinct from 'wave_receipt'
    or p_stage_receipt->>'encoding' is distinct from 'pg-jsonb-text-v1'
    or not public.shadow_keys_v1(p_authorization_manifest,array['authorization','promoteAuthorizationDigest'])
  then raise exception 'invalid_document_generation_promotion'; end if;
  v_authorization:=p_authorization_manifest->'authorization';
  if not public.shadow_keys_v1(v_authorization,array[
      'version','operation','targetProjectRef','candidateGenerationId','planDigest','stageReceiptDigest',
      'evaluationReportDigest','recoveryEvidenceDigest','stageAuthorizationDigest','expectedDocumentIds',
      'expectedDocumentCount','expectedTechnicalEvidenceReceiptDigests','authorizedAt','expiresAt',
      'retainedUntil','confirmationSha256'])
    or v_authorization->'version' is distinct from '1'::jsonb
    or v_authorization->>'operation' is distinct from 'promote'
    or p_authorization_manifest->>'promoteAuthorizationDigest'
      is distinct from public.document_generation_local_digest_v1(v_authorization)
    or v_authorization->>'confirmationSha256' !~ '^sha256:[0-9a-f]{64}$'
  then raise exception 'invalid_document_generation_promotion_manifest'; end if;

  v_candidate:=(v_plan->>'candidateGenerationId')::uuid;
  v_retained_until:=public.shadow_audit_timestamp_v1(v_authorization->'retainedUntil');

  select pg_catalog.jsonb_agg(value->'documentId'
      order by public.shadow_utf16_order_v1(value->>'documentId')) into v_ids
    from pg_catalog.jsonb_array_elements(v_plan->'documents');
  if v_authorization->>'targetProjectRef' is distinct from v_plan->>'targetProjectRef'
    or v_authorization->>'candidateGenerationId' is distinct from v_candidate::text
    or v_authorization->>'planDigest' is distinct from p_plan->>'digest'
    or v_authorization->>'stageReceiptDigest' is distinct from p_stage_receipt->>'digest'
    or v_authorization->>'evaluationReportDigest' is distinct from p_evaluation_report->>'digest'
    or v_authorization->>'recoveryEvidenceDigest' is distinct from v_stage->>'recoveryEvidenceDigest'
    or v_authorization->>'stageAuthorizationDigest' is distinct from v_stage->>'operationManifestDigest'
    or v_authorization->'expectedDocumentIds' is distinct from v_ids
    or v_authorization->'expectedDocumentCount' is distinct from pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(v_ids))
    or pg_catalog.jsonb_array_length(v_authorization->'expectedTechnicalEvidenceReceiptDigests')
      <>pg_catalog.jsonb_array_length(v_ids)
    or pg_catalog.jsonb_array_length(v_stage->'members')<>pg_catalog.jsonb_array_length(v_ids)
    or (select pg_catalog.count(distinct value->>'documentId')
      from pg_catalog.jsonb_array_elements(v_plan->'documents'))<>pg_catalog.jsonb_array_length(v_ids)
    or not exists(select 1 from public.shadow_reindex_waves w
      where w.candidate_generation_id=v_candidate and w.plan_digest=p_plan->>'digest'
        and w.project_ref=v_plan->>'targetProjectRef'
        and w.operation_manifest_digest=v_stage->>'operationManifestDigest')
    or v_stage->>'candidateGenerationId' is distinct from v_candidate::text
    or v_stage->>'planDigest' is distinct from p_plan->>'digest'
    or v_evaluation->>'candidateGenerationId' is distinct from v_candidate::text
    or v_evaluation->>'planDigest' is distinct from p_plan->>'digest'
    or v_evaluation->>'populationFingerprint' is distinct from v_plan->>'populationFingerprint'
    or v_evaluation->>'stageReceiptDigest' is distinct from p_stage_receipt->>'digest'
    or v_evaluation->>'recoveryEvidenceDigest' is distinct from v_stage->>'recoveryEvidenceDigest'
    or not public.shadow_keys_v1(v_evaluation,array[
      'version','planDigest','stageReceiptDigest','recoveryEvidenceDigest','populationFingerprint',
      'candidateGenerationId','baseline','candidate','decision'])
    or not public.shadow_keys_v1(v_evaluation->'decision',array['decision','checks','failures'])
    or pg_catalog.jsonb_typeof(v_evaluation->'decision'->'checks') is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_evaluation->'decision'->'checks')=0
    or v_evaluation->'decision'->>'decision' is distinct from 'GO'
    or v_evaluation->'decision'->'failures' is distinct from '[]'::jsonb
    or exists(select 1 from pg_catalog.jsonb_array_elements(v_evaluation->'decision'->'checks') c
      where c->'passed' is distinct from 'true'::jsonb)
  then raise exception 'document_generation_promotion_evidence_mismatch'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements_text(
      v_authorization->'expectedTechnicalEvidenceReceiptDigests') d
      where d !~ '^sha256:[0-9a-f]{64}$')
  then raise exception 'document_generation_promotion_evidence_mismatch'; end if;

  -- U10 must resolve every immutable successful technical receipt. This always
  -- refuses in U05 and is replaced, never bypassed, by the later gate owner.
  perform public.require_document_generation_technical_gate_v1(p_authorization_manifest,p_evaluation_report);

  select * into v_existing from public.document_index_generation_operations
    where manifest_digest=p_authorization_manifest->>'promoteAuthorizationDigest';
  if found then
    if v_existing.operation_kind<>'promote' or v_existing.candidate_generation_id is distinct from v_candidate
      or v_existing.receipt->>'planDigest' is distinct from p_plan->>'digest'
      or v_existing.receipt->>'stageReceiptDigest' is distinct from p_stage_receipt->>'digest'
      or v_existing.receipt->>'evaluationReportDigest' is distinct from p_evaluation_report->>'digest'
      or v_existing.receipt->>'recoveryEvidenceDigest' is distinct from v_stage->>'recoveryEvidenceDigest'
      or v_existing.receipt->'transitions' is null
      then raise exception 'document_generation_promotion_replay_mismatch'; end if;
    return v_existing.receipt;
  end if;
  if public.shadow_audit_timestamp_v1(v_authorization->'authorizedAt')>v_now
    or public.shadow_audit_timestamp_v1(v_authorization->'expiresAt')<=v_now
    or v_retained_until<=v_now
  then raise exception 'document_generation_promotion_authorization_expired'; end if;

  for v_document in select value from pg_catalog.jsonb_array_elements(v_plan->'documents')
    order by public.shadow_utf16_order_v1(value->>'documentId')
  loop
    select * into strict v_member from public.document_index_generations
      where document_id=(v_document->>'documentId')::uuid
        and index_generation_id=v_candidate for update;
    select * into strict v_projection from public.document_generation_projections
      where document_id=v_member.document_id and index_generation_id=v_candidate for update;
    v_current:=public.lock_ingestion_document_authority(v_member.document_id,false);
    if v_current is null then raise exception 'document_generation_authority_unavailable'; end if;
    perform public.assert_document_generation_rights_current_v1(v_member.document_id);
    perform public.shadow_queue_complete_v1(v_member.job_id);
    perform public.shadow_assert_origin_unchanged_v1(v_member);
    select value into strict v_stage_member from pg_catalog.jsonb_array_elements(v_stage->'members')
      where value->>'documentId'=v_member.document_id::text;
    v_member_receipt:=v_stage_member->'memberReceiptEnvelope';
    if v_member.state<>'staged'
      or v_member.baseline_generation_id is distinct from (v_document->>'baselineGenerationId')::uuid
      or v_member.expected_state_digest is distinct from v_document->>'expectedStateDigest'
      or v_current->'document'->>'status' is distinct from 'indexed'
      or (v_current->'document'->>'index_generation_id')::uuid is distinct from v_member.baseline_generation_id
      or v_member.stage_receipt is distinct from v_member_receipt
      or v_member.stage_receipt_digest is distinct from v_member_receipt->>'digest'
      or v_projection.sealed_at is null
      or (v_projection.deep_memory_digest is not null
        and v_projection.deep_memory_artifact_generation_id is null)
    then raise exception 'document_generation_promotion_member_mismatch'; end if;
    v_previous:=public.document_generation_serving_snapshot_v1(v_member.document_id);
    v_rollback:=v_rollback||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'documentId',v_member.document_id,'previousServingSnapshot',v_previous,
      'snapshotDigest',public.document_generation_local_digest_v1(v_previous)));
  end loop;

  for v_document in select value from pg_catalog.jsonb_array_elements(v_plan->'documents')
    order by public.shadow_utf16_order_v1(value->>'documentId')
  loop
    select * into strict v_member from public.document_index_generations
      where document_id=(v_document->>'documentId')::uuid and index_generation_id=v_candidate;
    select * into strict v_projection from public.document_generation_projections
      where document_id=v_member.document_id and index_generation_id=v_candidate;
    perform public.apply_document_generation_projection_v1(v_member,v_projection);
    v_candidate_snapshot:=public.document_generation_serving_snapshot_v1(v_member.document_id);
    v_candidate_snapshot:=pg_catalog.jsonb_set(v_candidate_snapshot,'{document,metadata,index_generation_id}',
      pg_catalog.to_jsonb(v_candidate),true);
    select value into strict v_previous from pg_catalog.jsonb_array_elements(v_rollback)
      where value->>'documentId'=v_member.document_id::text;
    v_transitions:=v_transitions||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'documentId',v_member.document_id,
      'fromGenerationId',v_member.baseline_generation_id,
      'toGenerationId',v_candidate,
      'previousServingSnapshotDigest',v_previous->'snapshotDigest',
      'candidateServingSnapshotDigest',public.document_generation_local_digest_v1(v_candidate_snapshot),
      'retainedUntil',v_retained_until));
  end loop;

  v_receipt:=pg_catalog.jsonb_build_object(
    'version',1,'kind','document-generation-promotion-v1','operationId',v_operation_id,
    'projectRef',v_plan->'targetProjectRef','candidateGenerationId',v_candidate,
    'planDigest',p_plan->>'digest','stageReceiptDigest',p_stage_receipt->>'digest',
    'evaluationReportDigest',p_evaluation_report->>'digest',
    'recoveryEvidenceDigest',v_stage->>'recoveryEvidenceDigest',
    'stageAuthorizationDigest',v_stage->>'operationManifestDigest',
    'promoteAuthorizationDigest',p_authorization_manifest->>'promoteAuthorizationDigest',
    'technicalEvidenceReceiptDigests',v_authorization->'expectedTechnicalEvidenceReceiptDigests',
    'transitions',v_transitions,'promotedAt',v_now
  );
  v_receipt:=v_receipt||pg_catalog.jsonb_build_object(
    'receiptDigest',public.document_generation_local_digest_v1(v_receipt));

  insert into public.document_index_generation_operations(
    id,operation_kind,candidate_generation_id,manifest_digest,receipt_digest,receipt,rollback_state,created_at
  ) values (
    v_operation_id,'promote',v_candidate,p_authorization_manifest->>'promoteAuthorizationDigest',
    v_receipt->>'receiptDigest',v_receipt,v_rollback,v_now
  );

  for v_document in select value from pg_catalog.jsonb_array_elements(v_transitions)
    order by public.shadow_utf16_order_v1(value->>'documentId')
  loop
    perform public.transition_document_index_generation_core(
      (v_document->>'documentId')::uuid,(v_document->>'fromGenerationId')::uuid,
      (v_document->>'toGenerationId')::uuid,v_operation_id);
    v_current:=public.document_generation_serving_snapshot_v1((v_document->>'documentId')::uuid);
    if public.document_generation_local_digest_v1(v_current)
      is distinct from v_document->>'candidateServingSnapshotDigest'
    then raise exception 'document_generation_promotion_projection_mismatch'; end if;
  end loop;
  return v_receipt;
end $$;
alter function public.promote_shadow_document_generation(jsonb,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.promote_shadow_document_generation(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.promote_shadow_document_generation(jsonb,jsonb,jsonb,jsonb) to service_role;

create or replace function public.rollback_document_index_generation(
  p_promotion_receipt jsonb,p_rollback_manifest jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_promotion public.document_index_generation_operations%rowtype;
  v_existing public.document_index_generation_operations%rowtype;
  v_authorization jsonb;
  v_transition jsonb;
  v_saved jsonb;
  v_current jsonb;
  v_transitions jsonb:='[]'::jsonb;
  v_receipt jsonb;
  v_operation_id uuid:=gen_random_uuid();
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_retained_until timestamptz;
begin
  if not public.shadow_keys_v1(p_rollback_manifest,array['authorization','rollbackManifestDigest'])
    then raise exception 'invalid_document_generation_rollback_manifest'; end if;
  v_authorization:=p_rollback_manifest->'authorization';
  if not public.shadow_keys_v1(v_authorization,array[
      'version','operation','targetProjectRef','promotionOperationId','promotionReceiptDigest',
      'candidateGenerationId','expectedDocumentIds','expectedDocumentCount','retainedUntil',
      'reasonCode','authorizedAt','expiresAt','confirmationSha256'])
    or v_authorization->'version' is distinct from '1'::jsonb
    or v_authorization->>'operation' is distinct from 'rollback'
    or p_rollback_manifest->>'rollbackManifestDigest'
      is distinct from public.document_generation_local_digest_v1(v_authorization)
    or v_authorization->>'confirmationSha256' !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(pg_catalog.btrim(v_authorization->>'reasonCode'),'')=''
  then raise exception 'invalid_document_generation_rollback_manifest'; end if;
  v_retained_until:=public.shadow_audit_timestamp_v1(v_authorization->'retainedUntil');
  select * into strict v_promotion from public.document_index_generation_operations
    where id=(v_authorization->>'promotionOperationId')::uuid and operation_kind='promote' for share;
  if v_promotion.receipt is distinct from p_promotion_receipt
    or p_promotion_receipt->>'kind' is distinct from 'document-generation-promotion-v1'
    or p_promotion_receipt->>'receiptDigest'
      is distinct from public.document_generation_local_digest_v1(p_promotion_receipt-'receiptDigest')
    or v_authorization->>'promotionReceiptDigest' is distinct from v_promotion.receipt_digest
    or v_authorization->>'targetProjectRef' is distinct from v_promotion.receipt->>'projectRef'
    or v_authorization->>'candidateGenerationId' is distinct from v_promotion.candidate_generation_id::text
    or v_authorization->'expectedDocumentIds' is distinct from (
      select pg_catalog.jsonb_agg(value->'documentId' order by public.shadow_utf16_order_v1(value->>'documentId'))
      from pg_catalog.jsonb_array_elements(v_promotion.receipt->'transitions'))
    or v_authorization->'expectedDocumentCount' is distinct from
      pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(v_promotion.receipt->'transitions'))
  then raise exception 'document_generation_rollback_receipt_mismatch'; end if;

  select * into v_existing from public.document_index_generation_operations
    where manifest_digest=p_rollback_manifest->>'rollbackManifestDigest';
  if found then
    if v_existing.operation_kind<>'rollback' or v_existing.promotion_operation_id is distinct from v_promotion.id
      then raise exception 'document_generation_rollback_replay_mismatch'; end if;
    return v_existing.receipt;
  end if;
  if public.shadow_audit_timestamp_v1(v_authorization->'authorizedAt')>v_now
    or public.shadow_audit_timestamp_v1(v_authorization->'expiresAt')<=v_now
    or v_retained_until<=v_now
  then raise exception 'document_generation_rollback_authorization_expired'; end if;

  for v_transition in select value from pg_catalog.jsonb_array_elements(v_promotion.receipt->'transitions')
    order by public.shadow_utf16_order_v1(value->>'documentId')
  loop
    v_current:=public.lock_ingestion_document_authority((v_transition->>'documentId')::uuid,false);
    if v_current is null or v_current->'document'->>'status' is distinct from 'indexed'
      or (v_current->'document'->>'index_generation_id')::uuid
        is distinct from (v_transition->>'toGenerationId')::uuid
    then raise exception 'document_generation_rollback_authority_changed'; end if;
    perform public.assert_document_generation_rights_current_v1((v_transition->>'documentId')::uuid);
    select value into strict v_saved from pg_catalog.jsonb_array_elements(v_promotion.rollback_state)
      where value->>'documentId'=v_transition->>'documentId';
    if v_saved->>'snapshotDigest' is distinct from public.document_generation_local_digest_v1(v_saved->'previousServingSnapshot')
      then raise exception 'document_generation_rollback_snapshot_mismatch'; end if;
    v_current:=public.document_generation_serving_snapshot_v1((v_transition->>'documentId')::uuid);
    v_transitions:=v_transitions||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'documentId',v_transition->'documentId',
      'fromGenerationId',v_transition->'toGenerationId',
      'toGenerationId',v_transition->'fromGenerationId',
      'retainedUntil',v_retained_until));
  end loop;

  v_receipt:=pg_catalog.jsonb_build_object(
    'version',1,'kind','document-generation-rollback-v1','operationId',v_operation_id,
    'promotionOperationId',v_promotion.id,'promotionReceiptDigest',v_promotion.receipt_digest,
    'rollbackManifestDigest',p_rollback_manifest->>'rollbackManifestDigest',
    'candidateGenerationId',v_promotion.candidate_generation_id,
    'transitions',v_transitions,'rolledBackAt',v_now
  );
  v_receipt:=v_receipt||pg_catalog.jsonb_build_object(
    'receiptDigest',public.document_generation_local_digest_v1(v_receipt));
  insert into public.document_index_generation_operations(
    id,operation_kind,candidate_generation_id,promotion_operation_id,manifest_digest,
    receipt_digest,receipt,rollback_state,created_at
  ) values (
    v_operation_id,'rollback',v_promotion.candidate_generation_id,v_promotion.id,
    p_rollback_manifest->>'rollbackManifestDigest',v_receipt->>'receiptDigest',v_receipt,
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'documentId',value->'documentId','snapshot',public.document_generation_serving_snapshot_v1((value->>'documentId')::uuid),
      'snapshotDigest',public.document_generation_local_digest_v1(
        public.document_generation_serving_snapshot_v1((value->>'documentId')::uuid)))
      order by public.shadow_utf16_order_v1(value->>'documentId')),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_transitions)),v_now
  );

  for v_transition in select value from pg_catalog.jsonb_array_elements(v_transitions)
    order by public.shadow_utf16_order_v1(value->>'documentId')
  loop
    select value into strict v_saved from pg_catalog.jsonb_array_elements(v_promotion.rollback_state)
      where value->>'documentId'=v_transition->>'documentId';
    perform public.apply_document_generation_snapshot_v1(
      (v_transition->>'documentId')::uuid,v_saved->'previousServingSnapshot');
    perform public.transition_document_index_generation_core(
      (v_transition->>'documentId')::uuid,(v_transition->>'fromGenerationId')::uuid,
      (v_transition->>'toGenerationId')::uuid,v_operation_id);
    v_current:=public.document_generation_serving_snapshot_v1((v_transition->>'documentId')::uuid);
    if public.document_generation_local_digest_v1(v_current) is distinct from v_saved->>'snapshotDigest'
      then raise exception 'document_generation_rollback_projection_mismatch'; end if;
  end loop;
  return v_receipt;
end $$;
alter function public.rollback_document_index_generation(jsonb,jsonb) owner to postgres;
revoke all on function public.rollback_document_index_generation(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rollback_document_index_generation(jsonb,jsonb) to service_role;

create or replace function public.cleanup_document_index_generations(
  p_manifest jsonb,p_apply boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_target jsonb;
  v_member public.document_index_generations%rowtype;
  v_wave public.shadow_reindex_waves%rowtype;
  v_previous text;
  v_targets jsonb:='[]'::jsonb;
  v_private jsonb;
  v_result jsonb;
  v_receipt jsonb;
  v_existing public.document_index_generation_operations%rowtype;
  v_operation_id uuid:=gen_random_uuid();
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_count bigint;
begin
  if not public.shadow_keys_v1(p_manifest,array[
      'version','projectRef','targets','expectedCount','createdAt','digest'])
    or p_manifest->'version' is distinct from '1'::jsonb
    or p_manifest->>'digest' is distinct from public.document_generation_local_digest_v1(p_manifest-'digest')
    or pg_catalog.jsonb_typeof(p_manifest->'targets') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_manifest->'targets')=0
    or p_manifest->'expectedCount' is distinct from pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(p_manifest->'targets'))
    or public.shadow_audit_timestamp_v1(p_manifest->'createdAt')>v_now
  then raise exception 'document_generation_cleanup_manifest_mismatch'; end if;

  if p_apply is true then
    select * into v_existing from public.document_index_generation_operations
      where manifest_digest=p_manifest->>'digest';
    if found then
      if v_existing.operation_kind<>'cleanup'
        then raise exception 'document_generation_cleanup_replay_mismatch'; end if;
      return v_existing.receipt;
    end if;
  end if;

  for v_target in select value from pg_catalog.jsonb_array_elements(p_manifest->'targets')
    order by public.shadow_utf16_order_v1(value->>'documentId'),public.shadow_utf16_order_v1(value->>'generationId')
  loop
    if not public.shadow_keys_v1(v_target,array['documentId','generationId'])
      or v_previous is not null and v_previous>=public.shadow_node_value_text_v1(v_target)
      then raise exception 'document_generation_cleanup_manifest_mismatch'; end if;
    v_previous:=public.shadow_node_value_text_v1(v_target);
    perform 1 from public.documents where id=(v_target->>'documentId')::uuid for update;
    select * into strict v_member from public.document_index_generations
      where document_id=(v_target->>'documentId')::uuid
        and index_generation_id=(v_target->>'generationId')::uuid for update;
    select * into strict v_wave from public.shadow_reindex_waves
      where candidate_generation_id=v_member.index_generation_id;
    if v_wave.project_ref is distinct from p_manifest->>'projectRef'
      or v_member.cleaned_at is not null
      or v_member.state not in ('retained','abandoned')
      or (v_member.state='retained' and (v_member.retained_until is null or v_member.retained_until>v_now))
      or (v_member.state='abandoned' and v_member.retained_until is not null)
      or exists(select 1 from public.documents d where d.id=v_member.document_id
        and d.index_generation_id=v_member.index_generation_id)
    then raise exception 'document_generation_cleanup_target_ineligible'; end if;
    v_targets:=v_targets||pg_catalog.jsonb_build_array(v_target);
  end loop;
  if pg_catalog.jsonb_array_length(v_targets)<>(p_manifest->>'expectedCount')::integer
    then raise exception 'document_generation_cleanup_manifest_mismatch'; end if;

  v_result:=public.document_generation_cleanup_preview_v1(v_targets);
  v_private:=v_result->'privateObjectReferenceInventory';

  if p_apply is not true then
    return pg_catalog.jsonb_build_object(
      'ok',true,'operationId',null,'manifestDigest',p_manifest->>'digest','applied',false,
      'expectedCount',p_manifest->'expectedCount','eligibleCount',pg_catalog.jsonb_array_length(v_targets),
      'deletedArtifactCount',0,'targets',v_targets,
      'privateObjectReferenceInventory',v_private,'physicalDeletionAuthorized',false
    );
  end if;

  v_receipt:=pg_catalog.jsonb_build_object(
    'version',1,'kind','document-generation-cleanup-v1','ok',true,'operationId',v_operation_id,
    'manifestDigest',p_manifest->>'digest','applied',true,
    'expectedCount',p_manifest->'expectedCount','eligibleCount',pg_catalog.jsonb_array_length(v_targets),
    'deletedArtifactCount',v_result->'deletedArtifactCount','targets',v_targets,
    'privateObjectReferenceInventory',v_private,'physicalDeletionAuthorized',false,'cleanedAt',v_now
  );
  v_receipt:=v_receipt||pg_catalog.jsonb_build_object(
    'receiptDigest',public.document_generation_local_digest_v1(v_receipt));
  insert into public.document_index_generation_operations(
    id,operation_kind,manifest_digest,receipt_digest,receipt,rollback_state,created_at
  ) values (
    v_operation_id,'cleanup',p_manifest->>'digest',v_receipt->>'receiptDigest',v_receipt,'[]'::jsonb,v_now
  );
  perform public.delete_document_index_generations_core(v_targets,v_operation_id);
  update public.document_index_generations set cleaned_at=v_now,last_operation_id=v_operation_id
    where (document_id,index_generation_id) in (
      select (value->>'documentId')::uuid,(value->>'generationId')::uuid
      from pg_catalog.jsonb_array_elements(v_targets));
  get diagnostics v_count=row_count;
  if v_count<>pg_catalog.jsonb_array_length(v_targets)
    then raise exception 'document_generation_cleanup_row_count'; end if;
  return v_receipt;
end $$;
alter function public.cleanup_document_index_generations(jsonb,boolean) owner to postgres;
revoke all on function public.cleanup_document_index_generations(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.cleanup_document_index_generations(jsonb,boolean) to service_role;

-- Retire broad legacy mutation authority where a U04/U05 ledger exists.
revoke all on function public.commit_document_index_generation(
  uuid,text,uuid,uuid,text,integer,integer,integer,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;

alter function public.commit_document_index_generation(
  jsonb,uuid,integer,integer,integer,jsonb,jsonb,jsonb
) rename to commit_document_index_generation_legacy_u05;
revoke all on function public.commit_document_index_generation_legacy_u05(
  jsonb,uuid,integer,integer,integer,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;

create or replace function public.commit_document_index_generation(
  p_fence jsonb,p_generation uuid,p_page_count integer,p_chunk_count integer,p_image_count integer,
  p_metadata jsonb,p_pages jsonb,p_quality jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.document_index_generations
    where document_id=(p_fence->>'document_id')::uuid)
  then raise exception 'governed_document_generation_commit_forbidden'; end if;
  return public.commit_document_index_generation_legacy_u05(
    p_fence,p_generation,p_page_count,p_chunk_count,p_image_count,p_metadata,p_pages,p_quality);
end $$;
alter function public.commit_document_index_generation(jsonb,uuid,integer,integer,integer,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.commit_document_index_generation(jsonb,uuid,integer,integer,integer,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.commit_document_index_generation(jsonb,uuid,integer,integer,integer,jsonb,jsonb,jsonb) to service_role;

alter function public.cleanup_abandoned_document_index_generations(
  uuid,integer,boolean
) rename to cleanup_abandoned_document_index_generations_legacy_u05;
revoke all on function public.cleanup_abandoned_document_index_generations_legacy_u05(
  uuid,integer,boolean
) from public,anon,authenticated,service_role;

create or replace function public.cleanup_abandoned_document_index_generations(
  p_document_id uuid default null,p_limit integer default 100,p_dry_run boolean default true
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.document_index_generations
    where p_document_id is null or document_id=p_document_id)
  then raise exception 'governed_document_generation_cleanup_forbidden'; end if;
  return public.cleanup_abandoned_document_index_generations_legacy_u05(
    p_document_id,p_limit,p_dry_run);
end $$;
alter function public.cleanup_abandoned_document_index_generations(uuid,integer,boolean) owner to postgres;
revoke all on function public.cleanup_abandoned_document_index_generations(uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.cleanup_abandoned_document_index_generations(uuid,integer,boolean) to service_role;
