-- Recover deferred open-post alerts on a retried request, and do not replay a key
-- after its shift has ceased to be live.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.roster_open_post_keys
  add constraint roster_open_post_keys_posted_by_fkey
  foreign key (posted_by) references auth.users (id) on delete set null;

create table public.roster_open_post_alerts (
  service_id uuid not null references public.on_call_services (id) on delete cascade,
  open_shift_id uuid not null references public.roster_open_shifts (id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (service_id, open_shift_id)
);

alter table public.roster_open_post_alerts enable row level security;
revoke all on table public.roster_open_post_alerts from public, anon, authenticated;
grant select, insert, update, delete on table public.roster_open_post_alerts to service_role;

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
  select * into v_service from public.on_call_services where id = p_service_id for share;
  if not found or not public.service_member_active(p_service_id, p_actor_id) then
    raise exception 'roster_access_denied';
  end if;
  if v_service.verified_at is null and not v_service.is_demo then raise exception 'roster_team_not_verified'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_service_id::text, 74817));

  select * into v_key from public.roster_open_post_keys where service_id = p_service_id and post_key = p_post_key;
  if found then
    if v_key.posted_by is distinct from p_actor_id then raise exception 'roster_conflict'; end if;
    select status into v_status from public.roster_open_shifts where id = v_key.open_shift_id;
    -- A cancelled/expired shift must not make the client believe this date was posted.
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
