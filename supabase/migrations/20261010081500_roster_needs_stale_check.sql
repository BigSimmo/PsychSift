-- Never edit an applied migration. Merging this applies it to the live database.
-- A safe number save no longer overwrites another manager's cover needs (owner decision 10 Oct
-- 2026, "Fix it", on the two-manager save gap from PR #3431's review).
-- The safe number editor reads the team's cover needs, then sends the whole list back through
-- needs.set, which deletes the list and inserts the one it is given. Two requests, no check in
-- between, so a need another manager saved in that gap was silently deleted. Now the editor sends
-- the ids of the needs it read, and the write goes ahead only while the team still holds exactly
-- those needs. Every needs.set deletes and re-inserts the list, so any write since the read
-- changes the ids and the write is refused with roster_conflict. The editor then reads again,
-- puts the manager's changes back on top and resends.
--
-- One new function. roster_command and its needs.set branch are unchanged and still do the write,
-- inside the same transaction and locks. No table or data changes.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.roster_needs_replace(p_actor_id uuid, p_service_id uuid, p_expected_ids jsonb, p_needs jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
begin
  -- The same lock order as every team write: the service row FOR SHARE, then the per-service
  -- advisory lock, then the manager check. roster_command takes both again below, which the
  -- transaction already holds.
  perform public.roster_lock_manager(p_actor_id, p_service_id);
  if jsonb_typeof(p_expected_ids) is distinct from 'array' or jsonb_typeof(p_needs) is distinct from 'array' then
    raise exception 'roster_invalid_request';
  end if;
  if jsonb_array_length(p_expected_ids) > 2000 then raise exception 'roster_limit'; end if;
  if (select coalesce(array_agg(n.id order by n.id), '{}') from public.roster_staffing_needs n where n.service_id = p_service_id)
     is distinct from
     (select coalesce(array_agg(x::uuid order by x::uuid), '{}') from jsonb_array_elements_text(p_expected_ids) x) then
    raise exception 'roster_conflict';
  end if;
  return public.roster_command(p_actor_id, p_service_id, 'needs.set', jsonb_build_object('needs', p_needs));
end $$;

revoke all on function public.roster_needs_replace(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.roster_needs_replace(uuid, uuid, jsonb, jsonb) to service_role;
