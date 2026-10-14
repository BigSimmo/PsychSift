-- Forward migration to eliminate redundant release digest computation in read_site_content_health()
-- Ledger issue: #458SAC
--
-- WHAT WAS WRONG:
-- `public.site_content_health_operational_base()` already evaluates release integrity:
--   coalesce(r.release_digest = public.site_content_release_digest(r.id)
--     and s.active_release_digest = r.release_digest
--     and public.site_content_provider_free_checks_pass(r.id), false) release_digest_valid,
--   coalesce(r.dynamic_state_digest = public.site_content_dynamic_state_digest(r.id), false) dynamic_digest_valid,
-- and packages them into the base JSONB payload under 'releaseDigestValid' and 'dynamicDigestValid'.
--
-- The outer wrapper `public.read_site_content_health()` materializes `base` via:
--   base as materialized ( select public.site_content_health_operational_base() payload )
-- but its `integrity` CTE evaluated `public.site_content_release_digest(r.id)` and
-- `public.site_content_dynamic_state_digest(r.id)` a second time.
--
-- `public.site_content_release_digest(r.id)` traverses all 843 rows of the active release,
-- executing 10,969 recursive calls to `site_content_canonical_json`. Doing this twice in one
-- health read wasted 10,969 function invocations per probe.
--
-- WHAT THIS CHANGES:
-- In `read_site_content_health()`, the `integrity` CTE joins `cross join base b` and reuses
-- `(b.payload->>'releaseDigestValid')::boolean` and `(b.payload->>'dynamicDigestValid')::boolean`
-- directly:
--   s.valid and coalesce((b.payload->>'releaseDigestValid')::boolean, false) release_digest_valid,
--   s.valid and coalesce((b.payload->>'dynamicDigestValid')::boolean, false) dynamic_digest_valid,
-- matching the exact pattern used for `pendingSetExact`, `outstandingHeadCountAgrees`,
-- `timeIntegrityValid`, and `rollbackAvailable`.
--
-- Risk: low. One function body, no schema change, no data change, no grant change.
-- Rollback: re-apply the previous body from supabase/migrations/20260913072413_materialize_site_content_health_operational_base.sql.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- The verdict this function returns on the live population, BEFORE the replacement.
create temporary table site_content_health_fold_evidence on commit drop as
select public.read_site_content_health() as before_payload;

create or replace function public.read_site_content_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with state as (
    select s.*, public.site_content_current_transition_kind(
      s.active_transition_receipt_id, s.active_release_id, s.active_release_digest, s.initialized,
      s.served_change_epoch
    ) transition_kind
    from public.site_content_sync_state s where s.singleton
  ), active_release as (
    select r.* from public.site_content_releases r join state s on s.active_release_id = r.id
    where r.state = 'active' and r.release_digest = s.active_release_digest
  ), transition_receipt as (
    select rr.* from public.site_content_release_receipts rr
    join state s on s.active_transition_receipt_id = rr.receipt_id
  ), transition as (
    select s.*,
      case when s.transition_kind = 'rollback'
        then public.site_content_current_transition_source_release_id(s.active_transition_receipt_id)
        else s.active_release_id end head_release_id,
      s.transition_kind in ('activation','rollback')
        or (s.transition_kind = 'bootstrap' and not s.initialized and s.change_epoch = 0 and s.served_change_epoch = 0)
        as valid
    from state s
  ), active_records as (
    select rr.* from public.site_content_release_records rr join active_release r on r.id = rr.release_id
  ), head_records as (
    select rr.* from public.site_content_release_records rr join transition s on s.head_release_id = rr.release_id
  ), outstanding_heads as (
    select h.* from public.site_content_public_records h cross join transition s
    where h.head_change_epoch > s.served_change_epoch
  ), base as materialized (
    select public.site_content_health_operational_base() payload
  ), integrity as (
    select
      s.valid
      and coalesce(r.expected_record_count = (select count(*) from active_records), false)
      and coalesce(r.expected_tombstone_count = (select count(*) from active_records where tombstone), false)
      and not exists (select 1 from active_records where record is null or render_payload is null)
      and not exists (
        select 1 from active_records rr
        left join public.site_content_publications p on p.id = rr.target_publication_id
        where rr.target_publication_id is not null and (
          p.id is null or p.logical_id <> rr.logical_id
          or p.record is distinct from rr.record or p.render_payload is distinct from rr.render_payload
          or p.retired is distinct from rr.tombstone))
      and not exists (
        select 1 from public.site_content_public_records h
        left join head_records rr on rr.target_publication_id = h.current_publication_id
          and rr.logical_id = h.logical_id
        where h.head_change_epoch <= s.served_change_epoch
          and (rr.logical_id is null or h.retired is distinct from rr.tombstone))
      and not exists (
        select 1 from head_records rr
        left join public.site_content_public_records h on h.logical_id = rr.logical_id
        where rr.target_publication_id is not null and (
          h.logical_id is null or (h.head_change_epoch <= s.served_change_epoch and (
            h.current_publication_id is distinct from rr.target_publication_id
            or h.retired is distinct from rr.tombstone))))
      as population_complete,
      s.valid and r.id is not null and coalesce((b.payload->>'releaseDigestValid')::boolean, false) release_digest_valid,
      s.valid and r.id is not null and coalesce((b.payload->>'dynamicDigestValid')::boolean, false) dynamic_digest_valid,
      s.valid and not exists (
        select 1 from active_records rr
        left join public.site_content_publications p on p.id = rr.target_publication_id
        where rr.target_publication_id is not null and (
          p.id is null or p.published_by is null
          or not exists (select 1 from auth.users u where u.id = p.published_by)
          or p.administrator_authorized_at > p.created_at
          or p.administrator_authorization_version <> 'site-content-admin-authorization-v1'))
      and (r.reconciliation_plan_digest is null or exists (
        select 1 from public.site_content_reconciliation_plans rp
        where rp.plan_digest = r.reconciliation_plan_digest
          and rp.reviewed_by is not null
          and exists (select 1 from auth.users u where u.id = rp.reviewed_by)
          and rp.reviewed_at = rp.administrator_authorized_at
          and rp.administrator_authorization_version = 'site-content-admin-authorization-v1'))
        administrator_attestation_valid,
      s.valid and not exists (
        select 1 from active_records rr where not rr.tombstone and rr.public_visible and (
          rr.record->>'sourceStatus' is null or rr.record->>'sourceStatus' not in ('current','review_due')
          or rr.record->>'validationStatus' is null
          or rr.record->>'validationStatus' not in ('locally_reviewed','approved')))
        governance_valid
    from transition s left join active_release r on true cross join base b
  ), projected as (
    select b.payload || jsonb_build_object(
      'activePublicSiteRelease', case when not s.valid or r.id is null then null else jsonb_build_object(
        'version','clinical-kb-site-release-v1',
        'releaseId',r.id::text,
        'registryVersion',r.registry_version,
        'staticManifestDigest',r.static_manifest_digest,
        'dynamicStateDigest',r.dynamic_state_digest,
        'releaseDigest',r.release_digest,
        'state',r.state,
        'activatedAt',case
          when s.transition_kind = 'rollback' then tr.created_at
          when s.transition_kind = 'bootstrap' then coalesce(r.activated_at, r.created_at)
          else r.activated_at
        end
      ) end,
      'publicSiteChangeEpoch',s.change_epoch::text,
      'populationComplete',i.population_complete,
      'releaseDigestValid',i.release_digest_valid,
      'dynamicDigestValid',i.dynamic_digest_valid,
      'administratorAttestationValid',i.administrator_attestation_valid,
      'governanceValid',i.governance_valid,
      'pendingSetExact',s.valid and coalesce((b.payload->>'pendingSetExact')::boolean, false),
      'outstandingHeadCountAgrees',s.valid and coalesce((b.payload->>'outstandingHeadCountAgrees')::boolean, false),
      'timeIntegrityValid',s.valid and coalesce((b.payload->>'timeIntegrityValid')::boolean, false),
      'lastActivation',case when s.transition_kind = 'rollback' then tr.created_at else r.activated_at end,
      'rollbackAvailable',s.transition_kind = 'activation'
        and coalesce((b.payload->>'rollbackAvailable')::boolean, false)
        and not exists (select 1 from public.site_content_releases candidate where candidate.state = 'candidate')
        and not exists (select 1 from outstanding_heads)
        and not exists (select 1 from public.site_content_public_records h where h.pending_event_sequence is not null)
        and not exists (select 1 from public.site_content_sync_events e
          where e.state in ('pending','retry_pending','processing','ready'))
    ) result
    from base b cross join transition s left join active_release r on true
    left join transition_receipt tr on true cross join integrity i
  )
  select result from projected;
$$;

revoke all on function public.read_site_content_health()
  from public, anon, authenticated, service_role;
grant execute on function public.read_site_content_health() to service_role;
alter function public.read_site_content_health() owner to postgres;

-- Compare the integrity verdict before and after. Only the deterministic fields are compared:
-- the clock-derived ones (lastInvocationAt, oldestOutstandingOriginAgeMs) legitimately differ
-- between two statements in the same transaction and would make this guard fire on correct work.
do $verify$
declare
  v_fields text[] := array[
    'bootstrapIntegrityState','populationComplete','releaseDigestValid','dynamicDigestValid',
    'administratorAttestationValid','governanceValid','pendingSetExact','outstandingHeadCountAgrees',
    'rollbackAvailable','initialized','publicSiteChangeEpoch','outstandingHeadCount'
  ];
  v_before jsonb;
  v_after jsonb;
begin
  select (select jsonb_object_agg(f, e.before_payload -> f) from unnest(v_fields) f)
    into v_before from site_content_health_fold_evidence e;
  select (select jsonb_object_agg(f, p -> f) from unnest(v_fields) f)
    into v_after from (select public.read_site_content_health() p) s;

  if v_before is null or v_after is null then
    raise exception 'site_content_health_fold_evidence_missing';
  end if;
  if v_before is distinct from v_after then
    raise exception 'site_content_health_fold_changed_verdict: before=% after=%', v_before, v_after;
  end if;
end;
$verify$;

commit;
