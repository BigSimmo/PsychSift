-- Never edit an applied migration. Merging this applies it to the live database.
-- A doctor can take back their own open-shift request while it is still waiting for approval
-- (owner decision 12 Oct 2026, Open shifts expansion item 10, "Go ahead with your recommendations").
-- Until now only a roster manager could clear a waiting request (open.decline), so a doctor who
-- asked by mistake, or whose plans changed, had to message the manager. Taking it back puts the
-- shift straight back on the list for everyone else. An approved shift is already on the roster,
-- so it is not taken back here: the doctor gives it away through Roster as for any other shift.
--
-- One new function. roster_command is unchanged. No table or data changes.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.roster_open_withdraw(p_actor_id uuid, p_service_id uuid, p_open_shift_id uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_service public.on_call_services;
  v_open public.roster_open_shifts;
begin
  if p_actor_id is null then raise exception 'roster_auth_required'; end if;
  if p_service_id is null or p_open_shift_id is null then raise exception 'roster_invalid_request'; end if;
  -- The same lock order as every team write: the service row FOR SHARE, then the per-service
  -- advisory lock, then the row itself.
  select * into v_service from public.on_call_services where id = p_service_id for share;
  if not found or not public.service_member_active(p_service_id, p_actor_id) then
    raise exception 'roster_access_denied';
  end if;
  if v_service.verified_at is null and not v_service.is_demo then raise exception 'roster_team_not_verified'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_service_id::text, 74817));

  select * into v_open from public.roster_open_shifts
   where id = p_open_shift_id and service_id = p_service_id for update;
  -- Someone else's request reads as missing, so nobody learns who asked for what.
  if not found or v_open.claimed_by is distinct from p_actor_id then raise exception 'roster_not_found'; end if;
  -- Approved, cancelled or expired since the doctor last looked, or the shift has already
  -- started (a started shift can no longer be claimed, so reopening it would strand it): nothing
  -- is changed.
  if v_open.status <> 'claimed' or v_open.starts_at <= now() then raise exception 'roster_conflict'; end if;

  update public.roster_open_shifts set status = 'open', claimed_by = null, claimed_at = null where id = v_open.id;
  return jsonb_build_object('openShiftId', v_open.id, 'status', 'open');
end $$;

revoke all on function public.roster_open_withdraw(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.roster_open_withdraw(uuid, uuid, uuid) to service_role;
