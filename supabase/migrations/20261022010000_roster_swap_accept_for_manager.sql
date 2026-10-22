-- Never edit an applied migration. Merging this applies it to the live database.
-- A swap that would approve itself on accept now waits for the manager when it breaks one of the
-- team's own rules (owner decision 21 Oct 2026, Work tools hardening plan, "Go ahead with all
-- recommendations"). roster_command's accept check covers clashes and the minimum break only, so a
-- same-grade swap more than 7 days out could approve itself while breaking the team's hours or
-- nights-in-a-row limits, and the manager never saw it. The app judges those rules
-- (swapRuleFlags) and, when one breaks, calls this function instead of roster_command.
--
-- It can only make approval stricter: it runs roster_command's own accept with every check
-- unchanged, and if that would approve the swap, undoes it and leaves the swap accepted and
-- waiting for the manager with reason team_rule. Any other answer (cancelled, expired, already
-- waiting for the manager, or an error) is returned exactly as roster_command gives it.
--
-- One new function. roster_command is unchanged. No table or data changes. "or replace" only so a
-- preview branch that already holds the function from an earlier version number can re-run it.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.roster_swap_accept_for_manager(p_actor_id uuid, p_service_id uuid, p_swap_id uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_service public.on_call_services;
  v_result jsonb;
begin
  if p_actor_id is null then raise exception 'roster_auth_required'; end if;
  if p_service_id is null or p_swap_id is null then raise exception 'roster_invalid_request'; end if;
  -- The same lock order as every team write: the service row FOR SHARE, then the per-service
  -- advisory lock. roster_command takes both again, which this transaction already holds, so
  -- nothing can change the swap between the undone accept and the update below.
  select * into v_service from public.on_call_services where id = p_service_id for share;
  if not found or not public.service_member_active(p_service_id, p_actor_id) then
    raise exception 'roster_access_denied';
  end if;
  if v_service.verified_at is null and not v_service.is_demo then raise exception 'roster_team_not_verified'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_service_id::text, 74817));

  begin
    v_result := public.roster_command(p_actor_id, p_service_id, 'swap.accept', jsonb_build_object('swapId', p_swap_id));
    -- Approved means the shifts already changed hands inside this block. Raising here rolls
    -- the block back to before the accept, as if it never ran.
    if v_result ->> 'status' = 'approved' then raise exception 'roster_swap_needs_manager'; end if;
    return v_result;
  exception when raise_exception then
    if sqlerrm <> 'roster_swap_needs_manager' then raise; end if;
  end;

  update public.roster_swaps
     set status = 'accepted', accepted_at = now(), needs_manager_because = 'team_rule'
   where id = p_swap_id and service_id = p_service_id and counterparty_id = p_actor_id and status = 'requested';
  if not found then raise exception 'roster_not_found'; end if;
  return jsonb_build_object('swapId', p_swap_id, 'status', 'accepted', 'needsManagerBecause', 'team_rule');
end $$;

revoke all on function public.roster_swap_accept_for_manager(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.roster_swap_accept_for_manager(uuid, uuid, uuid) to service_role;
