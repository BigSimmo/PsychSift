-- Never edit an applied migration. Merging this applies it to the live database.
-- A declined open-shift request alerts the doctor whose claim was declined. The route used to read
-- the claimer from the whole manage view before the decline, outside its lock, so a claim or
-- release in between could alert a stale claimer or nobody, and a failed read was swallowed.
--
-- This function locks the open shift row, records who holds the claim, and runs roster_command's
-- own open.decline in the same transaction, so the claimer it returns is exactly the claim the
-- decline cleared. Every check stays in roster_command and is unchanged.
--
-- One new function. roster_command is unchanged. No table or data changes. "or replace" only so a
-- preview branch that already holds the function from an earlier version number can re-run it.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.roster_open_decline(p_actor_id uuid, p_service_id uuid, p_open_shift_id uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_service public.on_call_services;
  v_claimed_by uuid;
  v_result jsonb;
begin
  if p_actor_id is null then raise exception 'roster_auth_required'; end if;
  if p_service_id is null or p_open_shift_id is null then raise exception 'roster_invalid_request'; end if;
  -- The same lock order as every team write: the service row FOR SHARE, then the per-service
  -- advisory lock, then the open shift row. roster_command takes them again, which this
  -- transaction already holds, so the claim cannot change between this read and the decline.
  select * into v_service from public.on_call_services where id = p_service_id for share;
  if not found or not public.service_member_active(p_service_id, p_actor_id) then
    raise exception 'roster_access_denied';
  end if;
  if v_service.verified_at is null and not v_service.is_demo then raise exception 'roster_team_not_verified'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_service_id::text, 74817));

  select claimed_by into v_claimed_by from public.roster_open_shifts
   where id = p_open_shift_id and service_id = p_service_id for update;
  if not found then raise exception 'roster_not_found'; end if;

  v_result := public.roster_command(p_actor_id, p_service_id, 'open.decline',
    jsonb_build_object('openShiftId', p_open_shift_id));
  return v_result || jsonb_build_object('declinedClaimedBy', v_claimed_by);
end $$;

revoke all on function public.roster_open_decline(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.roster_open_decline(uuid, uuid, uuid) to service_role;
