-- Merge only after the owner's explicit yes to this database change, by the owner pressing Merge.
-- Database fixes from the 24 Oct 2026 whole-codebase audit. The owner approved them on 25 Oct 2026
-- ("Go ahead with all recommendations"), recorded in
-- docs/decisions/2026-10-25-audit-database-fixes.md.
--
--   #0 Deleting an account that has audit-log rows failed: owner_id is ON DELETE SET NULL, but
--      the append-only trigger refused the UPDATE that action makes. The trigger now allows that
--      one update (owner_id to null, nothing else changed, the account already gone).
--   #1 Retrying an open-shift post after the shift was approved posted a second open shift and
--      alerted staff for a gap already filled. Only a missing, cancelled or expired shift now
--      frees the retry key; every other status replays the first post.
--   #2 An administrator who had admitted a document could never be deleted. The admission record
--      is kept, and the account's ids are cleared from it when the account is deleted. Deleting
--      the account is still refused while it owns documents (documents.owner_id is RESTRICT).
--   #5 An index rollback left the deep-memory details of the abandoned generation in the
--      document's metadata. The deep-memory keys are now part of each generation's snapshot, and
--      a rollback to a snapshot taken before this change removes them rather than keep them wrong.
--   #6 Drop public.roster_open_post_alerts, which nothing reads or writes (the durable roster
--      offer outbox replaced it).
--   #7 Index the four roster alert outbox foreign keys that cascade deletes had to scan for.
--   #8 The site-content administrator functions (publish, retire, reconciliation plan) now also
--      refuse a soft-deleted or banned account, as admit_administrator_document already does.
--      All three call the one shared helper, so only the helper changes.
--   #9 EPA feedback links that expired or were cancelled are deleted 30 days later by a nightly
--      job. Completed links, which hold the supervisor's feedback, are kept.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #0 ------------------------------------------------------------------------------------------
create or replace function public.audit_logs_prevent_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
BEGIN
  -- The one permitted change is the ON DELETE SET NULL action of audit_logs.owner_id: the owner
  -- is cleared, every other column is unchanged, and the account no longer exists.
  IF TG_OP = 'UPDATE'
    AND OLD.owner_id IS NOT NULL
    AND NEW.owner_id IS NULL
    AND (to_jsonb(NEW) - 'owner_id') = (to_jsonb(OLD) - 'owner_id')
    AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.owner_id)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only: % not allowed', TG_OP
    USING ERRCODE = '42501';
  RETURN NULL;
END;
$$;

revoke all on function public.audit_logs_prevent_mutation() from public, anon, authenticated, service_role;
grant execute on function public.audit_logs_prevent_mutation() to postgres;

-- #1 ------------------------------------------------------------------------------------------
create or replace function public.roster_open_post_once(p_actor_id uuid, p_service_id uuid, p_post_key uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_service public.on_call_services;
  v_key public.roster_open_post_keys;
  v_status text;
  v_result jsonb;
begin
  if p_actor_id is null then raise exception 'roster_auth_required'; end if;
  if p_service_id is null or p_post_key is null then raise exception 'roster_invalid_request'; end if;
  -- The same lock order as every team write: the service row FOR SHARE, then the per-service
  -- advisory lock. roster_command takes both again, which the same transaction already holds.
  select * into v_service from public.on_call_services where id = p_service_id for share;
  if not found or not public.service_member_active(p_service_id, p_actor_id) then
    raise exception 'roster_access_denied';
  end if;
  if v_service.verified_at is null and not v_service.is_demo then raise exception 'roster_team_not_verified'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_service_id::text, 74817));

  select * into v_key from public.roster_open_post_keys where service_id = p_service_id and post_key = p_post_key;
  if found then
    -- A key is only ever replayed for the person who first sent it.
    if v_key.posted_by is distinct from p_actor_id then raise exception 'roster_conflict'; end if;
    select status into v_status from public.roster_open_shifts where id = v_key.open_shift_id;
    -- Only a shift that is gone, cancelled or expired frees the key. A claimed or approved shift
    -- replays the first post, so a late retry never reposts a gap that was already filled.
    if v_status is null or v_status in ('cancelled', 'expired') then
      delete from public.roster_open_post_keys where service_id = p_service_id and post_key = p_post_key;
    else
      return jsonb_build_object('openShiftId', v_key.open_shift_id, 'status', v_status, 'replayed', true);
    end if;
  end if;

  v_result := public.roster_command(p_actor_id, p_service_id, 'open.post', coalesce(p_payload, '{}'::jsonb));
  insert into public.roster_open_post_keys (service_id, post_key, open_shift_id, posted_by)
  values (p_service_id, p_post_key, (v_result ->> 'openShiftId')::uuid, p_actor_id);
  return v_result;
end $$;

revoke all on function public.roster_open_post_once(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.roster_open_post_once(uuid, uuid, uuid, jsonb) to service_role;

-- #2 ------------------------------------------------------------------------------------------
alter table public.document_admission_events
  drop constraint document_admission_events_staging_owner_id_fkey;
alter table public.document_admission_events
  alter column staging_owner_id drop not null;
alter table public.document_admission_events
  add constraint document_admission_events_staging_owner_id_fkey
  foreign key (staging_owner_id) references auth.users(id) on delete set null;

-- An administrator row may lose its administrator id only together with its staging owner.
alter table public.document_admission_events
  drop constraint document_admission_events_actor_identity_check;
alter table public.document_admission_events
  add constraint document_admission_events_actor_identity_check
  check (
    (actor_kind = 'administrator' and source_channel = 'admin_api' and backend_principal is null
      and (administrator_id is not null or staging_owner_id is null))
    or
    (actor_kind = 'trusted_backend' and source_channel = 'backend_import'
      and administrator_id is null and backend_principal is not null)
  );

create function public.guard_document_admission_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The one permitted change is the ON DELETE SET NULL action of staging_owner_id once the
  -- account is gone. The administrator id (always the same account) is cleared with it, and
  -- nothing else in the record may change.
  if old.staging_owner_id is not null
    and new.staging_owner_id is null
    and not exists (select 1 from auth.users u where u.id = old.staging_owner_id)
  then
    -- An administrator row's administrator id is that same account; any other value stays.
    new.administrator_id := case when old.administrator_id is not distinct from old.staging_owner_id
                                 then null else old.administrator_id end;
    if (pg_catalog.to_jsonb(new) - array['staging_owner_id', 'administrator_id'])
         = (pg_catalog.to_jsonb(old) - array['staging_owner_id', 'administrator_id'])
    then
      return new;
    end if;
  end if;
  raise exception 'document_admission_events_append_only' using errcode = '55000';
end;
$$;

alter function public.guard_document_admission_event_update() owner to postgres;
revoke all on function public.guard_document_admission_event_update() from public, anon, authenticated, service_role;

drop trigger reject_document_admission_event_update on public.document_admission_events;
create trigger reject_document_admission_event_update
  before update on public.document_admission_events
  for each row execute function public.guard_document_admission_event_update();

-- #5 ------------------------------------------------------------------------------------------
-- Same list as 20261021170000 plus the keys commit_document_deep_memory_generation writes.
create or replace function public.document_index_generation_metadata_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['indexed_at','cover_image_id','rag_enrichment_version','rag_indexing_version',
    'rag_memory_version','rag_memory_updated_at','rag_enrichment_updated_at','enrichment_status',
    'enrichment_error','section_count','memory_card_count','extraction_quality',
    'index_quality_score','index_quality_issues','index_quality_metrics',
    'optional_index_write_issues','indexing_v3_agent_status','indexing_v3_agent_last_error',
    'indexing_v3_agent_repair_reason','indexing_v3_agent_updated_at','completion_gate_missing',
    'embedding_model','page_count','ocr_page_count','needs_ocr_page_count','text_character_count',
    'extracted_image_count','searchable_image_count','skipped_image_count',
    'skipped_image_reasons','image_type_counts','extraction_warnings',
    'document_embedding_field_types','shadow_extraction','extraction_provenance',
    'document_intelligence_version','document_intelligence_updated_at','index_unit_count',
    'index_unit_counts_by_type','repaired_anchor_count','deep_memory_generations']::text[]
$$;

alter function public.document_index_generation_metadata_keys() owner to postgres;
revoke all on function public.document_index_generation_metadata_keys() from public, anon, authenticated;
grant execute on function public.document_index_generation_metadata_keys() to service_role;

-- #6 ------------------------------------------------------------------------------------------
drop table public.roster_open_post_alerts;

-- #7 ------------------------------------------------------------------------------------------
create index if not exists roster_offer_alert_devices_subscription_idx
  on public.roster_offer_alert_devices (subscription_id);
create index if not exists roster_offer_alert_devices_owner_idx
  on public.roster_offer_alert_devices (owner_id);
create index if not exists roster_offer_alert_outbox_service_idx
  on public.roster_offer_alert_outbox (service_id);
create index if not exists roster_offer_alert_outbox_actor_idx
  on public.roster_offer_alert_outbox (actor_id);

-- #8 ------------------------------------------------------------------------------------------
-- 20261019170000 body, plus a final check that the signed-in account is not soft-deleted or
-- banned (the access token stays valid until it expires), the same rule as
-- admit_administrator_document (20261016210000).
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
  if not exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and (pg_catalog.to_jsonb(u)->>'deleted_at') is null
      and (
        (pg_catalog.to_jsonb(u)->>'banned_until') is null
        or (pg_catalog.to_jsonb(u)->>'banned_until')::timestamptz <= v_now
      )
  ) then
    raise exception using errcode = '42501', message = 'administrator_assurance_required';
  end if;
end;
$$;

alter function public.require_recent_site_content_administrator_assurance() owner to postgres;
revoke all on function public.require_recent_site_content_administrator_assurance() from public, anon, authenticated, service_role;

-- #9 ------------------------------------------------------------------------------------------
create function public.purge_stale_teaching_epa_magic_links(p_retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_retention_days is null or p_retention_days < 1 then
    raise exception 'retention days must be positive' using errcode = '22023';
  end if;
  -- Completed links hold the supervisor's feedback for the doctor and are never deleted here.
  delete from public.teaching_epa_magic_links
   where (status = 'pending' and expires_at < now() - make_interval(days => p_retention_days))
      or (status = 'revoked' and revoked_at < now() - make_interval(days => p_retention_days));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

alter function public.purge_stale_teaching_epa_magic_links(integer) owner to postgres;
revoke all on function public.purge_stale_teaching_epa_magic_links(integer) from public, anon, authenticated;
grant execute on function public.purge_stale_teaching_epa_magic_links(integer) to service_role;

comment on table public.teaching_epa_magic_links is
  'Single-use EPA feedback links. A link that expired or was cancelled is deleted 30 days later by
   the pg_cron job "purge-stale-teaching-epa-magic-links"; completed links are kept.';

-- Register the nightly purge when pg_cron is available. Preview/branch databases may not ship
-- pg_cron; install the function there but skip scheduling.
do $cron$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;

  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname = 'purge-stale-teaching-epa-magic-links';

  perform cron.schedule(
    'purge-stale-teaching-epa-magic-links',
    '55 3 * * *',
    $job$select public.purge_stale_teaching_epa_magic_links(30);$job$
  );
end
$cron$;
