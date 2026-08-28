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

create or replace function public.site_content_projection_digest(
  p_logical_id text,
  p_domain text,
  p_record_kind text,
  p_slug text,
  p_payload jsonb,
  p_governance jsonb,
  p_publication_version text,
  p_content_hash text,
  p_source_lineage_digest text
) returns text
language sql immutable strict set search_path = '' as $$
  select public.site_content_json_digest(pg_catalog.jsonb_build_object(
    'logicalId', p_logical_id,
    'domain', p_domain,
    'recordKind', p_record_kind,
    'slug', p_slug,
    'payload', p_payload,
    'governance', p_governance,
    'publicationVersion', p_publication_version,
    'contentHash', p_content_hash,
    'sourceLineageDigest', p_source_lineage_digest
  ))
$$;

create or replace function public.site_content_projection_governance_valid(p_governance jsonb) returns boolean
language sql immutable strict set search_path = '' as $$
  select pg_catalog.jsonb_typeof(p_governance) = 'object'
    and p_governance->>'sourceStatus' = 'current'
    and p_governance->>'validationStatus' in ('locally_reviewed', 'approved')
$$;

alter table public.site_content_publications
  add column projection_digest text generated always as (public.site_content_projection_digest(
    logical_id, domain, record_kind, slug, payload, governance, publication_version, content_hash,
    source_lineage_digest
  )) stored,
  add constraint site_content_publications_projection_digest_check
    check (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  add constraint site_content_publications_governance_check
    check (public.site_content_projection_governance_valid(governance));

alter table public.site_content_release_projections
  add column projection_digest text generated always as (public.site_content_projection_digest(
    logical_id, domain, record_kind, slug, payload, governance, publication_version, content_hash,
    source_lineage_digest
  )) stored,
  add constraint site_content_release_projections_projection_digest_check
    check (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  add constraint site_content_release_projections_governance_check
    check (tombstoned or public.site_content_projection_governance_valid(governance));

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

create or replace function public.publish_site_content_record(p_record jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_release public.site_content_releases%rowtype;
  v_publication uuid;
  v_candidate uuid;
  v_projection_digest text;
begin
  if not public.site_content_admin_authorized() or v_actor is null then
    raise exception 'administrator required';
  end if;
  begin
    v_candidate := (p_record->>'candidateReleaseId')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid candidate release';
  end;
  select * into strict v_release
  from public.site_content_releases
  where id = v_candidate and state = 'candidate'
  for update;
  v_projection_digest := public.site_content_projection_digest(
    p_record->>'logicalId', p_record->>'domain', p_record->>'kind', p_record->>'slug', p_record->'payload',
    p_record->'governance', p_record->>'publicationVersion', p_record->>'contentHash',
    p_record->>'sourceLineageDigest'
  );
  if p_record->>'projectRef' is distinct from v_release.project_ref
    or p_record->>'generationId' is distinct from v_release.generation_id::text
    or p_record->>'planDigest' is distinct from v_release.plan_digest
    or p_record->>'releaseDigest' is distinct from v_release.release_digest
    or p_record->>'staticManifestDigest' is distinct from v_release.static_manifest_digest
    or p_record->>'dynamicStateDigest' is distinct from v_release.dynamic_state_digest
    or p_record->>'recoveryEvidenceDigest' is distinct from v_release.recovery_evidence_digest
    or coalesce(p_record->>'domain', '') not in ('services', 'forms', 'medications', 'differentials')
    or coalesce(p_record->>'contentHash', '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_record->>'sourceLineageDigest', '') !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_record->'payload') is distinct from 'object'
    or not public.site_content_projection_governance_valid(p_record->'governance')
    or p_record->>'projectionDigest' is distinct from v_projection_digest
    or not exists (
      select 1 from public.site_content_release_operations operation
      where operation.release_id = v_release.id
        and operation.logical_id = p_record->>'logicalId'
        and operation.operation = 'changed'
        and operation.content_hash = p_record->>'contentHash'
        and operation.status = 'pending'
    )
  then
    raise exception 'record/candidate/governance binding mismatch';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('site_content:' || p_record->>'logicalId', 0)
  );
  insert into public.site_content_publications(
    logical_id, domain, record_kind, slug, payload, governance, publication_version,
    content_hash, source_lineage_digest, actor_id
  ) values (
    p_record->>'logicalId', p_record->>'domain', p_record->>'kind', p_record->>'slug', p_record->'payload',
    p_record->'governance', p_record->>'publicationVersion', p_record->>'contentHash',
    p_record->>'sourceLineageDigest', v_actor
  )
  on conflict(logical_id) do update set
    domain = excluded.domain,
    record_kind = excluded.record_kind,
    slug = excluded.slug,
    payload = excluded.payload,
    governance = excluded.governance,
    publication_version = excluded.publication_version,
    content_hash = excluded.content_hash,
    source_lineage_digest = excluded.source_lineage_digest,
    actor_id = excluded.actor_id,
    updated_at = now()
  returning id into v_publication;
  update public.site_content_public_authority
  set change_epoch = change_epoch + 1, updated_at = now()
  where singleton;
  insert into public.site_content_sync_outbox(
    publication_id, candidate_release_id, project_ref, logical_id, content_hash, plan_digest, release_digest,
    static_manifest_digest, dynamic_state_digest, recovery_evidence_digest, generation_id, operation
  ) values (
    v_publication, v_release.id, v_release.project_ref, p_record->>'logicalId', p_record->>'contentHash',
    v_release.plan_digest, v_release.release_digest, v_release.static_manifest_digest,
    v_release.dynamic_state_digest, v_release.recovery_evidence_digest, v_release.generation_id, 'changed'
  )
  on conflict do nothing;
  delete from public.rag_response_cache where owner_id is null;
  return pg_catalog.jsonb_build_object('publicationId', v_publication, 'candidateReleaseId', v_release.id);
end
$$;

create or replace function public.site_content_release_projection_bindings(p_release_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'logicalId', projection.logical_id,
    'contentHash', projection.content_hash,
    'projectionDigest', projection.projection_digest
  ) order by projection.logical_id), '[]'::jsonb)
  from public.site_content_release_projections projection
  where projection.release_id = p_release_id and not projection.tombstoned
$$;

create or replace function public.site_content_release_governance_valid(p_release_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    not exists (
      select 1
      from public.site_content_release_projections projection
      where projection.release_id = p_release_id
        and not projection.tombstoned
        and not public.site_content_projection_governance_valid(projection.governance)
    )
    and exists (
      select 1
      from public.site_content_release_gate_artifacts artifact
      where artifact.release_id = p_release_id
        and artifact.owner = 'site-content-governance-registry-v1'
        and artifact.artifact->'projectionBindings'
          = public.site_content_release_projection_bindings(p_release_id)
        and artifact.artifact->>'digest'
          = public.site_content_json_digest(artifact.artifact - 'digest')
        and artifact.artifact_digest = artifact.artifact->>'digest'
    )
$$;

create or replace function public.derive_site_content_release_gate_artifacts(
  p_release_id uuid,
  p_governance_receipt jsonb,
  p_must_pass_receipt jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_release public.site_content_releases%rowtype;
  v_subject jsonb;
  v_subject_digest text;
  v_population jsonb;
  v_expected_population jsonb;
  v_projection_bindings jsonb;
  v_public jsonb;
  v_governance jsonb;
  v_must_pass jsonb;
  v_existing_count integer;
  v_stored_public jsonb;
  v_stored_governance jsonb;
  v_stored_must_pass jsonb;
  v_verification_now timestamptz;
  v_verification_now_text text;
  v_public_observed_at timestamptz;
  v_public_observed_at_text text;
  v_governance_observed_at timestamptz;
  v_must_pass_observed_at timestamptz;
  v_recovery_verified_at timestamptz;
begin
  if not public.site_content_admin_authorized() or auth.uid() is null then
    raise exception 'administrator required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content_release_gate', 0));
  select * into strict v_release from public.site_content_releases where id = p_release_id for update;
  select
    count(*),
    max(artifact) filter(where owner = 'public-site-content-reader-v1'),
    max(artifact) filter(where owner = 'site-content-governance-registry-v1'),
    max(artifact) filter(where owner = 'rag-programme-eval-v1')
  into v_existing_count, v_stored_public, v_stored_governance, v_stored_must_pass
  from public.site_content_release_gate_artifacts
  where release_id = p_release_id;
  if v_existing_count not in (0, 3) then raise exception 'partial immutable gate artifact set'; end if;
  v_verification_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if v_existing_count = 3 then
    begin
      v_public_observed_at := (v_stored_public->>'observedAt')::timestamptz;
    exception when others then
      raise exception 'existing immutable gate derivation clock invalid';
    end;
    if coalesce(v_stored_public->>'observedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      or v_stored_public->>'observedAt' is distinct from pg_catalog.to_char(
        v_public_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    then raise exception 'existing immutable gate derivation clock invalid'; end if;
    v_verification_now := v_public_observed_at;
  else
    v_public_observed_at := v_verification_now;
  end if;
  v_verification_now_text := pg_catalog.to_char(
    v_verification_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_public_observed_at_text := pg_catalog.to_char(
    v_public_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_subject := pg_catalog.jsonb_build_object(
    'projectRef', v_release.project_ref,
    'releaseId', v_release.id,
    'planDigest', v_release.plan_digest,
    'releaseDigest', v_release.release_digest
  );
  v_subject_digest := public.site_content_json_digest(v_subject);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'logicalId', projection.logical_id,
    'contentHash', projection.content_hash
  ) order by projection.logical_id), '[]'::jsonb)
  into v_population
  from public.site_content_release_projections projection
  where projection.release_id = p_release_id and not projection.tombstoned;
  v_projection_bindings := public.site_content_release_projection_bindings(p_release_id);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'logicalId', operation->>'logicalId',
    'contentHash', operation->>'contentHash'
  ) order by operation->>'logicalId'), '[]'::jsonb)
  into v_expected_population
  from pg_catalog.jsonb_array_elements(v_release.plan_json->'operations') operation
  where operation->>'operation' <> 'tombstone';
  if v_population is distinct from v_expected_population
    or exists (
      select 1 from public.site_content_release_operations
      where release_id = p_release_id and status <> 'complete'
    )
    or exists (
      select 1 from public.site_content_release_projections projection
      where projection.release_id = p_release_id and not projection.tombstoned
        and not public.site_content_projection_governance_valid(projection.governance)
    )
    or not public.site_content_gate_owner_receipt_valid(
      p_governance_receipt, 'site-content-governance-registry-v1',
      'site_content_governance_gate_owner_secret', v_subject, v_verification_now
    )
    or not public.site_content_gate_owner_receipt_valid(
      p_must_pass_receipt, 'rag-programme-eval-v1',
      'rag_programme_gate_owner_secret', v_subject, v_verification_now
    )
    or p_governance_receipt->>'version' is distinct from 'site-content-governance-owner-receipt-v1'
    or p_governance_receipt->'population' is distinct from v_population
    or p_governance_receipt->'projectionBindings' is distinct from v_projection_bindings
    or p_governance_receipt->>'registryVersion' is distinct from v_release.registry_version
    or p_governance_receipt->>'staticManifestDigest' is distinct from v_release.static_manifest_digest
    or p_governance_receipt->>'legacyReconciliationDigest' is distinct from v_release.legacy_reconciliation_digest
    or p_governance_receipt->>'legacyDispositionsDigest' is distinct from
      public.site_content_json_digest(v_release.legacy_dispositions)
    or p_governance_receipt->>'sourceStatus' is distinct from 'current'
    or p_governance_receipt->>'validationStatus' is distinct from 'locally_reviewed'
    or p_must_pass_receipt->>'version' is distinct from 'site-content-must-pass-owner-receipt-v1'
    or p_must_pass_receipt->>'caseSetFingerprint' is distinct from
      'sha256:4bf13e036a49ee077a9227c6b61d6f597efff15e8a5f2e3ea36f0cd4e4ea5107'
    or p_must_pass_receipt->'evaluatedCaseIds' is distinct from
      '["direct-evidence-generic-refusal","trusted-admin-activation","ordinary-upload-denied","private-staging-excluded","broad-partial-exact-gap","uploaded-australian-augmentation","site-specifier-current","site-differential-current","site-medication-current","cross-domain-site-coverage","uploaded-primary-over-site-summary","site-product-primary","changed-deleted-site-record","stale-manifest-cache-mismatch","uploaded-public-visible-conflict","public-release-auth-parity","site-admin-only-mutation","source-role-mismatch","site-sync-unavailable","australian-augmentation-unavailable","healthdirect-excluded","etg-amh-link-only","prohibited-upload-pre-provider","narrow-answer-concise","broad-answer-complete","broad-management-route","structured-output-truncation","anaphoric-follow-up","incremental-reconciliation"]'::jsonb
    or p_must_pass_receipt->'failedCaseIds' is distinct from '[]'::jsonb
    or p_must_pass_receipt->>'candidateRunDigest' !~ '^sha256:[0-9a-f]{64}$'
    or p_must_pass_receipt->>'baselineRunDigest' !~ '^sha256:[0-9a-f]{64}$'
    or p_must_pass_receipt->>'gatePolicyDigest' is distinct from
      'sha256:a5c852d6569aefb8188935c64df4f1a2d5a3aea01536498468505f2fe7df04da'
    or p_must_pass_receipt->>'gateDecisionDigest' is distinct from
      'sha256:1c28e0d9ff79e413f9a10ba071a81c53ce3ba369ec9cf1be0e69ff41023ce506'
  then raise exception 'fixed gate-owner output invalid'; end if;
  begin
    v_governance_observed_at := (p_governance_receipt->>'observedAt')::timestamptz;
    v_must_pass_observed_at := (p_must_pass_receipt->>'observedAt')::timestamptz;
    v_recovery_verified_at := (v_release.recovery_evidence->>'verifiedAt')::timestamptz;
  exception when others then
    raise exception 'gate-owner chronology invalid';
  end;
  if v_governance_observed_at is null or v_must_pass_observed_at is null or v_recovery_verified_at is null
    or v_governance_observed_at < v_recovery_verified_at
    or v_must_pass_observed_at < v_governance_observed_at
    or v_must_pass_observed_at > v_public_observed_at
  then raise exception 'gate-owner chronology invalid'; end if;
  v_public := pg_catalog.jsonb_build_object(
    'owner', 'public-site-content-reader-v1',
    'subjectDigest', v_subject_digest,
    'observedAt', v_public_observed_at_text,
    'population', v_population,
    'populationDigest', public.site_content_json_digest(v_population)
  );
  v_public := v_public || pg_catalog.jsonb_build_object('digest', public.site_content_json_digest(v_public));
  v_governance := (p_governance_receipt - 'mac' - 'version' - 'subject') ||
    pg_catalog.jsonb_build_object(
      'digest', public.site_content_json_digest(p_governance_receipt - 'mac' - 'version' - 'subject')
    );
  v_must_pass := pg_catalog.jsonb_build_object(
    'owner', 'rag-programme-eval-v1',
    'subjectDigest', v_subject_digest,
    'observedAt', p_must_pass_receipt->>'observedAt',
    'caseSetFingerprint', p_must_pass_receipt->>'caseSetFingerprint',
    'evaluatedCaseIds', p_must_pass_receipt->'evaluatedCaseIds',
    'failedCaseIds', '[]'::jsonb,
    'runDigest', p_must_pass_receipt->>'candidateRunDigest',
    'populationFingerprint', p_must_pass_receipt->>'populationFingerprint',
    'baselineRunDigest', p_must_pass_receipt->>'baselineRunDigest',
    'gatePolicyDigest', p_must_pass_receipt->>'gatePolicyDigest',
    'gateDecisionDigest', p_must_pass_receipt->>'gateDecisionDigest'
  );
  v_must_pass := v_must_pass || pg_catalog.jsonb_build_object(
    'digest', public.site_content_json_digest(v_must_pass)
  );
  if v_existing_count = 3 then
    if v_stored_public is distinct from v_public
      or v_stored_governance is distinct from v_governance
      or v_stored_must_pass is distinct from v_must_pass
      or exists (
        select 1 from public.site_content_release_gate_artifacts artifact
        where artifact.release_id = p_release_id
          and (
            artifact.subject is distinct from v_subject
            or artifact.subject_digest is distinct from v_subject_digest
            or artifact.artifact_digest is distinct from artifact.artifact->>'digest'
            or artifact.observed_at is distinct from (artifact.artifact->>'observedAt')::timestamptz
          )
      )
    then raise exception 'existing immutable gate artifact set invalid'; end if;
    return pg_catalog.jsonb_build_object(
      'releaseId', p_release_id, 'verificationNow', v_verification_now_text, 'derived', false
    );
  end if;
  insert into public.site_content_release_gate_artifacts(
    release_id, owner, subject, subject_digest, artifact, artifact_digest, observed_at
  ) values
    (p_release_id, 'public-site-content-reader-v1', v_subject, v_subject_digest, v_public,
      v_public->>'digest', (v_public->>'observedAt')::timestamptz),
    (p_release_id, 'site-content-governance-registry-v1', v_subject, v_subject_digest, v_governance,
      v_governance->>'digest', (v_governance->>'observedAt')::timestamptz),
    (p_release_id, 'rag-programme-eval-v1', v_subject, v_subject_digest, v_must_pass,
      v_must_pass->>'digest', (v_must_pass->>'observedAt')::timestamptz);
  return pg_catalog.jsonb_build_object(
    'releaseId', p_release_id, 'verificationNow', v_verification_now_text, 'derived', true
  );
end
$$;

create or replace function public.guard_site_content_release_governance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.governance_verified or new.state = 'active')
    and not public.site_content_release_governance_valid(new.id)
  then
    raise exception 'release governance is missing, stale, or unverified';
  end if;
  return new;
end
$$;

create trigger site_content_release_governance_guard
before update of governance_verified, state on public.site_content_releases
for each row execute function public.guard_site_content_release_governance();

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
    select candidate.id, candidate.created_at
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
      case when pending_summary.logical_id_count = 0 then null
        else greatest(0::numeric, pg_catalog.floor(extract(epoch from
          (pg_catalog.statement_timestamp() - pg_catalog.min(candidate.created_at)))))::integer
      end as oldest_pending_age_seconds
    from pending_summary
    left join direct_candidates candidate on true
    left join public.site_content_sync_outbox event on event.candidate_release_id = candidate.id
    group by pending_summary.logical_id_count
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
  ),
  domain_evidence as (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'domain', evidence.domain,
      'recordCount', evidence.record_count,
      'reviewState', evidence.review_state,
      'sourceStatus', evidence.source_status,
      'validationStatus', evidence.validation_status
    ) order by evidence.domain), '[]'::jsonb) as domains
    from (
      select
        projection.domain,
        pg_catalog.count(*)::integer as record_count,
        case when pg_catalog.bool_and(
          projection.governance->>'sourceStatus' = 'current'
          and projection.governance->>'validationStatus' in ('locally_reviewed', 'approved')
        ) then 'reviewed' else 'unreviewed' end as review_state,
        case
          when pg_catalog.bool_and(projection.governance->>'sourceStatus' = 'current') then 'current'
          when pg_catalog.bool_or(projection.governance->>'sourceStatus' = 'review_due') then 'review_due'
          when pg_catalog.bool_or(projection.governance->>'sourceStatus' = 'outdated') then 'outdated'
          else 'unknown'
        end as source_status,
        case
          when pg_catalog.bool_and(projection.governance->>'validationStatus' = 'approved') then 'approved'
          when pg_catalog.bool_and(
            projection.governance->>'validationStatus' in ('locally_reviewed', 'approved')
          ) then 'locally_reviewed'
          else 'unverified'
        end as validation_status
      from active_release active
      join public.site_content_release_projections projection on projection.release_id = active.id
      where not projection.tombstoned
      group by projection.domain
    ) evidence
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
    'domainEvidence', domain_evidence.domains,
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
  cross join domain_evidence
  left join public.site_content_synchronizer_state synchronizer on synchronizer.singleton
$$;

revoke all on function public.record_site_content_synchronizer_heartbeat(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.read_site_content_runtime_authority()
  from public, anon, authenticated, service_role;
revoke all on function public.site_content_projection_digest(text, text, text, text, jsonb, jsonb, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.site_content_projection_governance_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.site_content_release_projection_bindings(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.site_content_release_governance_valid(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.guard_site_content_release_governance()
  from public, anon, authenticated, service_role;
grant execute on function public.record_site_content_synchronizer_heartbeat(uuid, uuid, text) to service_role;
grant execute on function public.read_site_content_runtime_authority() to service_role;
