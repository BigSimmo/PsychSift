-- Never edit an applied migration. Merging this applies it to the live database.
-- Rotation preference rounds (owner request 9 Oct 2026, Roster, Rotations). A team's roster
-- manager opens a round: the terms of the year, the rotations on offer with places per term, a
-- closing time and who is in it. Doctors rank the rotations; the manager runs the allocation,
-- adjusts it by hand and publishes. Published placements reach each doctor's own calendar link.
--
-- The rules live in the app (src/lib/roster/rotations/operations.ts) and run on the server before
-- every write. These tables only hold the result. Tenancy is the same as every Roster table: RLS on,
-- no policies, no grant to anon or authenticated, service_role only. The server checks the reader's
-- active team membership on every read, and roster_rotation_can_manage() before every manager write.
--
-- Rounds hold staff names, rotation names and dates only, never patient data. Free text (round
-- name, note, term labels, rotation names and sites) is checked for patient details before it is
-- stored.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.roster_rotation_rounds (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.on_call_services (id) on delete cascade,
  status text not null default 'draft',
  setup jsonb not null,
  locks jsonb not null default '[]'::jsonb,
  allocation jsonb,
  admin_name text not null,
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint roster_rotation_rounds_status check (status in ('draft', 'open', 'closed', 'published')),
  constraint roster_rotation_rounds_setup_object check (jsonb_typeof(setup) = 'object'),
  constraint roster_rotation_rounds_setup_size check (octet_length(setup::text) <= 262144),
  constraint roster_rotation_rounds_locks_array check (jsonb_typeof(locks) = 'array'),
  constraint roster_rotation_rounds_allocation_object check (allocation is null or jsonb_typeof(allocation) = 'object'),
  constraint roster_rotation_rounds_allocation_size check (allocation is null or octet_length(allocation::text) <= 1048576),
  constraint roster_rotation_rounds_admin_name check (btrim(admin_name) <> '' and char_length(admin_name) <= 80),
  constraint roster_rotation_rounds_version check (version > 0),
  constraint roster_rotation_rounds_published_at check (status <> 'published' or published_at is not null)
);
create index roster_rotation_rounds_service_idx on public.roster_rotation_rounds (service_id, created_at desc);
create trigger roster_rotation_rounds_updated_at before update on public.roster_rotation_rounds
  for each row execute function public.set_updated_at();

-- One doctor's ranked choices for one round. A null submitted_at is a draft the doctor has not sent.
create table public.roster_rotation_preferences (
  round_id uuid not null references public.roster_rotation_rounds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  ranking jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (round_id, user_id),
  constraint roster_rotation_preferences_ranking check (jsonb_typeof(ranking) = 'array' and jsonb_array_length(ranking) <= 60)
);
create index roster_rotation_preferences_user_idx on public.roster_rotation_preferences (user_id);

alter table public.roster_rotation_rounds enable row level security;
revoke all on table public.roster_rotation_rounds from public, anon, authenticated;
grant select, insert, update, delete on table public.roster_rotation_rounds to service_role;

alter table public.roster_rotation_preferences enable row level security;
revoke all on table public.roster_rotation_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.roster_rotation_preferences to service_role;

-- Who may run a team's rotation rounds: an active member holding the Roster manager role. Kept as
-- its own function so the Hospital roles work can repoint it later without touching the app.
create function public.roster_rotation_can_manage(p_service_id uuid, p_user_id uuid) returns boolean
language sql stable security invoker set search_path = public, pg_catalog, pg_temp as $$
  select public.service_member_active(p_service_id, p_user_id)
    and exists (
      select 1 from public.roster_member_roles
      where service_id = p_service_id and user_id = p_user_id and role = 'manager' and revoked_at is null
    )
$$;
revoke all on function public.roster_rotation_can_manage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.roster_rotation_can_manage(uuid, uuid) to service_role;

-- A doctor's ranking is checked against the round as the server read it. This writes it only while the
-- round is still that version (same updated_at and status) and still before its closing time, holding a
-- share lock on the round row so a close, allocation or edit cannot commit in between. False means the
-- round moved on: nothing is written and the server answers 409, so the doctor reloads and sees the round
-- as it now is. Share locks do not block each other, so doctors still save side by side.
create function public.roster_rotation_save_preference(
  p_round_id uuid,
  p_user_id uuid,
  p_round_updated_at timestamptz,
  p_round_status text,
  p_ranking jsonb,
  p_submitted_at timestamptz,
  p_updated_at timestamptz
) returns boolean
language plpgsql volatile security invoker set search_path = public, pg_catalog, pg_temp as $$
begin
  perform 1 from public.roster_rotation_rounds
    where id = p_round_id and updated_at = p_round_updated_at and status = p_round_status
      and (setup->>'closesAt')::timestamptz > clock_timestamp()
    for share;
  if not found then
    return false;
  end if;
  insert into public.roster_rotation_preferences (round_id, user_id, ranking, submitted_at, updated_at)
  values (p_round_id, p_user_id, p_ranking, p_submitted_at, p_updated_at)
  on conflict (round_id, user_id) do update
    set ranking = excluded.ranking, submitted_at = excluded.submitted_at, updated_at = excluded.updated_at;
  return true;
end
$$;
revoke all on function public.roster_rotation_save_preference(uuid, uuid, timestamptz, text, jsonb, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.roster_rotation_save_preference(uuid, uuid, timestamptz, text, jsonb, timestamptz, timestamptz)
  to service_role;

-- Every administrator change to a round (edit, open, close, allocate, move, lock, publish). The server
-- worked the change out from the round and every doctor's ranking as it read them. This saves it only if
-- none of that has moved since: the round row is locked first, which waits for any doctor's save already
-- under way and holds off new ones, then the rankings are compared with the ones the server read. A
-- ranking saved in between returns false, nothing is written and the administrator reloads (409), so an
-- allocation never leaves out a ranking a doctor was told was saved. An edit's tidy-up of the rankings
-- (people taken out, rotations no longer offered) runs in the same transaction, so it can neither half
-- finish nor overwrite a ranking saved after the read.
create function public.roster_rotation_save_round(
  p_round_id uuid,
  p_round_updated_at timestamptz,
  p_seen_preferences jsonb,
  p_status text,
  p_setup jsonb,
  p_locks jsonb,
  p_allocation jsonb,
  p_admin_name text,
  p_version integer,
  p_opened_at timestamptz,
  p_published_at timestamptz,
  p_preferences jsonb
) returns boolean
language plpgsql volatile security invoker set search_path = public, pg_catalog, pg_temp as $$
begin
  perform 1 from public.roster_rotation_rounds
    where id = p_round_id and updated_at = p_round_updated_at
    for update;
  if not found then
    return false;
  end if;
  if (select count(*) from public.roster_rotation_preferences where round_id = p_round_id)
       <> coalesce(jsonb_array_length(p_seen_preferences), -1)
     or exists (
       select 1 from jsonb_to_recordset(p_seen_preferences) as seen(user_id uuid, updated_at timestamptz)
       where not exists (
         select 1 from public.roster_rotation_preferences p
         where p.round_id = p_round_id and p.user_id = seen.user_id and p.updated_at = seen.updated_at
       )
     ) then
    return false;
  end if;
  update public.roster_rotation_rounds
    set status = p_status, setup = p_setup, locks = p_locks, allocation = nullif(p_allocation, 'null'::jsonb),
        admin_name = p_admin_name, version = p_version, opened_at = p_opened_at, published_at = p_published_at
    where id = p_round_id;
  if p_preferences is not null then
    delete from public.roster_rotation_preferences p
      where p.round_id = p_round_id
        and not exists (
          select 1 from jsonb_to_recordset(p_preferences) as kept(user_id uuid, ranking jsonb)
          where kept.user_id = p.user_id
        );
    update public.roster_rotation_preferences p
      set ranking = kept.ranking
      from jsonb_to_recordset(p_preferences) as kept(user_id uuid, ranking jsonb)
      where p.round_id = p_round_id and p.user_id = kept.user_id and p.ranking is distinct from kept.ranking;
  end if;
  return true;
end
$$;
revoke all on function public.roster_rotation_save_round(uuid, timestamptz, jsonb, text, jsonb, jsonb, jsonb, text, integer, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.roster_rotation_save_round(uuid, timestamptz, jsonb, text, jsonb, jsonb, jsonb, text, integer, timestamptz, timestamptz, jsonb)
  to service_role;
