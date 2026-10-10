-- Keep the booking screen aligned with the retention purge's 12-calendar-month boundary.
-- Never edit the applied 20261009012000_work_bookings.sql migration.
create or replace function public.work_bookings_visible(p_actor_id uuid)
returns table (id uuid, manage boolean)
language sql stable security invoker set search_path = '' as $$
  with me as (select public.work_bookings_is_site_admin(p_actor_id) as admin, public.work_bookings_today() as today)
  select c.id, (me.admin or c.organiser_id is not distinct from p_actor_id
                or (c.service_id is not null and public.work_bookings_can_post(p_actor_id, c.service_id)))
    from public.work_booking_courses c cross join me
   where p_actor_id is not null
     and c.course_date >= (me.today - interval '12 months')::date
     and (
       me.admin
       or c.organiser_id = p_actor_id
       -- Any current manager of the team runs its courses, drafts included.
       or (c.service_id is not null and public.work_bookings_can_post(p_actor_id, c.service_id))
       or (c.status in ('posted', 'cancelled')
           and (c.service_id is null or public.service_member_active(c.service_id, p_actor_id)))
       or (c.status <> 'draft' and exists (
             select 1 from public.work_course_bookings b where b.course_id = c.id and b.owner_id = p_actor_id))
     )
$$;
