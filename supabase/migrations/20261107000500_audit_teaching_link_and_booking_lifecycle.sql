-- Enforce the existing twenty-active-link ceiling atomically, including older application writers.
-- A versioned create authority makes newer apps refuse schemas lacking this contract.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.teaching_guard_epa_pending_limit() returns trigger
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare v_now timestamptz;
begin
  if new.status <> 'pending' or new.expires_at <= clock_timestamp() then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.registrar_id::text, 5112026));
  v_now := clock_timestamp();
  if new.expires_at <= v_now then return new; end if;
  -- A pending update that does not consume another slot may preserve legacy over-limit rows.
  -- Re-check expiry after acquiring the lock so a waiting renewal cannot revive an uncounted slot.
  if tg_op = 'UPDATE' and old.registrar_id = new.registrar_id
    and old.status = 'pending' and old.expires_at > v_now then return new; end if;
  if (select count(*) from public.teaching_epa_magic_links
      where registrar_id = new.registrar_id and status = 'pending' and expires_at > v_now
        and id <> new.id) >= 20 then
    raise exception 'magic_link_limit_reached';
  end if;
  return new;
end $$;

create trigger teaching_epa_pending_limit_guard
  before insert or update of registrar_id, status, expires_at on public.teaching_epa_magic_links
  for each row execute function public.teaching_guard_epa_pending_limit();

create function public.teaching_create_epa_magic_link_v1(p_registrar_id uuid, p_link jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare v_link public.teaching_epa_magic_links;
begin
  if p_registrar_id is null or jsonb_typeof(p_link) is distinct from 'object' then
    raise exception 'magic_link_invalid_request';
  end if;
  insert into public.teaching_epa_magic_links(
    registrar_id, token_hash, epa_number, trainee_name, supervisor_name, supervisor_role,
    clinical_setting, status, expires_at, updated_at
  ) values (
    p_registrar_id, p_link->>'token_hash', (p_link->>'epa_number')::smallint,
    p_link->>'trainee_name', p_link->>'supervisor_name', p_link->>'supervisor_role',
    p_link->>'clinical_setting', 'pending', (p_link->>'expires_at')::timestamptz,
    coalesce((p_link->>'updated_at')::timestamptz, now())
  ) returning * into v_link;
  return to_jsonb(v_link);
end $$;

alter function public.teaching_guard_epa_pending_limit() owner to postgres;
alter function public.teaching_create_epa_magic_link_v1(uuid, jsonb) owner to postgres;
revoke all on function public.teaching_guard_epa_pending_limit(), public.teaching_create_epa_magic_link_v1(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.teaching_guard_epa_pending_limit(), public.teaching_create_epa_magic_link_v1(uuid, jsonb)
  to service_role;

-- Bound the result of overlap checks without comparing raw JSON timestamp text. Existing
-- cancellation and earlier-created-slot priority semantics remain the same as the app.
create function public.teaching_find_supervisor_overlap_v1(
  p_supervisor_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_id uuid,
  p_before_created_at timestamptz default null, p_before_id uuid default null
) returns setof public.registrar_assessments
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
begin
  if p_supervisor_id is null or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
    or p_exclude_id is null or ((p_before_created_at is null) <> (p_before_id is null)) then
    raise exception 'invalid_booking_window';
  end if;
  return query select r.* from public.registrar_assessments r
  where r.assessor_id = p_supervisor_id and r.category = 'supervisor_review'
    and r.ratings->>'kind' = 'supervisor_booking' and r.id <> p_exclude_id
    and (case when r.ratings->>'bookingState' in ('open', 'booked', 'completed', 'cancelled')
      then r.ratings->>'bookingState' when r.status = 'archived' then 'cancelled' else 'active' end) <> 'cancelled'
    and (p_before_created_at is null or (r.created_at, r.id) < (p_before_created_at, p_before_id))
    -- CASE also fences casts from unrelated assessment JSON if the planner reorders filters.
    and (case when r.assessor_id = p_supervisor_id and r.category = 'supervisor_review'
      and r.ratings->>'kind' = 'supervisor_booking' then
        case when jsonb_typeof(r.ratings->'startsAt') = 'string'
          then (r.ratings->>'startsAt')::timestamptz else r.created_at end
      else null end) < p_ends_at
    and (case when r.assessor_id = p_supervisor_id and r.category = 'supervisor_review'
      and r.ratings->>'kind' = 'supervisor_booking' then
        case when jsonb_typeof(r.ratings->'endsAt') = 'string'
          then (r.ratings->>'endsAt')::timestamptz else r.updated_at end
      else null end) > p_starts_at
  order by r.created_at, r.id limit 1;
end $$;
alter function public.teaching_find_supervisor_overlap_v1(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid) owner to postgres;
revoke all on function public.teaching_find_supervisor_overlap_v1(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.teaching_find_supervisor_overlap_v1(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid)
  to service_role;
