-- Keep linked teams in live hospitals. Both directions share the hospital-row lock,
-- including direct service-role writes and the existing atomic move/revocation RPC.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.work_guard_live_hospital_team() returns trigger
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
begin
  perform 1 from public.work_hospitals
    where id = new.hospital_id and archived_at is null for share;
  if not found then raise exception 'work_hospital_unavailable'; end if;
  return new;
end $$;

create trigger work_hospital_team_live_guard
  before insert or update of hospital_id on public.work_hospital_teams
  for each row execute function public.work_guard_live_hospital_team();

create function public.work_guard_hospital_archive() returns trigger
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
begin
  -- UPDATE holds the conflicting hospital-row lock before this trigger runs. Re-read
  -- links here after any wait; an earlier application preflight is not authoritative.
  if old.archived_at is null and new.archived_at is not null and exists (
    select 1 from public.work_hospital_teams where hospital_id = old.id
  ) then raise exception 'work_hospital_has_teams'; end if;
  return new;
end $$;

create trigger work_hospital_archive_guard
  before update of archived_at on public.work_hospitals
  for each row execute function public.work_guard_hospital_archive();

alter function public.work_guard_live_hospital_team() owner to postgres;
alter function public.work_guard_hospital_archive() owner to postgres;
revoke all on function public.work_guard_live_hospital_team(), public.work_guard_hospital_archive()
  from public, anon, authenticated;
grant execute on function public.work_guard_live_hospital_team(), public.work_guard_hospital_archive()
  to service_role;
