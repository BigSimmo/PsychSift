-- DRAFT. Merge only inside the owner's approved database-change window.
--
-- Recent multi-factor sign-in for the three site-content administrator RPCs.
--
-- publish_site_content_record, retire_site_content_record and
-- record_site_content_reconciliation_plan are executable by `authenticated` because the
-- publications route calls them with the administrator's own session token. Each already
-- refuses a caller whose live auth.users row is not an administrator, but none read the
-- token's assurance level. The route now requires a fresh multi-factor sign-in (aal2 plus a
-- qualifying amr entry no older than 900 seconds) before it calls them, yet an older
-- administrator token could still call them straight through PostgREST and skip that.
--
-- This applies the same rule inside the database, after each function's existing
-- administrator check, through one small helper. It mirrors the route
-- (assertTrustedAdministratorAssurance) and admit_administrator_document: role
-- authenticated, sub matching auth.uid(), app_metadata.site_role administrator, aal2, and an
-- amr entry (password, otp, totp or webauthn) timestamped within the last 900 seconds and not
-- in the future. Nothing else in the three bodies changes; they are copied verbatim from
-- 20260824123000 (publish, retire) and 20260830120000 (reconciliation plan).
--
-- service_role is unchanged: all three already refuse any token whose role is not
-- authenticated, before the new check is reached. Grants are restated unchanged.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.require_recent_site_content_administrator_assurance()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_jwt jsonb := auth.jwt();
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if pg_catalog.jsonb_typeof(v_jwt) is distinct from 'object'
    or v_jwt->>'role' is distinct from 'authenticated'
    or v_jwt->>'sub' is distinct from auth.uid()::text
    or v_jwt#>>'{app_metadata,site_role}' is distinct from 'administrator'
    or v_jwt->>'aal' is distinct from 'aal2'
    or pg_catalog.jsonb_typeof(v_jwt->'amr') is distinct from 'array'
  then
    raise exception using errcode = '42501', message = 'administrator_assurance_required';
  end if;
  if not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_jwt->'amr') as methods(amr)
    where pg_catalog.jsonb_typeof(amr) = 'object'
      and amr->>'method' in ('password', 'otp', 'totp', 'webauthn')
      and case when pg_catalog.jsonb_typeof(amr->'timestamp') = 'number' then
        pg_catalog.to_timestamp((amr->>'timestamp')::double precision) <= v_now
          and pg_catalog.to_timestamp((amr->>'timestamp')::double precision) >= v_now - interval '900 seconds'
      else false end
  ) then
    raise exception using errcode = '42501', message = 'administrator_recent_authentication_required';
  end if;
end;
$$;

create or replace function public.publish_site_content_record(
  p_kind text, p_source_row_id uuid, p_expected_source_version text,
  p_expected_change_epoch bigint, p_reconciliation_plan_digest text,
  p_expected_record_digest text, p_expected_projection_digest text
)
returns table (outcome text, conflict_code text, logical_id text, publication_id uuid, event_sequence bigint, change_epoch bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_state public.site_content_sync_state%rowtype;
  v_source record;
  v_existing public.site_content_public_records%rowtype;
  v_publication_id uuid := gen_random_uuid();
  v_event_sequence bigint;
  v_actor uuid := auth.uid();
  v_authorized_at timestamptz;
begin
  if v_actor is null or auth.jwt()->>'role' is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'site_content_administrator_required';
  end if;
  perform 1 from auth.users u
  where u.id = v_actor and u.raw_app_meta_data->>'site_role' is not distinct from 'administrator'
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'site_content_administrator_required';
  end if;
  perform public.require_recent_site_content_administrator_assurance();
  v_authorized_at := pg_catalog.clock_timestamp();
  perform pg_catalog.pg_advisory_xact_lock(93206431);
  select * into strict v_state from public.site_content_sync_state where singleton for update;
  if v_state.change_epoch is distinct from p_expected_change_epoch then
    outcome := 'conflict'; conflict_code := 'stale_change_epoch'; return next; return;
  end if;
  select * into strict v_source from public.site_content_source_projection(p_kind, p_source_row_id);
  if v_source.source_version is distinct from p_expected_source_version then
    outcome := 'conflict'; conflict_code := 'stale_source_version'; return next; return;
  end if;
  if p_expected_record_digest is null or p_expected_record_digest !~ '^[0-9a-f]{64}$'
    or public.site_content_json_sha256(v_source.record) is distinct from p_expected_record_digest then
    outcome := 'conflict'; conflict_code := 'record_digest_mismatch'; return next; return;
  end if;
  if p_expected_projection_digest is null or p_expected_projection_digest !~ '^[0-9a-f]{64}$'
    or public.site_content_projection_digest(v_source.record, v_source.render_payload)
      is distinct from p_expected_projection_digest then
    outcome := 'conflict'; conflict_code := 'projection_digest_mismatch'; return next; return;
  end if;
  select * into v_existing from public.site_content_public_records h
  where h.logical_id = v_source.logical_id for update;
  if v_existing.logical_id is not null and not v_existing.retired and exists (
    select 1 from public.site_content_publications p
    where p.id = v_existing.current_publication_id and p.source_row_id = p_source_row_id
      and p.source_version = v_source.source_version
  ) then outcome := 'conflict'; conflict_code := 'already_published'; return next; return; end if;
  if v_existing.logical_id is null and not v_state.initialized then
    if p_reconciliation_plan_digest is null or not exists (
      select 1 from public.site_content_reconciliation_plans p
      where p.plan_digest = p_reconciliation_plan_digest and exists (
        select 1 from jsonb_array_elements(p.dispositions) item
        where item->>'logicalId' = v_source.logical_id and item->>'disposition' = 'adopt'
          and item->>'sourceKind' = p_kind and item->>'sourceRowId' = p_source_row_id::text
          and item->>'sourceVersion' = v_source.source_version
          and item->>'contentHash' = v_source.record->>'contentHash'
          and item->>'publicationVersion' = v_source.record->>'publicationVersion'
          and item->>'trustedPublicRecordId' = v_source.logical_id
          and item->>'trustedRoute' = v_source.record->>'route'
          and item->>'trustedGovernanceHash' = public.site_content_record_governance_hash(v_source.record)
      )
    ) then raise exception using errcode = '55000', message = 'site_content_reconciliation_required'; end if;
  end if;
  insert into public.site_content_publications(
    id, logical_id, kind, slug, source_table, source_row_id, source_owner_id, source_version,
    published_by, administrator_authorized_at, administrator_authorization_version,
    reconciliation_plan_digest, record, render_payload, retired
  ) values (
    v_publication_id, v_source.logical_id, p_kind, v_source.slug, v_source.source_table,
    p_source_row_id, v_source.source_owner_id, v_source.source_version, v_actor, v_authorized_at,
    'site-content-admin-authorization-v1', p_reconciliation_plan_digest,
    v_source.record, v_source.render_payload, false
  );
  change_epoch := v_state.change_epoch + 1;
  insert into public.site_content_public_records(logical_id, kind, slug, current_publication_id, head_change_epoch, retired)
  values (v_source.logical_id, p_kind, v_source.slug, v_publication_id, change_epoch, false)
  on conflict on constraint site_content_public_records_pkey do update set
    current_publication_id = excluded.current_publication_id, kind = excluded.kind, slug = excluded.slug,
    head_change_epoch = excluded.head_change_epoch, retired = false, updated_at = pg_catalog.clock_timestamp();
  insert into public.site_content_sync_events(logical_id, target_publication_id, target_change_epoch)
  values (v_source.logical_id, v_publication_id, change_epoch)
  returning site_content_sync_events.event_sequence into v_event_sequence;
  update public.site_content_sync_events e set state = 'superseded', worker_id = null, lease_token = null,
    lease_expires_at = null, superseded_by_event_sequence = v_event_sequence,
    terminal_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
  where e.event_sequence <> v_event_sequence and e.target_change_epoch < change_epoch
    and e.state in ('pending', 'retry_pending', 'processing', 'ready');
  update public.site_content_releases set state = 'abandoned'
  where state = 'candidate' and target_change_epoch < change_epoch;
  update public.site_content_public_records set pending_event_sequence = v_event_sequence,
    updated_at = pg_catalog.clock_timestamp()
  where site_content_public_records.logical_id = v_source.logical_id;
  update public.site_content_sync_state set change_epoch = v_state.change_epoch + 1,
    updated_at = pg_catalog.clock_timestamp() where singleton;
  logical_id := v_source.logical_id; publication_id := v_publication_id;
  event_sequence := v_event_sequence; outcome := 'applied'; conflict_code := null; return next;
end;
$$;

create or replace function public.retire_site_content_record(
  p_kind text, p_source_row_id uuid, p_expected_source_version text,
  p_expected_change_epoch bigint, p_reconciliation_plan_digest text,
  p_expected_record_digest text, p_expected_projection_digest text
)
returns table (outcome text, conflict_code text, logical_id text, publication_id uuid, event_sequence bigint, change_epoch bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_state public.site_content_sync_state%rowtype;
  v_source record;
  v_head public.site_content_public_records%rowtype;
  v_publication_id uuid := gen_random_uuid();
  v_event_sequence bigint;
  v_actor uuid := auth.uid();
  v_authorized_at timestamptz;
begin
  if v_actor is null or auth.jwt()->>'role' is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'site_content_administrator_required';
  end if;
  perform 1 from auth.users u
  where u.id = v_actor and u.raw_app_meta_data->>'site_role' is not distinct from 'administrator'
  for share;
  if not found then raise exception using errcode = '42501', message = 'site_content_administrator_required'; end if;
  perform public.require_recent_site_content_administrator_assurance();
  v_authorized_at := pg_catalog.clock_timestamp();
  perform pg_catalog.pg_advisory_xact_lock(93206431);
  select * into strict v_state from public.site_content_sync_state where singleton for update;
  if v_state.change_epoch is distinct from p_expected_change_epoch then
    outcome := 'conflict'; conflict_code := 'stale_change_epoch'; return next; return;
  end if;
  select * into strict v_source from public.site_content_source_projection(p_kind, p_source_row_id);
  if v_source.source_version is distinct from p_expected_source_version then
    outcome := 'conflict'; conflict_code := 'stale_source_version'; return next; return;
  end if;
  if p_expected_record_digest is null or p_expected_record_digest !~ '^[0-9a-f]{64}$'
    or public.site_content_json_sha256(v_source.record) is distinct from p_expected_record_digest then
    outcome := 'conflict'; conflict_code := 'record_digest_mismatch'; return next; return;
  end if;
  if p_expected_projection_digest is null or p_expected_projection_digest !~ '^[0-9a-f]{64}$'
    or public.site_content_projection_digest(v_source.record, v_source.render_payload)
      is distinct from p_expected_projection_digest then
    outcome := 'conflict'; conflict_code := 'projection_digest_mismatch'; return next; return;
  end if;
  select * into v_head from public.site_content_public_records
  where site_content_public_records.logical_id = v_source.logical_id for update;
  if not found then outcome := 'conflict'; conflict_code := 'missing_publication'; return next; return; end if;
  if v_head.retired then outcome := 'conflict'; conflict_code := 'already_retired'; return next; return; end if;
  insert into public.site_content_publications(
    id, logical_id, kind, slug, source_table, source_row_id, source_owner_id, source_version,
    published_by, administrator_authorized_at, administrator_authorization_version,
    reconciliation_plan_digest, record, render_payload, retired
  ) values (
    v_publication_id, v_source.logical_id, p_kind, v_source.slug, v_source.source_table,
    p_source_row_id, v_source.source_owner_id, v_source.source_version, v_actor, v_authorized_at,
    'site-content-admin-authorization-v1', null, v_source.record, v_source.render_payload, true
  );
  change_epoch := v_state.change_epoch + 1;
  update public.site_content_public_records set current_publication_id = v_publication_id, retired = true,
    head_change_epoch = change_epoch, updated_at = pg_catalog.clock_timestamp()
  where site_content_public_records.logical_id = v_source.logical_id;
  insert into public.site_content_sync_events(logical_id, target_publication_id, target_change_epoch)
  values (v_source.logical_id, v_publication_id, change_epoch)
  returning site_content_sync_events.event_sequence into v_event_sequence;
  update public.site_content_sync_events e set state = 'superseded', worker_id = null, lease_token = null,
    lease_expires_at = null, superseded_by_event_sequence = v_event_sequence,
    terminal_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
  where e.event_sequence <> v_event_sequence and e.target_change_epoch < change_epoch
    and e.state in ('pending', 'retry_pending', 'processing', 'ready');
  update public.site_content_releases set state = 'abandoned'
  where state = 'candidate' and target_change_epoch < change_epoch;
  update public.site_content_public_records set pending_event_sequence = v_event_sequence
  where site_content_public_records.logical_id = v_source.logical_id;
  update public.site_content_sync_state set change_epoch = v_state.change_epoch + 1,
    updated_at = pg_catalog.clock_timestamp() where singleton;
  logical_id := v_source.logical_id; publication_id := v_publication_id;
  event_sequence := v_event_sequence; outcome := 'applied'; conflict_code := null; return next;
end;
$$;

create or replace function public.record_site_content_reconciliation_plan(p_plan jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_site_role text;
  v_authorized_at timestamptz;
  v_dispositions jsonb;
  v_trusted jsonb;
  v_counts jsonb;
  v_expected integer;
  v_groups integer;
  v_batch_size integer;
  v_batch_count integer;
  v_item jsonb;
  v_snapshot jsonb;
  source record;
  v_live_count integer;
begin
  v_actor := auth.uid();
  if v_actor is null or auth.jwt()->>'role' is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'site_content_administrator_authorization_required';
  end if;
  select u.raw_app_meta_data->>'site_role' into v_site_role
  from auth.users u where u.id = v_actor for share;
  if not found or v_site_role is distinct from 'administrator' then
    raise exception using errcode = '42501', message = 'site_content_administrator_authorization_required';
  end if;
  perform public.require_recent_site_content_administrator_assurance();
  v_authorized_at := pg_catalog.statement_timestamp();
  perform pg_catalog.pg_advisory_xact_lock(93206431);

  begin
    if p_plan is null or jsonb_typeof(p_plan) is distinct from 'object' then
      raise exception 'invalid plan';
    end if;
    if p_plan - array['version','planDigest','trustedSnapshotDigest','expectedRecordCount','expectedGroupCount',
        'batchSize','batchCount','counts','trustedSnapshots','dispositions'] <> '{}'::jsonb
      or (select count(*) from jsonb_object_keys(p_plan)) <> 10
      or jsonb_typeof(p_plan->'version') is distinct from 'string'
      or p_plan->>'version' is distinct from 'site-content-reconciliation-plan-v1'
      or jsonb_typeof(p_plan->'planDigest') is distinct from 'string'
      or p_plan->>'planDigest' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_plan->'trustedSnapshotDigest') is distinct from 'string'
      or p_plan->>'trustedSnapshotDigest' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_plan->'expectedRecordCount') is distinct from 'number'
      or jsonb_typeof(p_plan->'expectedGroupCount') is distinct from 'number'
      or jsonb_typeof(p_plan->'batchSize') is distinct from 'number'
      or jsonb_typeof(p_plan->'batchCount') is distinct from 'number'
    then
      raise exception 'invalid plan';
    end if;
    v_dispositions := p_plan->'dispositions';
    v_trusted := p_plan->'trustedSnapshots';
    v_counts := p_plan->'counts';
    if jsonb_typeof(v_dispositions) is distinct from 'array'
      or jsonb_typeof(v_trusted) is distinct from 'array'
      or jsonb_typeof(v_counts) is distinct from 'object'
      or v_counts - array['adopt','retire','identicalDuplicate','total'] <> '{}'::jsonb
      or (select count(*) from jsonb_object_keys(v_counts)) <> 4
      or jsonb_typeof(v_counts->'adopt') is distinct from 'number'
      or jsonb_typeof(v_counts->'retire') is distinct from 'number'
      or jsonb_typeof(v_counts->'identicalDuplicate') is distinct from 'number'
      or jsonb_typeof(v_counts->'total') is distinct from 'number'
    then
      raise exception 'invalid plan';
    end if;
    if (p_plan->>'expectedRecordCount')::numeric <> trunc((p_plan->>'expectedRecordCount')::numeric)
      or (p_plan->>'expectedGroupCount')::numeric <> trunc((p_plan->>'expectedGroupCount')::numeric)
      or (p_plan->>'batchSize')::numeric <> trunc((p_plan->>'batchSize')::numeric)
      or (p_plan->>'batchCount')::numeric <> trunc((p_plan->>'batchCount')::numeric)
      or (v_counts->>'adopt')::numeric <> trunc((v_counts->>'adopt')::numeric)
      or (v_counts->>'retire')::numeric <> trunc((v_counts->>'retire')::numeric)
      or (v_counts->>'identicalDuplicate')::numeric <> trunc((v_counts->>'identicalDuplicate')::numeric)
      or (v_counts->>'total')::numeric <> trunc((v_counts->>'total')::numeric)
      or (p_plan->>'expectedRecordCount')::numeric not between 1 and 5000
      or (p_plan->>'expectedGroupCount')::numeric not between 1 and (p_plan->>'expectedRecordCount')::numeric
      or (p_plan->>'batchSize')::numeric not between 1 and 500
      or (p_plan->>'batchCount')::numeric not between 1 and 5000
    then
      raise exception 'invalid plan';
    end if;
    v_expected := (p_plan->>'expectedRecordCount')::integer;
    v_groups := (p_plan->>'expectedGroupCount')::integer;
    v_batch_size := (p_plan->>'batchSize')::integer;
    v_batch_count := (p_plan->>'batchCount')::integer;
  exception when others then
    raise exception using errcode = '22023', message = 'site_content_reconciliation_unresolved';
  end;
  if exists (
    select 1 from jsonb_array_elements(v_dispositions) item
    where jsonb_typeof(item) is distinct from 'object'
  ) or exists (
    select 1 from jsonb_array_elements(v_trusted) item
    where jsonb_typeof(item) is distinct from 'object'
  ) then
    raise exception using errcode = '22023', message = 'site_content_reconciliation_unresolved';
  end if;
  if jsonb_array_length(v_dispositions) <> v_expected
    or jsonb_array_length(v_trusted) <> v_groups
    or v_batch_count <> ceil(v_expected::numeric / v_batch_size)::integer
    or p_plan->>'planDigest' is distinct from public.site_content_json_sha256(p_plan - 'planDigest')
    or p_plan->>'trustedSnapshotDigest' is distinct from public.site_content_json_sha256(jsonb_build_object(
      'version', 'site-content-trusted-snapshot-v1', 'records', v_trusted))
    or (v_counts->>'total')::numeric <> v_expected
    or (v_counts->>'adopt')::numeric <> (select count(*) from jsonb_array_elements(v_dispositions) item where item->>'disposition' = 'adopt')
    or (v_counts->>'retire')::numeric <> (select count(*) from jsonb_array_elements(v_dispositions) item where item->>'disposition' = 'retire')
    or (v_counts->>'identicalDuplicate')::numeric <> (select count(*) from jsonb_array_elements(v_dispositions) item where item->>'disposition' = 'identical_duplicate')
    or (select count(*) from jsonb_array_elements(v_dispositions) item where item->>'disposition' = 'adopt') <> v_groups
    or (select count(distinct item->>'logicalId') from jsonb_array_elements(v_dispositions) item) <> v_groups
    or (select count(distinct item->>'logicalId') from jsonb_array_elements(v_dispositions) item
      where item->>'disposition' = 'adopt') <> v_groups
    or (select count(distinct ((item->>'sourceKind') || ':' || (item->>'sourceRowId')))
      from jsonb_array_elements(v_dispositions) item) <> v_expected
    or v_dispositions is distinct from (select jsonb_agg(item order by item->>'logicalId' collate "C",
      item->>'sourceKind' collate "C", item->>'sourceRowId' collate "C") from jsonb_array_elements(v_dispositions) item)
    or v_trusted is distinct from (select jsonb_agg(item order by item->>'logicalId' collate "C")
      from jsonb_array_elements(v_trusted) item)
    or (select count(distinct item->>'logicalId') from jsonb_array_elements(v_trusted) item) <> v_groups
    then
    raise exception using errcode = '22023', message = 'site_content_reconciliation_unresolved';
  end if;
  for v_snapshot in select value from jsonb_array_elements(v_trusted) loop
    if jsonb_typeof(v_snapshot) is distinct from 'object'
      or v_snapshot - array['logicalId','publicRecordId','route','contentHash','publicationVersion','governanceHash'] <> '{}'::jsonb
      or (select count(*) from jsonb_object_keys(v_snapshot)) <> 6
      or jsonb_typeof(v_snapshot->'logicalId') is distinct from 'string'
      or jsonb_typeof(v_snapshot->'publicRecordId') is distinct from 'string'
      or jsonb_typeof(v_snapshot->'route') is distinct from 'string'
      or jsonb_typeof(v_snapshot->'contentHash') is distinct from 'string'
      or jsonb_typeof(v_snapshot->'publicationVersion') is distinct from 'string'
      or jsonb_typeof(v_snapshot->'governanceHash') is distinct from 'string'
      or v_snapshot->>'logicalId' !~ '^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._:-]*$'
      or v_snapshot->>'publicRecordId' is distinct from v_snapshot->>'logicalId'
      or v_snapshot->>'route' not like '/%'
      or v_snapshot->>'contentHash' !~ '^[0-9a-f]{64}$'
      or v_snapshot->>'publicationVersion' !~ '^[0-9a-f]{64}$'
      or v_snapshot->>'governanceHash' !~ '^[0-9a-f]{64}$'
      then raise exception using errcode = '22023', message = 'site_content_reconciliation_snapshot_invalid';
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(v_dispositions) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or v_item - array['logicalId','disposition','sourceKind','sourceRowId','sourceVersion','contentHash',
        'publicationVersion','trustedPublicRecordId','trustedRoute','trustedGovernanceHash'] <> '{}'::jsonb
      or (select count(*) from jsonb_object_keys(v_item)) <> 10
      or jsonb_typeof(v_item->'logicalId') is distinct from 'string'
      or jsonb_typeof(v_item->'disposition') is distinct from 'string'
      or jsonb_typeof(v_item->'sourceKind') is distinct from 'string'
      or jsonb_typeof(v_item->'sourceRowId') is distinct from 'string'
      or jsonb_typeof(v_item->'sourceVersion') is distinct from 'string'
      or jsonb_typeof(v_item->'contentHash') is distinct from 'string'
      or jsonb_typeof(v_item->'publicationVersion') is distinct from 'string'
      or jsonb_typeof(v_item->'trustedPublicRecordId') is distinct from 'string'
      or jsonb_typeof(v_item->'trustedRoute') is distinct from 'string'
      or jsonb_typeof(v_item->'trustedGovernanceHash') is distinct from 'string'
      or v_item->>'logicalId' !~ '^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._:-]*$'
      or v_item->>'disposition' not in ('adopt','retire','identical_duplicate')
      or v_item->>'sourceKind' not in ('service','form','medication','differential','presentation')
      or v_item->>'sourceRowId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or v_item->>'sourceVersion' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      or v_item->>'contentHash' !~ '^[0-9a-f]{64}$'
      or v_item->>'publicationVersion' !~ '^[0-9a-f]{64}$'
      or v_item->>'trustedGovernanceHash' !~ '^[0-9a-f]{64}$'
      or v_item->>'trustedRoute' not like '/%'
      then raise exception using errcode = '22023', message = 'site_content_reconciliation_item_invalid';
    end if;
    select * into strict source from public.site_content_source_projection(
      v_item->>'sourceKind', (v_item->>'sourceRowId')::uuid);
    select value into strict v_snapshot from jsonb_array_elements(v_trusted)
      where value->>'logicalId' = v_item->>'logicalId';
    if v_item->>'sourceVersion' is distinct from source.source_version
      or v_item->>'logicalId' is distinct from source.logical_id
      or v_item->>'contentHash' is distinct from source.record->>'contentHash'
      or v_item->>'publicationVersion' is distinct from source.record->>'publicationVersion'
      or v_item->>'trustedPublicRecordId' is distinct from v_snapshot->>'publicRecordId'
      or v_item->>'trustedRoute' is distinct from v_snapshot->>'route'
      or v_item->>'trustedGovernanceHash' is distinct from v_snapshot->>'governanceHash'
      or (v_item->>'disposition' in ('adopt','identical_duplicate') and (
        source.record->>'contentHash' is distinct from v_snapshot->>'contentHash'
        or source.record->>'publicationVersion' is distinct from v_snapshot->>'publicationVersion'
        or source.record->>'route' is distinct from v_snapshot->>'route'
        or public.site_content_record_governance_hash(source.record) is distinct from v_snapshot->>'governanceHash'))
      or (v_item->>'disposition' = 'retire' and
        source.record->>'contentHash' = v_snapshot->>'contentHash'
        and source.record->>'publicationVersion' = v_snapshot->>'publicationVersion'
        and source.record->>'route' = v_snapshot->>'route'
        and public.site_content_record_governance_hash(source.record) = v_snapshot->>'governanceHash')
      then raise exception using errcode = '22023', message = 'site_content_reconciliation_source_evidence_mismatch';
    end if;
  end loop;
  select count(*) into v_live_count from (
    select 'service'::text as source_kind, id, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') source_version
      from public.clinical_registry_records where kind = 'service'
    union all select 'form', id, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      from public.clinical_registry_records where kind = 'form'
    union all select 'medication', id, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.medication_records
    union all select case kind when 'presentation' then 'presentation' else 'differential' end, id,
      to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.differential_records
  ) live;
  if v_live_count <> v_expected or exists (
    select 1 from (
      select 'service'::text source_kind, id, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') source_version
        from public.clinical_registry_records where kind = 'service'
      union all select 'form', id, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.clinical_registry_records where kind = 'form'
      union all select 'medication', id, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.medication_records
      union all select case kind when 'presentation' then 'presentation' else 'differential' end, id,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.differential_records
    ) live left join jsonb_array_elements(v_dispositions) item
      on item->>'sourceKind' = live.source_kind and item->>'sourceRowId' = live.id::text
        and item->>'sourceVersion' = live.source_version
    where item is null
  ) then raise exception using errcode = '22023', message = 'site_content_reconciliation_population_mismatch'; end if;
  insert into public.site_content_reconciliation_plans(
    plan_digest, version, trusted_snapshot_digest, trusted_snapshots, dispositions, expected_record_count,
    expected_group_count, batch_size, batch_count, counts, reviewed_by, reviewed_at,
    administrator_authorized_at, administrator_authorization_version
  ) values (
    p_plan->>'planDigest', p_plan->>'version', p_plan->>'trustedSnapshotDigest', v_trusted, v_dispositions,
    v_expected, v_groups, v_batch_size, v_batch_count, v_counts,
    v_actor, v_authorized_at, v_authorized_at, 'site-content-admin-authorization-v1'
  ) on conflict (plan_digest) do nothing;
  return exists (
    select 1 from public.site_content_reconciliation_plans rp
    where rp.plan_digest = p_plan->>'planDigest'
      and rp.version = p_plan->>'version'
      and rp.trusted_snapshot_digest = p_plan->>'trustedSnapshotDigest'
      and rp.trusted_snapshots = v_trusted
      and rp.dispositions = v_dispositions
      and rp.expected_record_count = v_expected
      and rp.expected_group_count = v_groups
      and rp.batch_size = v_batch_size
      and rp.batch_count = v_batch_count
      and rp.counts = v_counts
      and rp.reviewed_by is not null
      and rp.reviewed_at = rp.administrator_authorized_at
      and rp.administrator_authorization_version = 'site-content-admin-authorization-v1'
  );
end;
$$;

alter function public.require_recent_site_content_administrator_assurance() owner to postgres;
revoke all on function public.require_recent_site_content_administrator_assurance() from public, anon, authenticated, service_role;

revoke all on function public.publish_site_content_record(text, uuid, text, bigint, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.publish_site_content_record(text, uuid, text, bigint, text, text, text) to authenticated;
grant execute on function public.publish_site_content_record(text, uuid, text, bigint, text, text, text) to service_role;
revoke all on function public.retire_site_content_record(text, uuid, text, bigint, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.retire_site_content_record(text, uuid, text, bigint, text, text, text) to authenticated;
grant execute on function public.retire_site_content_record(text, uuid, text, bigint, text, text, text) to service_role;
revoke all on function public.record_site_content_reconciliation_plan(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_site_content_reconciliation_plan(jsonb) to authenticated;
grant execute on function public.record_site_content_reconciliation_plan(jsonb) to service_role;
alter function public.publish_site_content_record(text, uuid, text, bigint, text, text, text) owner to postgres;
alter function public.retire_site_content_record(text, uuid, text, bigint, text, text, text) owner to postgres;
alter function public.record_site_content_reconciliation_plan(jsonb) owner to postgres;
