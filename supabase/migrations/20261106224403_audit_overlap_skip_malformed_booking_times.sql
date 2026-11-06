-- teaching_find_supervisor_overlap_v1 (20261105144902) cast each existing booking's
-- startsAt/endsAt string straight to timestamptz, so one malformed stored timestamp aborted
-- the whole overlap check with booking_database_error. The app check it replaced skipped a
-- booking whose times Date.parse could not read. A string that is not a valid timestamptz
-- now reads as null, so that booking is never an overlap. Valid strings compare as before,
-- and non-string values keep their created_at/updated_at fallbacks. Body otherwise unchanged.
-- Draft only. Applying/merging this migration requires the owner's own database approval.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.teaching_find_supervisor_overlap_v1(
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
    -- pg_input_is_valid keeps one malformed stored time from aborting the check.
    and (case when r.assessor_id = p_supervisor_id and r.category = 'supervisor_review'
      and r.ratings->>'kind' = 'supervisor_booking' then
        case when jsonb_typeof(r.ratings->'startsAt') = 'string' then
          case when pg_input_is_valid(r.ratings->>'startsAt', 'timestamptz')
            then (r.ratings->>'startsAt')::timestamptz else null end
        else r.created_at end
      else null end) < p_ends_at
    and (case when r.assessor_id = p_supervisor_id and r.category = 'supervisor_review'
      and r.ratings->>'kind' = 'supervisor_booking' then
        case when jsonb_typeof(r.ratings->'endsAt') = 'string' then
          case when pg_input_is_valid(r.ratings->>'endsAt', 'timestamptz')
            then (r.ratings->>'endsAt')::timestamptz else null end
        else r.updated_at end
      else null end) > p_starts_at
  order by r.created_at, r.id limit 1;
end $$;
alter function public.teaching_find_supervisor_overlap_v1(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid) owner to postgres;
revoke all on function public.teaching_find_supervisor_overlap_v1(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.teaching_find_supervisor_overlap_v1(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid)
  to service_role;
