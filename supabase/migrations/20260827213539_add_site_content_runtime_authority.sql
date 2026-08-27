-- Request-time public site-content release and synchronizer authority. Source-only: no live action.

alter table public.site_content_releases
  add column deployment_sha text
  generated always as (pg_catalog.lower(plan_json->>'deploymentSha')) stored;

do $$
begin
  if exists (
    select 1
    from public.site_content_releases release
    where release.deployment_sha is null
       or release.deployment_sha !~ '^[0-9a-f]{40}$'
  ) then
    raise exception 'site-content release deployment SHA migration requires every existing plan to carry a full commit SHA';
  end if;
end
$$;

alter table public.site_content_releases
  alter column deployment_sha set not null,
  add constraint site_content_releases_deployment_sha_check
    check (deployment_sha ~ '^[0-9a-f]{40}$');

create table public.site_content_synchronizer_state (
  singleton boolean primary key default true check (singleton),
  last_invocation_id uuid,
  last_worker_id uuid,
  last_invoked_at timestamptz,
  last_heartbeat_at timestamptz,
  last_completed_at timestamptz,
  last_outcome text check (last_outcome in ('running', 'succeeded', 'failed')),
  updated_at timestamptz not null default pg_catalog.statement_timestamp(),
  check (
    (last_invocation_id is null and last_worker_id is null and last_invoked_at is null
      and last_heartbeat_at is null and last_completed_at is null and last_outcome is null)
    or
    (last_invocation_id is not null and last_worker_id is not null and last_invoked_at is not null
      and last_heartbeat_at is not null and last_outcome is not null)
  )
);

insert into public.site_content_synchronizer_state(singleton) values (true);

alter table public.site_content_synchronizer_state enable row level security;
revoke all on table public.site_content_synchronizer_state from public, anon, authenticated, service_role;

create or replace function public.record_site_content_synchronizer_heartbeat(
  p_invocation_id uuid,
  p_worker_id uuid,
  p_phase text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if p_invocation_id is null or p_worker_id is null
    or p_phase not in ('started', 'heartbeat', 'succeeded', 'failed') then
    return pg_catalog.jsonb_build_object('ok', false);
  end if;

  if p_phase = 'started' then
    update public.site_content_synchronizer_state
    set last_invocation_id = p_invocation_id,
        last_worker_id = p_worker_id,
        last_invoked_at = v_now,
        last_heartbeat_at = v_now,
        last_completed_at = null,
        last_outcome = 'running',
        updated_at = v_now
    where singleton;
  elsif p_phase = 'heartbeat' then
    update public.site_content_synchronizer_state
    set last_heartbeat_at = v_now,
        updated_at = v_now
    where singleton
      and last_invocation_id = p_invocation_id
      and last_worker_id = p_worker_id
      and last_outcome = 'running';
  else
    update public.site_content_synchronizer_state
    set last_heartbeat_at = v_now,
        last_completed_at = v_now,
        last_outcome = p_phase,
        updated_at = v_now
    where singleton
      and last_invocation_id = p_invocation_id
      and last_worker_id = p_worker_id
      and last_outcome = 'running';
  end if;

  get diagnostics v_updated = row_count;
  return pg_catalog.jsonb_build_object('ok', v_updated = 1);
exception when others then
  return pg_catalog.jsonb_build_object('ok', false);
end
$$;

create or replace function public.read_site_content_runtime_authority() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with authority as (
    select public_authority.active_release_id, public_authority.change_epoch
    from public.site_content_public_authority public_authority
    where public_authority.singleton
  ),
  active_release as (
    select release.*
    from authority
    left join public.site_content_releases release on release.id = authority.active_release_id
  ),
  direct_candidates as (
    select candidate.id
    from active_release active
    join public.site_content_releases candidate
      on candidate.previous_release_id = active.id and candidate.state = 'candidate'
  ),
  pending_ids as (
    select operation.logical_id
    from direct_candidates candidate
    join public.site_content_release_operations operation on operation.release_id = candidate.id
    where operation.operation <> 'unchanged' or operation.status <> 'complete'
    union
    select event.logical_id
    from direct_candidates candidate
    join public.site_content_sync_outbox event on event.candidate_release_id = candidate.id
    where event.status <> 'complete'
  ),
  pending_summary as (
    select
      (select pg_catalog.count(*) from pending_ids)::integer as logical_id_count,
      coalesce((
        select pg_catalog.jsonb_agg(bounded.logical_id order by bounded.logical_id)
        from (select logical_id from pending_ids order by logical_id limit 101) bounded
      ), '[]'::jsonb) as logical_ids
  ),
  outbox_summary as (
    select
      pg_catalog.count(*) filter (where event.status = 'pending')::integer as pending_count,
      pg_catalog.count(*) filter (where event.status = 'leased')::integer as leased_count,
      pg_catalog.count(*) filter (where event.status = 'quarantined')::integer as quarantined_count,
      case when pg_catalog.count(*) filter (where event.status <> 'complete') = 0 then null
        else greatest(0::numeric, pg_catalog.floor(extract(epoch from
          (pg_catalog.statement_timestamp() - pg_catalog.min(event.created_at)
            filter (where event.status <> 'complete')))))::integer end as oldest_pending_age_seconds
    from direct_candidates candidate
    join public.site_content_sync_outbox event on event.candidate_release_id = candidate.id
  ),
  artifact_summary as (
    select
      pg_catalog.count(artifact.owner)::integer as artifact_count,
      pg_catalog.count(artifact.owner) filter (where
        artifact.subject->>'releaseId' is distinct from active.id::text
        or artifact.subject->>'planDigest' is distinct from active.plan_digest
        or artifact.subject->>'releaseDigest' is distinct from active.release_digest
      )::integer as subject_mismatch_count
    from active_release active
    left join public.site_content_release_gate_artifacts artifact on artifact.release_id = active.id
    group by active.id, active.plan_digest, active.release_digest
  ),
  projection_operation_mismatches as (
    select pg_catalog.count(*)::integer as mismatch_count
    from (
      select projection.logical_id
      from active_release active
      join public.site_content_release_projections projection on projection.release_id = active.id
      where not exists (
        select 1 from public.site_content_release_operations operation
        where operation.release_id = active.id
          and operation.logical_id = projection.logical_id
          and operation.content_hash = projection.content_hash
      )
      union all
      select operation.logical_id
      from active_release active
      join public.site_content_release_operations operation on operation.release_id = active.id
      where operation.operation <> 'tombstone'
        and not exists (
          select 1 from public.site_content_release_projections projection
          where projection.release_id = active.id
            and projection.logical_id = operation.logical_id
            and projection.content_hash = operation.content_hash
            and not projection.tombstoned
        )
    ) mismatch
  ),
  orphaned_outbox as (
    select pg_catalog.count(*)::integer as orphaned_count
    from public.site_content_sync_outbox event
    where event.status <> 'complete'
      and not exists (select 1 from direct_candidates candidate where candidate.id = event.candidate_release_id)
  ),
  rollback as (
    select pg_catalog.count(*) = 1 as available
    from active_release active
    join public.site_content_releases retained
      on retained.id = active.previous_release_id and retained.state = 'retained'
  )
  select pg_catalog.jsonb_build_object(
    'version', 'site-content-runtime-authority-v1',
    'observedAt', pg_catalog.to_char(pg_catalog.statement_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'changeEpoch', authority.change_epoch::text,
    'activeRelease', case when active.id is null then null else pg_catalog.jsonb_build_object(
      'releaseId', active.id,
      'state', active.state,
      'registryVersion', active.registry_version,
      'staticManifestDigest', active.static_manifest_digest,
      'dynamicStateDigest', active.dynamic_state_digest,
      'releaseDigest', active.release_digest,
      'deploymentSha', active.deployment_sha,
      'activatedAt', pg_catalog.to_char(active.activated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expectedRecordCount', active.expected_record_count,
      'projectedRecordCount', active.projected_record_count,
      'integrityVerified', active.integrity_verified,
      'publicVisibilityVerified', active.public_visibility_verified,
      'governanceVerified', active.governance_verified,
      'mustPassVerified', active.must_pass_verified
    ) end,
    'pendingLogicalIds', pending_summary.logical_ids,
    'pendingLogicalIdCount', pending_summary.logical_id_count,
    'directSuccessorCandidateCount', (select pg_catalog.count(*)::integer from direct_candidates),
    'orphanedNonterminalOutboxCount', orphaned_outbox.orphaned_count,
    'outbox', pg_catalog.jsonb_build_object(
      'pendingCount', outbox_summary.pending_count,
      'leasedCount', outbox_summary.leased_count,
      'quarantinedCount', outbox_summary.quarantined_count,
      'oldestPendingAgeSeconds', outbox_summary.oldest_pending_age_seconds
    ),
    'integrity', pg_catalog.jsonb_build_object(
      'gateArtifactCount', artifact_summary.artifact_count,
      'gateArtifactSubjectMismatchCount', artifact_summary.subject_mismatch_count,
      'projectionOperationMismatchCount', projection_operation_mismatches.mismatch_count
    ),
    'rollbackAvailable', rollback.available,
    'synchronizer', pg_catalog.jsonb_build_object(
      'lastInvocationId', synchronizer.last_invocation_id,
      'lastWorkerId', synchronizer.last_worker_id,
      'lastInvokedAt', pg_catalog.to_char(synchronizer.last_invoked_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'lastHeartbeatAt', pg_catalog.to_char(synchronizer.last_heartbeat_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'lastCompletedAt', pg_catalog.to_char(synchronizer.last_completed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'lastOutcome', synchronizer.last_outcome
    )
  )
  from authority
  left join active_release active on true
  cross join pending_summary
  cross join outbox_summary
  cross join artifact_summary
  cross join projection_operation_mismatches
  cross join orphaned_outbox
  cross join rollback
  left join public.site_content_synchronizer_state synchronizer on synchronizer.singleton
$$;

revoke all on function public.record_site_content_synchronizer_heartbeat(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.read_site_content_runtime_authority()
  from public, anon, authenticated, service_role;
grant execute on function public.record_site_content_synchronizer_heartbeat(uuid, uuid, text) to service_role;
grant execute on function public.read_site_content_runtime_authority() to service_role;
