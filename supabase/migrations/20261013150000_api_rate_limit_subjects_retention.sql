set search_path = public, pg_catalog, pg_temp;

-- api_rate_limit_subjects tracks IP/subject rate limit windows. Bound retention
-- so stale records do not accumulate indefinitely. Default 7 days.
create or replace function public.purge_expired_api_rate_limit_subjects(p_retention_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_retention_days < 1 then
    raise exception 'retention days must be positive';
  end if;
  delete from public.api_rate_limit_subjects where updated_at < now() - make_interval(days => p_retention_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_expired_api_rate_limit_subjects(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_api_rate_limit_subjects(integer) to service_role;

-- Daily purge at 03:45 UTC. Preview/branch databases may not ship pg_cron; skip
-- scheduling there while still installing the purge function.
do $cron$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;

  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname = 'purge-expired-api-rate-limit-subjects';

  perform cron.schedule(
    'purge-expired-api-rate-limit-subjects',
    '45 3 * * *',
    $job$select public.purge_expired_api_rate_limit_subjects(7);$job$
  );
end
$cron$;
