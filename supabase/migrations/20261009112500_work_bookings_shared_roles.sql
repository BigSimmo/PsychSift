-- Never edit an applied migration. Merging this applies it to the live database.
-- Courses use the shared role rule (owner request 9 Oct 2026, "complete all recommendations").
-- Who may post and run a team's courses was the site administrator or that team's roster manager.
-- It is now work_can(actor, 'courses.manage', team) from 20261009070000_work_roles.sql, the same
-- rule as src/lib/work-roles/model.ts: the site administrator, the team's roster manager while still
-- an active member, and Medical Workforce or the DCT of the hospital the team is linked to. A course
-- open to everyone stays the site administrator's alone.
--
-- Only two functions change, both replaced in place so their service_role-only grants stay:
-- work_bookings_can_post (every write and the "manage" flag already go through it) and
-- work_bookings_read (the teams offered when posting now include the hospital's linked teams for
-- Medical Workforce and the DCT, who are often in no team). No table or data changes.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- May this actor post or change a course for this team (null = open to everyone)?
create or replace function public.work_bookings_can_post(p_actor_id uuid, p_service_id uuid)
returns boolean
language sql stable security invoker set search_path = '' as $$
  select p_actor_id is not null and (
    public.work_bookings_is_site_admin(p_actor_id)
    or (
      p_service_id is not null
      and exists (
        select 1 from public.on_call_services s
        where s.id = p_service_id and (s.verified_at is not null or s.is_demo)
      )
      and public.work_can(p_actor_id, 'courses.manage', p_service_id)
    )
  )
$$;

-- Everything the Bookings and Courses pages show for this actor, in the shape of BookingsState
-- (bookings.ts) plus which courses the actor manages and where they may post.
create or replace function public.work_bookings_read(p_actor_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_admin boolean;
  v_courses jsonb;
  v_bookings jsonb;
  v_teams jsonb;
begin
  if p_actor_id is null then raise exception 'work_bookings_auth_required'; end if;
  v_admin := public.work_bookings_is_site_admin(p_actor_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'title', c.title, 'about', c.about,
    'date', c.course_date, 'startTime', pg_catalog.to_char(c.start_time, 'HH24:MI'),
    'endTime', pg_catalog.to_char(c.end_time, 'HH24:MI'), 'location', c.location,
    'capacity', c.capacity, 'closesOn', c.closes_on, 'organiser', c.organiser_label,
    'renewal', c.renewal, 'waitlist', c.waitlist, 'status', c.status, 'updatedAt', c.updated_at,
    'change', case when c.change_summary is null then null
                   else jsonb_build_object('summary', c.change_summary, 'at', c.changed_at) end,
    'serviceId', c.service_id, 'manage', v.manage
  ) order by c.course_date, c.start_time, c.id), '[]') into v_courses
  from public.work_booking_courses c join public.work_bookings_visible(p_actor_id) v on v.id = c.id;

  -- Managed courses: every row with names. Others: the actor's own rows, plus everyone else's
  -- live places with no name and no real id, so places left and waitlist position are exact.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', case when v.manage or b.owner_id = p_actor_id then b.id::text else 'other-' || md5(b.id::text) end,
    'courseId', b.course_id,
    'person', case when v.manage or b.owner_id = p_actor_id then b.display_name else null end,
    'self', b.owner_id = p_actor_id,
    'status', b.status, 'at', b.created_at
  ) order by b.course_id, b.created_at, b.id), '[]') into v_bookings
  from public.work_course_bookings b join public.work_bookings_visible(p_actor_id) v on v.id = b.course_id
  where v.manage or b.owner_id = p_actor_id or b.status in ('booked', 'waitlisted', 'attended');

  -- Teams this actor may post for: their own teams, plus the teams linked to a hospital where they
  -- hold Medical Workforce or the DCT. A site administrator may post anywhere but is offered only
  -- the teams they belong to; open-to-everyone posting is the 'administrator' flag.
  select coalesce(jsonb_agg(jsonb_build_object('serviceId', s.id, 'name', s.name) order by s.name, s.id), '[]')
    into v_teams
    from public.on_call_services s
   where (
       public.service_member_active(s.id, p_actor_id)
       or exists (
         select 1 from public.work_hospital_teams t
         join public.work_role_grants g on g.hospital_id = t.hospital_id
         join public.work_hospitals h on h.id = g.hospital_id and h.archived_at is null
         where t.service_id = s.id and g.user_id = p_actor_id and g.revoked_at is null
           and g.role in ('workforce', 'dct')
       )
     )
     and public.work_bookings_can_post(p_actor_id, s.id);

  return jsonb_build_object(
    'courses', v_courses,
    'bookings', v_bookings,
    'organiser', jsonb_build_object('administrator', v_admin, 'teams', v_teams)
  );
end $$;
