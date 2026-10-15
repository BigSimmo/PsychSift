-- Never edit an applied migration. Merging this applies it to the live database.
-- A roster manager's open-shift post goes live once, even when the phone never hears back.
-- If the connection drops after the server saved a posted gap but before the answer reached the
-- phone, sending the post again used to save a second identical open shift. Posts that give away
-- a rostered shift were already protected by roster_open_shifts_live_assignment_idx; a posted gap
-- was not, and two identical gaps can be genuine (two doctors needed), so the shift itself can't
-- be made unique. Instead the phone sends one random key per date it posts and sends the same key
-- again when it retries that date. The first post with a key saves the shift and remembers the
-- key; the same key again answers with the shift already saved instead of saving another.
--
-- One new table, one new function. roster_command is unchanged. No data changes.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Which open shift each post key made. Tenancy is the same as every Roster table: RLS on, no
-- policies, no grant to anon or authenticated, service_role only. The rows go when the open shift
-- or the team goes.
create table public.roster_open_post_keys (
  service_id uuid not null references public.on_call_services (id) on delete cascade,
  post_key uuid not null,
  open_shift_id uuid not null references public.roster_open_shifts (id) on delete cascade,
  posted_by uuid,
  created_at timestamptz not null default now(),
  primary key (service_id, post_key)
);
create index roster_open_post_keys_open_shift_idx on public.roster_open_post_keys (open_shift_id);

alter table public.roster_open_post_keys enable row level security;
revoke all on table public.roster_open_post_keys from public, anon, authenticated;
grant select, insert, update, delete on table public.roster_open_post_keys to service_role;

create function public.roster_open_post_once(p_actor_id uuid, p_service_id uuid, p_post_key uuid, p_payload jsonb)
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
    return jsonb_build_object('openShiftId', v_key.open_shift_id, 'status', v_status, 'replayed', true);
  end if;

  v_result := public.roster_command(p_actor_id, p_service_id, 'open.post', coalesce(p_payload, '{}'::jsonb));
  insert into public.roster_open_post_keys (service_id, post_key, open_shift_id, posted_by)
  values (p_service_id, p_post_key, (v_result ->> 'openShiftId')::uuid, p_actor_id);
  return v_result;
end $$;

revoke all on function public.roster_open_post_once(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.roster_open_post_once(uuid, uuid, uuid, jsonb) to service_role;
