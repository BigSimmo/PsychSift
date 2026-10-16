-- Adversarial Review R15, R21, R22, R26, R33:
-- 1. R15: Re-verify live auth.users row (site_role = 'administrator', not deleted, not banned)
--    inside public.admit_administrator_document so stale aal2 JWT claims cannot admit documents
--    after administrator demotion, ban, or deletion.
-- 2. R21: Evict stale/cancelled/withdrawn/deleted idempotency keys in public.roster_open_post_once
--    before replaying so re-posting after withdrawal or cancellation creates a fresh shift.
-- 3. R22: Create public.roster_open_post_alerts table (service_role only, RLS enabled) for durable
--    cross-worker open-shift post alert deduplication.
-- 4. R33: Enforce a 90-day inactivity TTL on public.calendar_feed_tokens inside
--    public.calendar_feed_owner.
-- 5. R26: Ensure retention purge RPCs raise SQLSTATE 22023 (invalid_parameter_value) when called
--    with non-positive retention days or out-of-range limits.

-- ---------------------------------------------------------------------------------------------
-- R15: Live auth.users administrator verification in public.admit_administrator_document
-- ---------------------------------------------------------------------------------------------
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
    raise exception 'administrator_assurance_required' using errcode = '42501';
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
    raise exception 'administrator_recent_authentication_required' using errcode = '42501';
  end if;

  perform 1
  from auth.users u
  where u.id = v_uid
    and u.raw_app_meta_data->>'site_role' is not distinct from 'administrator'
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= v_now)
  for share;
  if not found then
    raise exception 'administrator_assurance_required' using errcode = '42501';
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

-- ---------------------------------------------------------------------------------------------
-- R21: Evict non-active shift keys on replay in public.roster_open_post_once
-- ---------------------------------------------------------------------------------------------
create or replace function public.roster_open_post_once(
  p_actor_id uuid,
  p_service_id uuid,
  p_post_key uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
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
    if v_status is null or v_status not in ('reported', 'open', 'claimed') then
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

-- ---------------------------------------------------------------------------------------------
-- R22: Durable open-shift post alert deduplication table
-- ---------------------------------------------------------------------------------------------
create table if not exists public.roster_open_post_alerts (
  service_id text not null,
  open_shift_id text not null,
  delivered_at timestamptz not null default now(),
  primary key (service_id, open_shift_id)
);

alter table public.roster_open_post_alerts owner to postgres;
alter table public.roster_open_post_alerts enable row level security;
revoke all on table public.roster_open_post_alerts from public, anon, authenticated;
grant all on table public.roster_open_post_alerts to service_role;

-- ---------------------------------------------------------------------------------------------
-- R33: 90-day inactivity TTL on calendar_feed_tokens
-- ---------------------------------------------------------------------------------------------
alter table public.calendar_feed_tokens
  add column if not exists rotated_at timestamptz;

create or replace function public.calendar_feed_rotate(p_owner_id uuid, p_token_hash text) returns void
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
begin
  if p_owner_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'calendar_feed_invalid_request';
  end if;
  insert into public.calendar_feed_tokens (owner_id, token_hash, rotated_at)
  values (p_owner_id, p_token_hash, now())
  on conflict (owner_id) do update
    set token_hash = excluded.token_hash, created_at = now(), rotated_at = now(), last_used_at = null;
end $$;
revoke all on function public.calendar_feed_rotate(uuid, text) from public, anon, authenticated;
grant execute on function public.calendar_feed_rotate(uuid, text) to service_role;

create or replace function public.calendar_feed_owner(p_token_hash text) returns uuid
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare v_owner uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  update public.calendar_feed_tokens set last_used_at = now()
  where token_hash = p_token_hash
    and coalesce(last_used_at, rotated_at, created_at) >= now() - interval '90 days'
  returning owner_id into v_owner;
  return v_owner;
end $$;
revoke all on function public.calendar_feed_owner(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_owner(text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- R26: Standardise SQLSTATE 22023 (invalid_parameter_value) on retention purge parameter guards
-- ---------------------------------------------------------------------------------------------
create or replace function public.purge_expired_rag_queries(p_retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_deleted integer;
begin
  if p_retention_days < 1 then
    raise exception 'retention days must be positive' using errcode = '22023';
  end if;
  delete from public.rag_queries where created_at < now() - make_interval(days => p_retention_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;
revoke execute on function public.purge_expired_rag_queries(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_rag_queries(integer) to service_role;

create or replace function public.purge_expired_rag_query_misses(p_retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_deleted integer;
begin
  if p_retention_days < 1 then
    raise exception 'retention days must be positive' using errcode = '22023';
  end if;
  delete from public.rag_query_misses where created_at < now() - make_interval(days => p_retention_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;
revoke execute on function public.purge_expired_rag_query_misses(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_rag_query_misses(integer) to service_role;

create or replace function public.purge_expired_rag_response_cache(p_limit integer default 1000)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_deleted integer;
begin
  if p_limit < 1 or p_limit > 10000 then
    raise exception 'purge limit must be between 1 and 10000' using errcode = '22023';
  end if;
  with expired as (select id from public.rag_response_cache where expires_at <= now() order by expires_at asc limit p_limit)
  delete from public.rag_response_cache cache using expired where cache.id = expired.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.purge_expired_rag_response_cache(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_rag_response_cache(integer) to service_role;

create or replace function public.purge_expired_api_rate_limit_subjects(p_retention_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_retention_days < 1 then
    raise exception 'retention days must be positive' using errcode = '22023';
  end if;
  delete from public.api_rate_limit_subjects where updated_at < now() - make_interval(days => p_retention_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.purge_expired_api_rate_limit_subjects(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_api_rate_limit_subjects(integer) to service_role;
