-- Durable publication, synchronization, and release authority for public site content.
-- Source-only migration: applying it and running the worker are separate operator actions.

create table public.site_content_public_authority (
  singleton boolean primary key default true check (singleton),
  active_release_id uuid,
  change_epoch bigint not null default 0 check (change_epoch >= 0),
  updated_at timestamptz not null default now()
);

create table public.site_content_releases (
  id uuid primary key default gen_random_uuid(),
  state text not null check (state in ('candidate', 'active', 'retained', 'failed')),
  generation_id uuid not null,
  previous_release_id uuid references public.site_content_releases(id),
  registry_version text not null,
  static_manifest_digest text not null check (static_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  dynamic_state_digest text not null check (dynamic_state_digest ~ '^sha256:[0-9a-f]{64}$'),
  release_digest text not null check (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  recovery_evidence_digest text not null check (recovery_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_record_count integer not null check (expected_record_count >= 0),
  projected_record_count integer not null default 0 check (projected_record_count >= 0),
  integrity_verified boolean not null default false,
  public_visibility_verified boolean not null default false,
  governance_verified boolean not null default false,
  must_pass_verified boolean not null default false,
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

alter table public.site_content_public_authority
  add constraint site_content_public_authority_active_release_fkey
  foreign key (active_release_id) references public.site_content_releases(id);

insert into public.site_content_public_authority(singleton) values (true);

create table public.site_content_publications (
  id uuid primary key default gen_random_uuid(),
  logical_id text not null,
  domain text not null check (domain in ('registry', 'medications', 'differentials')),
  record_kind text not null,
  slug text not null,
  payload jsonb not null,
  governance jsonb not null default '{}'::jsonb,
  publication_version text not null,
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_lineage_digest text not null check (source_lineage_digest ~ '^sha256:[0-9a-f]{64}$'),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index site_content_publications_logical_id_key
  on public.site_content_publications(logical_id);
create unique index site_content_publications_domain_kind_slug_key
  on public.site_content_publications(domain, record_kind, slug);

create table public.site_content_release_projections (
  release_id uuid not null references public.site_content_releases(id) on delete cascade,
  publication_id uuid not null references public.site_content_publications(id),
  logical_id text not null,
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  embedding_model text not null,
  embedding_dimensions integer not null check (embedding_dimensions > 0),
  embedding_digest text not null check (embedding_digest ~ '^sha256:[0-9a-f]{64}$'),
  tombstoned boolean not null default false,
  primary key (release_id, logical_id)
);

create table public.site_content_sync_outbox (
  event_id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.site_content_publications(id),
  logical_id text not null,
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  generation_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'leased', 'complete', 'quarantined')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  worker_id uuid,
  lease_id uuid,
  lease_expires_at timestamptz,
  completed_release_id uuid references public.site_content_releases(id),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index site_content_sync_outbox_pending_identity_key
  on public.site_content_sync_outbox(logical_id, content_hash)
  where status in ('pending', 'leased');
create index site_content_sync_outbox_claim_idx
  on public.site_content_sync_outbox(status, available_at, created_at);

create table public.site_content_release_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_kind text not null check (receipt_kind in ('activation', 'rollback')),
  release_id uuid not null references public.site_content_releases(id),
  previous_release_id uuid references public.site_content_releases(id),
  release_digest text not null check (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  recovery_evidence_digest text not null check (recovery_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  restoration_method text check (restoration_method is null or restoration_method = 'retained-pointer'),
  created_at timestamptz not null default now()
);

create or replace function public.prevent_site_content_receipt_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Site-content release receipts are append-only';
end;
$$;

create trigger site_content_release_receipts_append_only
before update or delete on public.site_content_release_receipts
for each row execute function public.prevent_site_content_receipt_mutation();

create or replace function public.publish_site_content_record(
  p_record jsonb,
  p_actor_id uuid,
  p_administrator_authorized boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_publication_id uuid;
  v_generation_id uuid := gen_random_uuid();
  v_logical_id text := btrim(coalesce(p_record->>'logicalId', ''));
begin
  if p_administrator_authorized is distinct from true then
    raise exception 'Site-content publication requires administrator authority';
  end if;
  if p_actor_id is null or v_logical_id = ''
     or coalesce(p_record->>'domain', '') not in ('registry', 'medications', 'differentials')
     or btrim(coalesce(p_record->>'kind', '')) = ''
     or btrim(coalesce(p_record->>'slug', '')) = ''
     or coalesce(p_record->>'contentHash', '') !~ '^sha256:[0-9a-f]{64}$'
     or coalesce(p_record->>'sourceLineageDigest', '') !~ '^sha256:[0-9a-f]{64}$'
     or jsonb_typeof(p_record->'payload') is distinct from 'object'
  then raise exception 'Invalid public site-content record'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content:' || v_logical_id, 0));
  insert into public.site_content_publications(
    logical_id, domain, record_kind, slug, payload, governance, publication_version,
    content_hash, source_lineage_digest, actor_id
  ) values (
    v_logical_id, p_record->>'domain', p_record->>'kind', p_record->>'slug', p_record->'payload',
    coalesce(p_record->'governance', '{}'::jsonb), p_record->>'publicationVersion',
    p_record->>'contentHash', p_record->>'sourceLineageDigest', p_actor_id
  ) on conflict (logical_id) do update set
    domain = excluded.domain, record_kind = excluded.record_kind, slug = excluded.slug,
    payload = excluded.payload, governance = excluded.governance,
    publication_version = excluded.publication_version, content_hash = excluded.content_hash,
    source_lineage_digest = excluded.source_lineage_digest, actor_id = excluded.actor_id,
    updated_at = now()
  returning id into v_publication_id;

  update public.site_content_public_authority
     set change_epoch = change_epoch + 1, updated_at = now()
   where singleton;
  insert into public.site_content_sync_outbox(publication_id, logical_id, content_hash, generation_id)
    values (v_publication_id, v_logical_id, p_record->>'contentHash', v_generation_id)
    on conflict do nothing;
  delete from public.rag_response_cache where owner_id is null;
  return jsonb_build_object('publicationId', v_publication_id, 'generationId', v_generation_id);
end;
$$;

create or replace function public.read_public_site_content_records(
  p_domain text,
  p_record_kind text default null,
  p_slug text default null
) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'changeEpoch', authority.change_epoch,
    'activeReleaseId', authority.active_release_id,
    'state', case when exists (
      select 1 from public.site_content_sync_outbox pending where pending.status in ('pending', 'leased')
    ) then 'updating' else 'current' end,
    'records', coalesce(jsonb_agg(to_jsonb(publication) - 'actor_id' order by publication.logical_id)
      filter (where publication.id is not null), '[]'::jsonb)
  )
  from public.site_content_public_authority authority
  left join public.site_content_publications publication
    on publication.domain = p_domain
   and (p_record_kind is null or publication.record_kind = p_record_kind)
   and (p_slug is null or publication.slug = p_slug)
   and not exists (
     select 1 from public.site_content_sync_outbox pending
      where pending.logical_id = publication.logical_id
        and pending.status in ('pending', 'leased')
   )
  where authority.singleton
  group by authority.change_epoch, authority.active_release_id;
$$;

create or replace function public.claim_site_content_sync_events(
  p_worker_id uuid, p_limit integer, p_lease_seconds integer
) returns setof public.site_content_sync_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if p_worker_id is null or p_limit not between 1 and 100 or p_lease_seconds not between 5 and 900
  then raise exception 'Invalid site-content worker claim'; end if;
  return query
  with claimable as (
    select event_id from public.site_content_sync_outbox
     where status in ('pending', 'leased')
       and available_at <= now()
       and (status = 'pending' or lease_expires_at <= now())
     order by created_at
     for update skip locked limit p_limit
  )
  update public.site_content_sync_outbox event set
    status = 'leased', worker_id = p_worker_id, lease_id = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = event.attempt_count + 1
  from claimable where event.event_id = claimable.event_id returning event.*;
end;
$$;

create or replace function public.heartbeat_site_content_sync_event(
  p_event_id uuid, p_worker_id uuid, p_lease_id uuid, p_generation_id uuid, p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_updated integer;
begin
  update public.site_content_sync_outbox set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where event_id = p_event_id and worker_id = p_worker_id and lease_id = p_lease_id
     and generation_id = p_generation_id and status = 'leased' and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', v_updated = 1);
end;
$$;

create or replace function public.complete_site_content_sync_event(
  p_event_id uuid, p_worker_id uuid, p_lease_id uuid, p_generation_id uuid,
  p_release_id uuid, p_expected_content_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_updated integer;
begin
  update public.site_content_sync_outbox set status = 'complete', completed_release_id = p_release_id,
    completed_at = now(), worker_id = null, lease_id = null, lease_expires_at = null
   where event_id = p_event_id and worker_id = p_worker_id and lease_id = p_lease_id
     and generation_id = p_generation_id and content_hash = p_expected_content_hash
     and status = 'leased' and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', v_updated = 1);
end;
$$;

create or replace function public.fail_site_content_sync_event(
  p_event_id uuid, p_worker_id uuid, p_lease_id uuid, p_generation_id uuid,
  p_error_code text, p_quarantine boolean, p_retry_after_seconds integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_updated integer;
begin
  update public.site_content_sync_outbox set status = case when p_quarantine then 'quarantined' else 'pending' end,
    error_code = left(coalesce(p_error_code, 'sync_failed'), 80),
    available_at = case when p_quarantine then available_at else now() + make_interval(secs => p_retry_after_seconds) end,
    worker_id = null, lease_id = null, lease_expires_at = null
   where event_id = p_event_id and worker_id = p_worker_id and lease_id = p_lease_id
     and generation_id = p_generation_id and status = 'leased';
  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', v_updated = 1);
end;
$$;

create or replace function public.activate_site_content_release(
  p_release_id uuid, p_expected_release_digest text, p_recovery_digest text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_release public.site_content_releases%rowtype; v_previous uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content_release', 0));
  select * into strict v_release from public.site_content_releases where id = p_release_id for update;
  if v_release.state <> 'candidate' or v_release.release_digest <> p_expected_release_digest
     or v_release.recovery_evidence_digest <> p_recovery_digest
     or v_release.projected_record_count <> v_release.expected_record_count
     or not v_release.integrity_verified or not v_release.public_visibility_verified
     or not v_release.governance_verified or not v_release.must_pass_verified
     or exists (select 1 from public.site_content_sync_outbox where status in ('pending', 'leased'))
  then raise exception 'Site-content candidate is not eligible for activation'; end if;
  select active_release_id into v_previous from public.site_content_public_authority where singleton for update;
  update public.site_content_releases set state = 'retained' where id = v_previous;
  update public.site_content_releases set state = 'active', previous_release_id = v_previous, activated_at = now()
   where id = p_release_id;
  update public.site_content_public_authority set active_release_id = p_release_id,
    change_epoch = change_epoch + 1, updated_at = now() where singleton;
  insert into public.site_content_release_receipts(receipt_kind, release_id, previous_release_id, release_digest, recovery_evidence_digest)
    values ('activation', p_release_id, v_previous, v_release.release_digest, v_release.recovery_evidence_digest);
  return jsonb_build_object('activeReleaseId', p_release_id, 'previousReleaseId', v_previous);
end;
$$;

create or replace function public.rollback_site_content_release(
  p_failed_release_id uuid, p_retained_release_id uuid, p_recovery_digest text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_retained public.site_content_releases%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content_release', 0));
  select * into strict v_retained from public.site_content_releases
   where id = p_retained_release_id and state = 'retained' for update;
  if p_recovery_digest !~ '^sha256:[0-9a-f]{64}$' then raise exception 'Invalid rollback evidence'; end if;
  update public.site_content_releases set state = 'failed' where id = p_failed_release_id and state = 'active';
  update public.site_content_releases set state = 'active' where id = p_retained_release_id;
  update public.site_content_public_authority set active_release_id = p_retained_release_id,
    change_epoch = change_epoch + 1, updated_at = now()
   where singleton and active_release_id = p_failed_release_id;
  if not found then raise exception 'Rollback authority changed'; end if;
  insert into public.site_content_release_receipts(
    receipt_kind, release_id, previous_release_id, release_digest, recovery_evidence_digest, restoration_method
  ) values ('rollback', p_retained_release_id, p_failed_release_id,
    v_retained.release_digest, p_recovery_digest, 'retained-pointer');
  return jsonb_build_object('activeReleaseId', p_retained_release_id, 'restorationMethod', 'retained-pointer');
end;
$$;

alter table public.site_content_public_authority enable row level security;
alter table public.site_content_releases enable row level security;
alter table public.site_content_publications enable row level security;
alter table public.site_content_release_projections enable row level security;
alter table public.site_content_sync_outbox enable row level security;
alter table public.site_content_release_receipts enable row level security;

revoke all on public.site_content_public_authority, public.site_content_releases,
  public.site_content_publications, public.site_content_release_projections,
  public.site_content_sync_outbox, public.site_content_release_receipts from public, anon, authenticated;
grant all on public.site_content_public_authority, public.site_content_releases,
  public.site_content_publications, public.site_content_release_projections,
  public.site_content_sync_outbox, public.site_content_release_receipts to service_role;

revoke all on function public.publish_site_content_record(jsonb, uuid, boolean) from public, anon, authenticated;
revoke all on function public.read_public_site_content_records(text, text, text) from public, anon, authenticated;
revoke all on function public.claim_site_content_sync_events(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_site_content_sync_event(uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_site_content_sync_event(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fail_site_content_sync_event(uuid, uuid, uuid, uuid, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.activate_site_content_release(uuid, text, text) from public, anon, authenticated;
revoke all on function public.rollback_site_content_release(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.prevent_site_content_receipt_mutation() from public, anon, authenticated;

grant execute on function public.publish_site_content_record(jsonb, uuid, boolean) to service_role;
grant execute on function public.read_public_site_content_records(text, text, text) to service_role;
grant execute on function public.claim_site_content_sync_events(uuid, integer, integer) to service_role;
grant execute on function public.heartbeat_site_content_sync_event(uuid, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.complete_site_content_sync_event(uuid, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.fail_site_content_sync_event(uuid, uuid, uuid, uuid, text, boolean, integer) to service_role;
grant execute on function public.activate_site_content_release(uuid, text, text) to service_role;
grant execute on function public.rollback_site_content_release(uuid, uuid, text) to service_role;
