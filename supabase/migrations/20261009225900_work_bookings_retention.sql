-- Never edit an applied migration. Merging this applies it to the live database.
-- Course bookings keep 12 months (owner request 9 Oct 2026, "go ahead with all final
-- recommendations"), the same span as Roster and the window work_bookings_visible already reads.
-- A course, with every booking on it, is deleted once its day is more than 12 calendar months
-- before today in Perth. Bookings cascade from the course (work_course_bookings.course_id on
-- delete cascade), so names on old courses go with it. Runs nightly from pg_cron, which is
-- already enabled (20260901033250). Adds one function and one job; no table changes.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.work_bookings_retention_purge()
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_bookings integer;
  v_courses integer;
begin
  select count(*) into v_bookings
    from public.work_course_bookings b
    join public.work_booking_courses c on c.id = b.course_id
   where c.course_date < (public.work_bookings_today() - interval '12 months')::date;
  delete from public.work_booking_courses
   where course_date < (public.work_bookings_today() - interval '12 months')::date;
  get diagnostics v_courses = row_count;
  return jsonb_build_object('courses', v_courses, 'bookings', v_bookings);
end $$;

revoke all on function public.work_bookings_retention_purge() from public, anon, authenticated;
grant execute on function public.work_bookings_retention_purge() to service_role;

-- Nightly, ten minutes after the Roster purge.
do $work_bookings_retention$
declare job record;
begin
  if to_regprocedure('public.work_bookings_retention_purge()') is null then
    raise exception 'Missing public.work_bookings_retention_purge()';
  end if;
  for job in select jobid from cron.job where jobname = 'work-bookings-retention-purge' loop
    perform cron.unschedule(job.jobid);
  end loop;
  perform cron.schedule(
    'work-bookings-retention-purge', '30 3 * * *', $job$select public.work_bookings_retention_purge();$job$
  );
end
$work_bookings_retention$;
