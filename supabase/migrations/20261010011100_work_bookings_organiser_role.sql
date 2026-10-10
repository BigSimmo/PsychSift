-- Never edit an applied migration. Merging this applies it to the live database.
-- Organiser access ends with the Courses role (owner decision 10 Oct 2026, "Build the database
-- change that hides booked names from organisers who lose the Courses role?", answered yes).
-- work_bookings_visible gave the course's poster "manage", which shows every booked name, and
-- kept their drafts visible, even after they lost the Courses role. Editing already required
-- work_bookings_can_post. Now only the site administrator and a current Courses manager of the
-- team (work_bookings_can_post) manage a course or see its drafts. A former organiser still sees
-- a posted course like any team member, with only their own booking named.
--
-- One function, replaced in place so its service_role-only grant stays. work_cancel_course is
-- unchanged. No table or data changes.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The courses this actor may see, and whether they manage each one. Bounded to the last year.
create or replace function public.work_bookings_visible(p_actor_id uuid)
returns table (id uuid, manage boolean)
language sql stable security invoker set search_path = '' as $$
  with me as (select public.work_bookings_is_site_admin(p_actor_id) as admin, public.work_bookings_today() as today)
  select c.id, (me.admin or (c.service_id is not null and public.work_bookings_can_post(p_actor_id, c.service_id)))
    from public.work_booking_courses c cross join me
   where p_actor_id is not null
     and c.course_date >= me.today - 365
     and (
       me.admin
       -- Any current manager of the team runs its courses, drafts included.
       or (c.service_id is not null and public.work_bookings_can_post(p_actor_id, c.service_id))
       or (c.status in ('posted', 'cancelled')
           and (c.service_id is null or public.service_member_active(c.service_id, p_actor_id)))
       or (c.status <> 'draft' and exists (
             select 1 from public.work_course_bookings b where b.course_id = c.id and b.owner_id = p_actor_id))
     )
$$;
