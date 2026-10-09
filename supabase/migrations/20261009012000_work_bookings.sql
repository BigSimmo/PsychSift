-- Never edit an applied migration. Merging this applies it to the live database within seconds.
--
-- Admin · Bookings, saved version (two new tables approved by the owner, 9 Oct 2026): organisers post courses and work requirements with a set
-- number of places; doctors book a place or join the waitlist. The pure rules live in
-- src/lib/work-screens/admin/bookings.ts; these functions are the same rules made atomic and
-- multi-user. Read and written only by /api/work/bookings and /api/work/courses through
-- src/lib/work-screens/admin/bookings-repository.ts.
--
-- Tenancy, the same as Roster and Admin (20260926225409, 20260926225509): RLS on, no policies, no
-- grant to anon or authenticated, service_role only. Every read and write goes through the
-- functions below, which take the actor from the validated session (p_actor_id, passed by the
-- server, never by the request) and check, in SQL on every call:
--   * who may post or change a course: a site administrator (auth.users app metadata
--     site_role = 'administrator', read fresh here, never from a forwarded claim), or the
--     Roster manager (roster_member_roles.role = 'manager') of a confirmed team for that team's
--     own courses. Only a site administrator may post a course open to everyone (service_id null).
--   * who sees a course: anyone signed in for an open course, active team members for a team
--     course, the organiser for their own drafts, and a site administrator for everything.
--   * whose names are seen: the organiser (and a site administrator) sees who booked; a doctor
--     sees only their own booking and a count of everyone else's.
-- Capacity is enforced under a row lock on the course, so two doctors cannot take the last place.
--
-- Free text is staff-facing course detail (title, about, place, organiser label) and staff names.
-- The API rejects text that looks like patient details before it reaches these functions.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- =============================================================================================
-- 1. Tables
-- =============================================================================================

create table public.work_booking_courses (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid references auth.users (id) on delete set null,
  -- Who posted it, as doctors see it ("Medical Education").
  organiser_label text not null check (char_length(btrim(organiser_label)) between 1 and 80),
  -- Null means open to every signed-in doctor; only a site administrator may post one.
  service_id uuid references public.on_call_services (id) on delete cascade,
  kind text not null check (kind in ('course', 'requirement')),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  about text not null default '' check (char_length(about) <= 400),
  -- Wall-clock day and times in the work time zone (Perth), the same shape as CalendarEvent.
  course_date date not null,
  start_time time not null,
  end_time time not null,
  location text not null check (char_length(btrim(location)) between 1 and 80),
  capacity integer not null check (capacity between 1 and 500),
  closes_on date,
  renewal text check (renewal is null or char_length(btrim(renewal)) between 1 and 80),
  waitlist boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  -- The organiser's last change that moved booked doctors' entries, shown to them.
  change_summary text check (change_summary is null or char_length(change_summary) <= 1000),
  changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_booking_courses_ends_after_start check (end_time > start_time),
  constraint work_booking_courses_closes_by_day check (closes_on is null or closes_on <= course_date),
  constraint work_booking_courses_change_pair check ((change_summary is null) = (changed_at is null))
);
create index work_booking_courses_service_date_idx on public.work_booking_courses (service_id, course_date);
create index work_booking_courses_organiser_idx on public.work_booking_courses (organiser_id) where organiser_id is not null;
create index work_booking_courses_date_idx on public.work_booking_courses (course_date);
create trigger work_booking_courses_updated_at before update on public.work_booking_courses
  for each row execute function public.set_updated_at();

create table public.work_course_bookings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.work_booking_courses (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- The name the organiser sees, kept as it was when the place was booked.
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  status text not null check (status in ('booked', 'waitlisted', 'cancelled', 'attended')),
  -- Waitlist order is by created_at (clock time at insert, not transaction start).
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now()
);
-- One live booking per doctor per course; a cancelled row stays as history and a new booking
-- after it is a new row.
create unique index work_course_bookings_one_live_idx on public.work_course_bookings (course_id, owner_id)
  where status in ('booked', 'waitlisted', 'attended');
create index work_course_bookings_course_status_idx on public.work_course_bookings (course_id, status, created_at, id);
create index work_course_bookings_owner_idx on public.work_course_bookings (owner_id);
create trigger work_course_bookings_updated_at before update on public.work_course_bookings
  for each row execute function public.set_updated_at();

do $tenancy$
declare t text;
begin
  foreach t in array array['work_booking_courses', 'work_course_bookings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end
$tenancy$;

-- =============================================================================================
-- 2. Permission helpers
-- =============================================================================================

-- Site administrator, read fresh from auth.users (security definer: auth.users is not granted
-- to service_role by this file). Same claim as src/lib/authorization.ts.
create function public.work_bookings_is_site_admin(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select u.raw_app_meta_data ->> 'site_role' = 'administrator'
    from auth.users u where u.id = p_user_id
  ), false)
$$;
revoke all on function public.work_bookings_is_site_admin(uuid) from public, anon, authenticated;
grant execute on function public.work_bookings_is_site_admin(uuid) to service_role;

-- May this actor post or change a course for this team (null = open to everyone)?
create function public.work_bookings_can_post(p_actor_id uuid, p_service_id uuid)
returns boolean
language sql stable security invoker set search_path = '' as $$
  select p_actor_id is not null and (
    public.work_bookings_is_site_admin(p_actor_id)
    or (
      p_service_id is not null
      and public.service_member_active(p_service_id, p_actor_id)
      and exists (
        select 1 from public.on_call_services s
        where s.id = p_service_id and (s.verified_at is not null or s.is_demo)
      )
      and exists (
        select 1 from public.roster_member_roles r
        where r.service_id = p_service_id and r.user_id = p_actor_id and r.role = 'manager' and r.revoked_at is null
      )
    )
  )
$$;

-- Today in the work time zone. The pages use the reader's chosen zone; the server enforces Perth.
create function public.work_bookings_today()
returns date
language sql stable security invoker set search_path = '' as $$
  select (pg_catalog.now() at time zone 'Australia/Perth')::date
$$;

-- Move people off the waitlist into any free places, first in line first. The caller holds the
-- course row lock. Returns how many moved.
create function public.work_bookings_promote(p_course_id uuid)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_course public.work_booking_courses;
  v_free integer;
  v_moved integer := 0;
begin
  select * into v_course from public.work_booking_courses where id = p_course_id;
  if not found or v_course.status <> 'posted' then return 0; end if;
  select v_course.capacity - count(*) into v_free
    from public.work_course_bookings
   where course_id = p_course_id and status in ('booked', 'attended');
  if v_free <= 0 then return 0; end if;
  with next_in_line as (
    select id from public.work_course_bookings
     where course_id = p_course_id and status = 'waitlisted'
     order by created_at, id
     limit v_free
  )
  update public.work_course_bookings b set status = 'booked'
    from next_in_line n where b.id = n.id;
  get diagnostics v_moved = row_count;
  return v_moved;
end $$;

-- "Thu 22 Oct", the same words as formatCourseDay in bookings.ts.
create function public.work_bookings_day_words(p_day date)
returns text
language sql immutable security invoker set search_path = '' as $$
  select pg_catalog.to_char(p_day::timestamp, 'Dy FMDD Mon')
$$;

create function public.work_bookings_time_words(p_start time, p_end time)
returns text
language sql immutable security invoker set search_path = '' as $$
  select pg_catalog.to_char(p_start, 'HH24:MI') || ' to ' || pg_catalog.to_char(p_end, 'HH24:MI')
$$;

-- =============================================================================================
-- 3. Read
-- =============================================================================================

-- The courses this actor may see, and whether they manage each one. Bounded to the last year.
create function public.work_bookings_visible(p_actor_id uuid)
returns table (id uuid, manage boolean)
language sql stable security invoker set search_path = '' as $$
  with me as (select public.work_bookings_is_site_admin(p_actor_id) as admin, public.work_bookings_today() as today)
  select c.id, (me.admin or c.organiser_id is not distinct from p_actor_id)
    from public.work_booking_courses c cross join me
   where p_actor_id is not null
     and c.course_date >= me.today - 365
     and (
       me.admin
       or c.organiser_id = p_actor_id
       or (c.status in ('posted', 'cancelled')
           and (c.service_id is null or public.service_member_active(c.service_id, p_actor_id)))
       or (c.status <> 'draft' and exists (
             select 1 from public.work_course_bookings b where b.course_id = c.id and b.owner_id = p_actor_id))
     )
$$;

-- Everything the Bookings and Courses pages show for this actor, in the shape of BookingsState
-- (bookings.ts) plus which courses the actor manages and where they may post.
create function public.work_bookings_read(p_actor_id uuid)
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

  -- Teams this actor may post for. A site administrator may post anywhere but is offered only
  -- the teams they belong to; open-to-everyone posting is the 'administrator' flag.
  select coalesce(jsonb_agg(jsonb_build_object('serviceId', s.id, 'name', s.name) order by s.name, s.id), '[]')
    into v_teams
    from public.on_call_services s
   where public.service_member_active(s.id, p_actor_id)
     and public.work_bookings_can_post(p_actor_id, s.id);

  return jsonb_build_object(
    'courses', v_courses,
    'bookings', v_bookings,
    'organiser', jsonb_build_object('administrator', v_admin, 'teams', v_teams)
  );
end $$;

-- =============================================================================================
-- 4. Doctor writes
-- =============================================================================================

-- Book a place, or join the waitlist when the course is full and keeps one.
create function public.work_book_course(p_actor_id uuid, p_course_id uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_course public.work_booking_courses;
  v_today date := public.work_bookings_today();
  v_taken integer;
  v_status text;
  v_name text;
  v_id uuid;
  v_position integer;
begin
  if p_actor_id is null then raise exception 'work_bookings_auth_required'; end if;
  select * into v_course from public.work_booking_courses where id = p_course_id for update;
  if not found or v_course.status = 'draft'
     or (v_course.service_id is not null
         and not public.service_member_active(v_course.service_id, p_actor_id)
         and not public.work_bookings_is_site_admin(p_actor_id)) then
    raise exception 'work_bookings_not_found';
  end if;
  if exists (select 1 from public.work_course_bookings
              where course_id = p_course_id and owner_id = p_actor_id
                and status in ('booked', 'waitlisted', 'attended')) then
    raise exception 'work_bookings_already';
  end if;
  if v_course.status = 'cancelled' then raise exception 'work_bookings_course_cancelled'; end if;
  if v_course.course_date <= v_today then raise exception 'work_bookings_started'; end if;
  if v_course.closes_on is not null and v_course.closes_on < v_today then raise exception 'work_bookings_closed'; end if;

  select count(*) into v_taken from public.work_course_bookings
   where course_id = p_course_id and status in ('booked', 'attended');
  if v_taken < v_course.capacity then v_status := 'booked';
  elsif v_course.waitlist then v_status := 'waitlisted';
  else raise exception 'work_bookings_full';
  end if;

  -- The name the organiser sees is the doctor's team display name (this course's team first,
  -- then their most recently joined team), or 'Doctor' when they have none yet.
  select pg_catalog.btrim(m.display_name) into v_name
    from public.on_call_service_members m
   where m.user_id = p_actor_id and m.revoked_at is null and m.display_name is not null
   order by (m.service_id is not distinct from v_course.service_id) desc, m.joined_at desc
   limit 1;
  -- Never a name the request typed: a doctor could otherwise book under a colleague's name.
  v_name := pg_catalog.left(coalesce(v_name, 'Doctor'), 80);

  insert into public.work_course_bookings (course_id, owner_id, display_name, status)
  values (p_course_id, p_actor_id, v_name, v_status)
  returning id into v_id;

  if v_status = 'waitlisted' then
    select count(*) into v_position from public.work_course_bookings
     where course_id = p_course_id and status = 'waitlisted'
       and (created_at, id) <= (select created_at, id from public.work_course_bookings where id = v_id);
  end if;
  return jsonb_build_object('id', v_id, 'outcome', v_status, 'position', v_position);
end $$;

-- Cancel the actor's place or leave the waitlist. A freed place goes to the first person waiting.
-- Leaving the waitlist removes the row (bookings.ts cancelMyBooking): no calendar entry existed.
create function public.work_cancel_course_booking(p_actor_id uuid, p_course_id uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_booking public.work_course_bookings;
  v_promoted integer := 0;
begin
  if p_actor_id is null then raise exception 'work_bookings_auth_required'; end if;
  perform 1 from public.work_booking_courses where id = p_course_id for update;
  if not found then raise exception 'work_bookings_not_found'; end if;
  select * into v_booking from public.work_course_bookings
   where course_id = p_course_id and owner_id = p_actor_id and status in ('booked', 'waitlisted');
  if not found then raise exception 'work_bookings_not_found'; end if;
  if v_booking.status = 'waitlisted' then
    delete from public.work_course_bookings where id = v_booking.id;
  else
    update public.work_course_bookings set status = 'cancelled' where id = v_booking.id;
    v_promoted := public.work_bookings_promote(p_course_id);
  end if;
  return jsonb_build_object('cancelled', v_booking.status, 'promoted', v_promoted);
end $$;

-- =============================================================================================
-- 5. Organiser writes
-- =============================================================================================

-- Post a new course (p_course_id null) or save an edit. A posted course whose day, time, place
-- or name moves records what changed for booked doctors; extra places go to the waitlist.
create function public.work_save_course(
  p_actor_id uuid,
  p_course_id uuid,
  p_service_id uuid,
  p_organiser_label text,
  p_kind text,
  p_title text,
  p_about text,
  p_course_date date,
  p_start_time time,
  p_end_time time,
  p_location text,
  p_capacity integer,
  p_closes_on date,
  p_renewal text,
  p_waitlist boolean,
  p_post boolean
)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_before public.work_booking_courses;
  v_today date := public.work_bookings_today();
  v_booked integer := 0;
  v_changes text[] := '{}';
  v_moved boolean := false;
  v_id uuid;
  v_status text;
  v_title text := pg_catalog.btrim(p_title);
  v_location text := pg_catalog.btrim(p_location);
  v_renewal text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_renewal, ''))), '');
  v_promoted integer := 0;
begin
  if p_actor_id is null then raise exception 'work_bookings_auth_required'; end if;
  if p_course_date is null or p_course_date <= v_today
     or (p_closes_on is not null and p_closes_on > p_course_date) then
    raise exception 'work_bookings_invalid_request';
  end if;

  if p_course_id is null then
    if not public.work_bookings_can_post(p_actor_id, p_service_id) then raise exception 'work_bookings_role_denied'; end if;
    if p_closes_on is not null and p_closes_on < v_today then raise exception 'work_bookings_invalid_request'; end if;
    v_status := case when p_post then 'posted' else 'draft' end;
    insert into public.work_booking_courses (
      organiser_id, organiser_label, service_id, kind, title, about, course_date, start_time, end_time,
      location, capacity, closes_on, renewal, waitlist, status)
    values (
      p_actor_id, pg_catalog.btrim(p_organiser_label), p_service_id, p_kind, v_title,
      pg_catalog.btrim(coalesce(p_about, '')), p_course_date, p_start_time, p_end_time, v_location,
      p_capacity, p_closes_on, v_renewal, coalesce(p_waitlist, true), v_status)
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'status', v_status, 'changes', '[]'::jsonb,
                              'calendarsUpdated', 0, 'promoted', 0);
  end if;

  select * into v_before from public.work_booking_courses where id = p_course_id for update;
  if not found then raise exception 'work_bookings_not_found'; end if;
  if not public.work_bookings_is_site_admin(p_actor_id)
     and not (v_before.organiser_id is not distinct from p_actor_id
              and public.work_bookings_can_post(p_actor_id, v_before.service_id)) then
    raise exception 'work_bookings_role_denied';
  end if;
  if v_before.status = 'cancelled' then raise exception 'work_bookings_course_cancelled'; end if;
  if p_service_id is distinct from v_before.service_id then raise exception 'work_bookings_invalid_request'; end if;
  -- A closing day already past may stay as it was saved (validateCourseDraft savedClosesOn),
  -- but cannot be moved to another past day.
  if p_closes_on is not null and p_closes_on < v_today and p_closes_on is distinct from v_before.closes_on then
    raise exception 'work_bookings_invalid_request';
  end if;

  select count(*) into v_booked from public.work_course_bookings
   where course_id = p_course_id and status in ('booked', 'attended');
  if p_capacity < v_booked then raise exception 'work_bookings_capacity_below_booked'; end if;

  if v_before.course_date <> p_course_date then
    v_changes := v_changes || ('Day: ' || public.work_bookings_day_words(v_before.course_date)
                               || ' now ' || public.work_bookings_day_words(p_course_date));
  end if;
  if v_before.start_time <> p_start_time or v_before.end_time <> p_end_time then
    v_changes := v_changes || ('Time: ' || public.work_bookings_time_words(v_before.start_time, v_before.end_time)
                               || ' now ' || public.work_bookings_time_words(p_start_time, p_end_time));
  end if;
  if v_before.location <> v_location then
    v_changes := v_changes || ('Place: ' || v_before.location || ' now ' || v_location);
  end if;
  if v_before.title <> v_title then
    v_changes := v_changes || ('Name: ' || v_before.title || ' now ' || v_title);
  end if;
  v_moved := pg_catalog.cardinality(v_changes) > 0 and v_before.status = 'posted';
  v_status := case when p_post then 'posted' else v_before.status end;

  update public.work_booking_courses set
    organiser_label = pg_catalog.btrim(p_organiser_label),
    kind = p_kind,
    title = v_title,
    about = pg_catalog.btrim(coalesce(p_about, '')),
    course_date = p_course_date,
    start_time = p_start_time,
    end_time = p_end_time,
    location = v_location,
    capacity = p_capacity,
    closes_on = p_closes_on,
    renewal = v_renewal,
    waitlist = coalesce(p_waitlist, true),
    status = v_status,
    change_summary = case when v_moved then pg_catalog.left(pg_catalog.array_to_string(v_changes, '. '), 1000)
                          else change_summary end,
    changed_at = case when v_moved then pg_catalog.now() else changed_at end
  where id = p_course_id;

  v_promoted := public.work_bookings_promote(p_course_id);
  return jsonb_build_object('id', p_course_id, 'status', v_status, 'changes', pg_catalog.to_jsonb(v_changes),
                            'calendarsUpdated', case when v_moved then v_booked else 0 end,
                            'promoted', v_promoted);
end $$;

-- Cancel a course. Booked doctors' entries show it cancelled; their booking rows are kept.
create function public.work_cancel_course(p_actor_id uuid, p_course_id uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_course public.work_booking_courses;
  v_booked integer := 0;
begin
  if p_actor_id is null then raise exception 'work_bookings_auth_required'; end if;
  select * into v_course from public.work_booking_courses where id = p_course_id for update;
  if not found then raise exception 'work_bookings_not_found'; end if;
  -- Cancelling only ever takes something away, so the organiser keeps it after losing the role.
  if v_course.organiser_id is distinct from p_actor_id and not public.work_bookings_is_site_admin(p_actor_id) then
    raise exception 'work_bookings_role_denied';
  end if;
  if v_course.status = 'cancelled' then raise exception 'work_bookings_course_cancelled'; end if;
  if v_course.status = 'posted' then
    select count(*) into v_booked from public.work_course_bookings
     where course_id = p_course_id and status in ('booked', 'attended');
  end if;
  update public.work_booking_courses set
    status = 'cancelled',
    change_summary = case when v_course.status = 'posted' then 'Cancelled by the organiser' else null end,
    changed_at = case when v_course.status = 'posted' then pg_catalog.now() else null end
  where id = p_course_id;
  return jsonb_build_object('id', p_course_id, 'calendarsUpdated', v_booked);
end $$;

-- =============================================================================================
-- 6. Grants: service_role only, the same as roster_read / roster_command.
-- =============================================================================================

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.work_bookings_is_site_admin(uuid)',
    'public.work_bookings_can_post(uuid, uuid)',
    'public.work_bookings_today()',
    'public.work_bookings_promote(uuid)',
    'public.work_bookings_day_words(date)',
    'public.work_bookings_time_words(time, time)',
    'public.work_bookings_visible(uuid)',
    'public.work_bookings_read(uuid)',
    'public.work_book_course(uuid, uuid)',
    'public.work_cancel_course_booking(uuid, uuid)',
    'public.work_save_course(uuid, uuid, uuid, text, text, text, text, date, time, time, text, integer, date, text, boolean, boolean)',
    'public.work_cancel_course(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$grants$;
