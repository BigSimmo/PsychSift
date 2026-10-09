-- Never edit an applied migration. Merging this applies it to the live database.
-- Hospital-side roles (top 20 item 18, "Hospital-side roles" thread, 9 Oct 2026). One role model
-- shared by every hospital-side feature: Medical Workforce and the Director of Clinical Training
-- (DCT) for one hospital, and a supervisor or assessor for named trainees or a whole team. The site
-- administrator role stays in app_metadata and the roster manager role stays in
-- roster_member_roles; work_can() reads all of them, mirroring src/lib/work-roles/model.ts.
-- A hospital groups teams (on_call_services). Every grant keeps who gave it and when, and a removal
-- keeps the row with who removed it, so the table is its own log. Written only by /api/work/people
-- with the service role after the server check; nothing here holds patient details.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.work_hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and char_length(name) <= 160),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index work_hospitals_name_idx on public.work_hospitals (lower(btrim(name))) where archived_at is null;

-- A team belongs to at most one hospital.
create table public.work_hospital_teams (
  service_id uuid primary key references public.on_call_services (id) on delete cascade,
  hospital_id uuid not null references public.work_hospitals (id) on delete cascade,
  linked_by uuid references auth.users (id) on delete set null,
  linked_at timestamptz not null default now()
);
create index work_hospital_teams_hospital_idx on public.work_hospital_teams (hospital_id);

create table public.work_role_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('workforce', 'dct', 'supervisor')),
  hospital_id uuid not null references public.work_hospitals (id) on delete cascade,
  -- A whole-team supervisor.
  service_id uuid references public.on_call_services (id) on delete cascade,
  -- A supervisor of one trainee.
  subject_user_id uuid references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  constraint work_role_grants_shape check (
    (role in ('workforce', 'dct') and service_id is null and subject_user_id is null)
    or (role = 'supervisor' and ((service_id is null) <> (subject_user_id is null)))
  ),
  constraint work_role_grants_not_self check (subject_user_id is null or subject_user_id <> user_id),
  constraint work_role_grants_not_self_granted check (granted_by is null or granted_by <> user_id)
);
create unique index work_role_grants_active_idx on public.work_role_grants (
  user_id, role, hospital_id,
  coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where revoked_at is null;
create index work_role_grants_user_idx on public.work_role_grants (user_id) where revoked_at is null;
create index work_role_grants_hospital_idx on public.work_role_grants (hospital_id) where revoked_at is null;
create index work_role_grants_subject_idx on public.work_role_grants (subject_user_id) where revoked_at is null;

alter table public.work_hospitals enable row level security;
alter table public.work_hospital_teams enable row level security;
alter table public.work_role_grants enable row level security;
revoke all on table public.work_hospitals from public, anon, authenticated;
revoke all on table public.work_hospital_teams from public, anon, authenticated;
revoke all on table public.work_role_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.work_hospitals to service_role;
grant select, insert, update, delete on table public.work_hospital_teams to service_role;
grant select, insert, update, delete on table public.work_role_grants to service_role;

-- The one permission check for SQL callers (rotation rounds, course bookings, assessments), the same
-- rules as decideWorkCapability in src/lib/work-roles/model.ts. Fails closed on an unknown capability.
-- Scope: p_service_id for a team, p_hospital_id for a hospital, p_subject_user for a trainee (with
-- their team in p_service_id when known). All null means "everyone", which only the administrator holds.
create function public.work_can(
  p_actor_id uuid,
  p_capability text,
  p_service_id uuid default null,
  p_hospital_id uuid default null,
  p_subject_user uuid default null
) returns boolean
language plpgsql stable security definer
set search_path = public, pg_catalog, pg_temp as $$
declare
  v_admin_ok boolean;
  v_hospital_roles text[];
  v_team_roles text[];
  v_trainee_ok boolean;
  v_scope_hospital uuid;
begin
  if p_actor_id is null then return false; end if;
  case p_capability
    when 'courses.manage' then v_admin_ok := true; v_hospital_roles := array['workforce', 'dct']; v_team_roles := array['manager']; v_trainee_ok := false;
    when 'rotations.manage' then v_admin_ok := true; v_hospital_roles := array['workforce']; v_team_roles := array['manager']; v_trainee_ok := false;
    when 'assessments.review' then v_admin_ok := false; v_hospital_roles := array['dct']; v_team_roles := array['supervisor']; v_trainee_ok := true;
    when 'assessments.overview' then v_admin_ok := true; v_hospital_roles := array['dct', 'workforce']; v_team_roles := array[]::text[]; v_trainee_ok := false;
    when 'assessments.administer' then v_admin_ok := true; v_hospital_roles := array['dct']; v_team_roles := array[]::text[]; v_trainee_ok := false;
    when 'starters.view' then v_admin_ok := true; v_hospital_roles := array['workforce']; v_team_roles := array[]::text[]; v_trainee_ok := false;
    when 'sick.inbox' then v_admin_ok := true; v_hospital_roles := array['workforce']; v_team_roles := array['manager']; v_trainee_ok := false;
    when 'staffing.manage' then v_admin_ok := true; v_hospital_roles := array['workforce']; v_team_roles := array['manager']; v_trainee_ok := false;
    when 'roles.grant' then v_admin_ok := true; v_hospital_roles := array['workforce']; v_team_roles := array[]::text[]; v_trainee_ok := false;
    else return false;
  end case;

  -- A doctor never reviews their own assessments.
  if p_capability = 'assessments.review' and p_subject_user = p_actor_id then return false; end if;

  if v_admin_ok and exists (
    select 1 from auth.users u
    where u.id = p_actor_id and u.raw_app_meta_data->>'site_role' is not distinct from 'administrator'
  ) then
    return true;
  end if;

  -- Hospital roles cover the hospital itself and every team linked to it. A team decides its own
  -- hospital: a different p_hospital_id beside it is refused, and a trainee with no team gets no
  -- hospital role, so a hospital can never vouch for someone else's team.
  if p_service_id is not null then
    v_scope_hospital := (select t.hospital_id from public.work_hospital_teams t where t.service_id = p_service_id);
    if p_hospital_id is not null and v_scope_hospital is distinct from p_hospital_id then return false; end if;
  elsif p_subject_user is null then
    v_scope_hospital := p_hospital_id;
  end if;
  if v_scope_hospital is not null and exists (
    select 1 from public.work_role_grants g
    join public.work_hospitals h on h.id = g.hospital_id and h.archived_at is null
    where g.user_id = p_actor_id and g.revoked_at is null and g.hospital_id = v_scope_hospital
      and g.role = any (v_hospital_roles) and g.role in ('workforce', 'dct')
  ) then
    return true;
  end if;

  -- Team roles: the roster manager (while still an active member) and a whole-team supervisor.
  if p_service_id is not null then
    if 'manager' = any (v_team_roles) and public.service_member_active(p_service_id, p_actor_id) and exists (
      select 1 from public.roster_member_roles r
      where r.service_id = p_service_id and r.user_id = p_actor_id and r.role = 'manager' and r.revoked_at is null
    ) then
      return true;
    end if;
    if 'supervisor' = any (v_team_roles) and exists (
      select 1 from public.work_role_grants g
      where g.user_id = p_actor_id and g.revoked_at is null and g.role = 'supervisor' and g.service_id = p_service_id
    ) then
      return true;
    end if;
  end if;

  -- A supervisor of one trainee.
  if v_trainee_ok and p_subject_user is not null and exists (
    select 1 from public.work_role_grants g
    where g.user_id = p_actor_id and g.revoked_at is null and g.role = 'supervisor' and g.subject_user_id = p_subject_user
  ) then
    return true;
  end if;

  return false;
end $$;
revoke all on function public.work_can(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.work_can(uuid, text, uuid, uuid, uuid) to service_role;

-- Medical Workforce staff are often in no team, so the site administrator gives them the role by the
-- email they sign in with. Returns the account id or null; service role only, so no caller outside
-- /api/work/people can probe which emails have accounts.
create function public.work_user_id_by_email(p_email text) returns uuid
language sql stable security definer
set search_path = public, pg_catalog, pg_temp as $$
  select u.id from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1
$$;
revoke all on function public.work_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.work_user_id_by_email(text) to service_role;

-- Sick calls: a shift "I can't make" (roster_act open.report) is inserted as 'reported'. After the
-- manager releases it, it is 'open' like a give-away, so record when it was reported, once, at insert.
-- Medical Workforce's hospital sick calls list reads only rows with reported_at set.
alter table public.roster_open_shifts add column reported_at timestamptz;
update public.roster_open_shifts set reported_at = created_at where status = 'reported';
create function public.roster_open_shifts_mark_reported() returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp as $$
begin
  new.reported_at := case when new.status = 'reported' then coalesce(new.reported_at, now()) else null end;
  return new;
end $$;
revoke all on function public.roster_open_shifts_mark_reported() from public, anon, authenticated;
create trigger roster_open_shifts_mark_reported before insert on public.roster_open_shifts
  for each row execute function public.roster_open_shifts_mark_reported();
create index roster_open_shifts_reported_idx on public.roster_open_shifts (service_id, starts_at) where reported_at is not null;
