-- Durable active-release-isolated public site content. Source-only: no live action.
create table public.site_content_releases (
  id uuid primary key default gen_random_uuid(), project_ref text not null,
  state text not null check (state in ('candidate','active','retained','failed')),
  generation_id uuid not null, previous_release_id uuid references public.site_content_releases(id),
  registry_version text not null, plan_digest text not null check (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  plan_json jsonb,
  static_manifest_digest text not null check (static_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  dynamic_state_digest text not null check (dynamic_state_digest ~ '^sha256:[0-9a-f]{64}$'),
  release_digest text not null check (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  recovery_evidence jsonb not null,
  recovery_evidence_digest text not null check (recovery_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  verification_evidence jsonb,
  legacy_reconciliation_digest text not null check (legacy_reconciliation_digest ~ '^sha256:[0-9a-f]{64}$'),
  legacy_dispositions jsonb not null default '[]'::jsonb,
  expected_record_count integer not null check (expected_record_count >= 0),
  expected_changed_count integer not null check (expected_changed_count >= 0),
  expected_unchanged_count integer not null check (expected_unchanged_count >= 0),
  expected_tombstone_count integer not null check (expected_tombstone_count >= 0),
  projected_record_count integer not null default 0 check (projected_record_count >= 0),
  integrity_verified boolean not null default false, public_visibility_verified boolean not null default false,
  governance_verified boolean not null default false, must_pass_verified boolean not null default false,
  activation_receipt jsonb, rollback_receipt jsonb,
  created_at timestamptz not null default now(), activated_at timestamptz
);
create table public.site_content_public_authority (
  singleton boolean primary key default true check (singleton),
  active_release_id uuid references public.site_content_releases(id),
  change_epoch bigint not null default 0 check (change_epoch >= 0), updated_at timestamptz not null default now()
);
insert into public.site_content_public_authority(singleton) values (true);
create table public.site_content_publications (
  id uuid primary key default gen_random_uuid(), logical_id text not null,
  domain text not null check (domain in ('services', 'forms', 'medications', 'differentials')),
  record_kind text not null, slug text not null, payload jsonb not null, governance jsonb not null,
  publication_version text not null, content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_lineage_digest text not null check (source_lineage_digest ~ '^sha256:[0-9a-f]{64}$'),
  actor_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index site_content_publications_logical_id_key on public.site_content_publications(logical_id);
create unique index site_content_publications_domain_kind_slug_key on public.site_content_publications(domain,record_kind,slug);
create table public.site_content_release_projections (
  release_id uuid not null references public.site_content_releases(id) on delete cascade,
  publication_id uuid references public.site_content_publications(id), logical_id text not null,
  domain text not null check (domain in ('services', 'forms', 'medications', 'differentials')),
  record_kind text not null, slug text not null, payload jsonb not null, governance jsonb not null,
  publication_version text not null, content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_lineage_digest text not null check (source_lineage_digest ~ '^sha256:[0-9a-f]{64}$'),
  embedding jsonb,
  embedding_model text, embedding_dimensions integer check (embedding_dimensions is null or embedding_dimensions > 0),
  embedding_digest text check (embedding_digest is null or embedding_digest ~ '^sha256:[0-9a-f]{64}$'),
  embedding_bytes_digest text check (embedding_bytes_digest is null or embedding_bytes_digest ~ '^sha256:[0-9a-f]{64}$'),
  tombstoned boolean not null default false, primary key (release_id,logical_id)
);
create table public.site_content_sync_outbox (
  event_id uuid primary key default gen_random_uuid(), publication_id uuid not null references public.site_content_publications(id),
  candidate_release_id uuid not null references public.site_content_releases(id), project_ref text not null,
  logical_id text not null, content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  plan_digest text not null check (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  release_digest text not null check (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  static_manifest_digest text not null check (static_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  dynamic_state_digest text not null check (dynamic_state_digest ~ '^sha256:[0-9a-f]{64}$'),
  recovery_evidence_digest text not null check (recovery_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  generation_id uuid not null, operation text not null default 'changed' check (operation in ('changed','unchanged','tombstone')),
  status text not null default 'pending' check (status in ('pending','leased','complete','quarantined')),
  attempt_count integer not null default 0 check (attempt_count >= 0), available_at timestamptz not null default now(),
  worker_id uuid, lease_id uuid, lease_expires_at timestamptz,
  completed_release_id uuid references public.site_content_releases(id), error_code text,
  created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index site_content_sync_outbox_pending_identity_key on public.site_content_sync_outbox(candidate_release_id,logical_id)
  where status in ('pending','leased','quarantined');
create index site_content_sync_outbox_claim_idx on public.site_content_sync_outbox(status,available_at,created_at);

create table public.site_content_release_operations (
  release_id uuid not null references public.site_content_releases(id) on delete cascade,
  logical_id text not null,
  operation text not null check (operation in ('changed','unchanged','tombstone')),
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','complete','quarantined')),
  completed_at timestamptz,
  primary key(release_id,logical_id)
);

create table public.site_content_validation_binding_consumptions (
  binding_id uuid primary key,
  purpose text not null check (purpose in ('adopt','begin','verify','activate','rollback')),
  project_ref text not null,
  payload_digest text not null check (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now()
);

create table public.site_content_release_gate_artifacts (
  release_id uuid not null,
  owner text not null check (owner in ('public-site-content-reader-v1','site-content-governance-registry-v1','rag-programme-eval-v1')),
  subject jsonb not null,
  subject_digest text not null check (subject_digest ~ '^sha256:[0-9a-f]{64}$'),
  artifact jsonb not null,
  artifact_digest text not null check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key(release_id,owner)
);

-- Same key-sorted, whitespace-free JSON serialization used by the accepted P05
-- activation/rollback receipt authority in recovery-readiness-evidence.ts.
create or replace function public.site_content_canonical_json(p_value jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select case pg_catalog.jsonb_typeof(p_value)
    when 'object' then (select '{'||coalesce(pg_catalog.string_agg(pg_catalog.to_json(key)::text||':'||
      public.site_content_canonical_json(value),',' order by key),'')||'}' from pg_catalog.jsonb_each(p_value))
    when 'array' then (select '['||coalesce(pg_catalog.string_agg(public.site_content_canonical_json(value),','
      order by ordinal),'')||']' from pg_catalog.jsonb_array_elements(p_value) with ordinality as element(value,ordinal))
    else p_value::text end
$$;
create or replace function public.site_content_p05_digest(p_value jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    public.site_content_canonical_json(p_value-'digest'),'UTF8'),'sha256'),'hex')
$$;
create or replace function public.site_content_json_digest(p_value jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    public.site_content_canonical_json(p_value),'UTF8'),'sha256'),'hex')
$$;
create or replace function public.site_content_validation_binding_valid(p_binding jsonb,p_purpose text,p_project_ref text,
 p_recovery_evidence_digest text,p_payload jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_secret text; v_without_mac jsonb;
begin
 select secret.decrypted_secret into v_secret from vault.decrypted_secrets secret
  where secret.name='site_content_recovery_validation_secret' limit 1;
 if coalesce(v_secret,'')='' or p_binding->>'version'<>'site-content-recovery-validation-v1'
  or p_binding->>'purpose' is distinct from p_purpose or p_binding->>'projectRef' is distinct from p_project_ref
  or p_binding->>'recoveryEvidenceDigest' is distinct from p_recovery_evidence_digest
  or p_binding->>'payloadDigest' is distinct from public.site_content_json_digest(p_payload)
  or (p_binding->>'validatedAt')::timestamptz<now()-interval '5 minutes'
  or (p_binding->>'validatedAt')::timestamptz>now()+interval '5 minutes'
 then return false; end if;
 v_without_mac:=p_binding-'mac';
 return p_binding->>'mac'=pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(
  public.site_content_canonical_json(v_without_mac),'UTF8'),pg_catalog.convert_to(v_secret,'UTF8'),'sha256'),'hex');
exception when others then return false;
end $$;

create or replace function public.site_content_consume_validation_binding(p_binding jsonb,p_purpose text,
 p_project_ref text,p_recovery_evidence_digest text,p_payload jsonb) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer; v_binding_id uuid;
begin
 if not public.site_content_validation_binding_valid(p_binding,p_purpose,p_project_ref,
   p_recovery_evidence_digest,p_payload) then return false; end if;
 begin v_binding_id:=(p_binding->>'bindingId')::uuid;
 exception when invalid_text_representation then return false; end;
 insert into public.site_content_validation_binding_consumptions(binding_id,purpose,project_ref,payload_digest,expires_at)
 values(v_binding_id,p_purpose,p_project_ref,p_binding->>'payloadDigest',
   (p_binding->>'validatedAt')::timestamptz+interval '5 minutes')
 on conflict(binding_id) do nothing;
 get diagnostics v_count=row_count;
 return v_count=1;
exception when others then return false;
end $$;

create or replace function public.site_content_gate_owner_receipt_valid(p_receipt jsonb,p_owner text,
 p_secret_name text,p_subject jsonb,p_verification_now timestamptz) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_secret text; v_observed_at timestamptz; v_without_mac jsonb;
begin
 select secret.decrypted_secret into v_secret from vault.decrypted_secrets secret
  where secret.name=p_secret_name limit 1;
 begin v_observed_at:=(p_receipt->>'observedAt')::timestamptz;
 exception when others then return false; end;
 if coalesce(v_secret,'')='' or p_receipt->>'owner' is distinct from p_owner
  or p_receipt->'subject' is distinct from p_subject
  or p_receipt->>'subjectDigest' is distinct from public.site_content_json_digest(p_subject)
  or coalesce(p_receipt->>'observedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  or p_receipt->>'observedAt' is distinct from pg_catalog.to_char(v_observed_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  or v_observed_at<p_verification_now-interval '5 minutes' or v_observed_at>p_verification_now
  or coalesce(p_receipt->>'mac','') !~ '^[0-9a-f]{64}$'
 then return false; end if;
 v_without_mac:=p_receipt-'mac';
 return p_receipt->>'mac'=pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(
  public.site_content_canonical_json(v_without_mac),'UTF8'),pg_catalog.convert_to(v_secret,'UTF8'),'sha256'),'hex');
exception when others then return false;
end $$;

create or replace function public.derive_site_content_release_gate_artifacts(p_release_id uuid,
 p_governance_receipt jsonb,p_must_pass_receipt jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_release public.site_content_releases%rowtype; v_subject jsonb; v_subject_digest text;
 v_population jsonb; v_expected_population jsonb; v_public jsonb; v_governance jsonb; v_must_pass jsonb;
 v_existing_count integer; v_stored_public jsonb; v_stored_governance jsonb; v_stored_must_pass jsonb;
 v_verification_now timestamptz; v_verification_now_text text; v_public_observed_at timestamptz;
 v_public_observed_at_text text; v_governance_observed_at timestamptz;
 v_must_pass_observed_at timestamptz; v_recovery_verified_at timestamptz;
begin
 if not public.site_content_admin_authorized() or auth.uid() is null then raise exception 'administrator required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content_release_gate',0));
 select * into strict v_release from public.site_content_releases where id=p_release_id for update;
 select count(*),max(artifact) filter(where owner='public-site-content-reader-v1'),
   max(artifact) filter(where owner='site-content-governance-registry-v1'),
   max(artifact) filter(where owner='rag-programme-eval-v1')
 into v_existing_count,v_stored_public,v_stored_governance,v_stored_must_pass
 from public.site_content_release_gate_artifacts where release_id=p_release_id;
 if v_existing_count not in (0,3) then raise exception 'partial immutable gate artifact set'; end if;
 v_verification_now:=pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
 if v_existing_count=3 then
  begin v_public_observed_at:=(v_stored_public->>'observedAt')::timestamptz;
  exception when others then raise exception 'existing immutable gate derivation clock invalid'; end;
  if coalesce(v_stored_public->>'observedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   or v_stored_public->>'observedAt' is distinct from pg_catalog.to_char(v_public_observed_at at time zone 'UTC',
     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then raise exception 'existing immutable gate derivation clock invalid'; end if;
  v_verification_now:=v_public_observed_at;
 else v_public_observed_at:=v_verification_now; end if;
 v_verification_now_text:=pg_catalog.to_char(v_verification_now at time zone 'UTC',
   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 v_public_observed_at_text:=pg_catalog.to_char(v_public_observed_at at time zone 'UTC',
   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 v_subject:=pg_catalog.jsonb_build_object('projectRef',v_release.project_ref,'releaseId',v_release.id,
  'planDigest',v_release.plan_digest,'releaseDigest',v_release.release_digest);
 v_subject_digest:=public.site_content_json_digest(v_subject);
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('logicalId',projection.logical_id,
   'contentHash',projection.content_hash) order by projection.logical_id),'[]'::jsonb) into v_population
 from public.site_content_release_projections projection where projection.release_id=p_release_id
  and not projection.tombstoned;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('logicalId',operation->>'logicalId',
   'contentHash',operation->>'contentHash') order by operation->>'logicalId'),'[]'::jsonb) into v_expected_population
 from pg_catalog.jsonb_array_elements(v_release.plan_json->'operations') operation
 where operation->>'operation'<>'tombstone';
 if v_population is distinct from v_expected_population
  or exists(select 1 from public.site_content_release_operations where release_id=p_release_id and status<>'complete')
  or not public.site_content_gate_owner_receipt_valid(p_governance_receipt,'site-content-governance-registry-v1',
    'site_content_governance_gate_owner_secret',v_subject,v_verification_now)
  or not public.site_content_gate_owner_receipt_valid(p_must_pass_receipt,'rag-programme-eval-v1',
    'rag_programme_gate_owner_secret',v_subject,v_verification_now)
  or p_governance_receipt->>'version' is distinct from 'site-content-governance-owner-receipt-v1'
  or p_governance_receipt->'population' is distinct from v_population
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
  v_governance_observed_at:=(p_governance_receipt->>'observedAt')::timestamptz;
  v_must_pass_observed_at:=(p_must_pass_receipt->>'observedAt')::timestamptz;
  v_recovery_verified_at:=(v_release.recovery_evidence->>'verifiedAt')::timestamptz;
 exception when others then raise exception 'gate-owner chronology invalid'; end;
 if v_governance_observed_at is null or v_must_pass_observed_at is null or v_recovery_verified_at is null
  or v_governance_observed_at<v_recovery_verified_at
  or v_must_pass_observed_at<v_governance_observed_at
  or v_must_pass_observed_at>v_public_observed_at
 then raise exception 'gate-owner chronology invalid'; end if;
 v_public:=pg_catalog.jsonb_build_object('owner','public-site-content-reader-v1','subjectDigest',v_subject_digest,
  'observedAt',v_public_observed_at_text,'population',v_population,
  'populationDigest',public.site_content_json_digest(v_population));
 v_public:=v_public||pg_catalog.jsonb_build_object('digest',public.site_content_json_digest(v_public));
 v_governance:=(p_governance_receipt-'mac'-'version'-'subject')||
  pg_catalog.jsonb_build_object('digest',public.site_content_json_digest(p_governance_receipt-'mac'-'version'-'subject'));
 v_must_pass:=pg_catalog.jsonb_build_object('owner','rag-programme-eval-v1','subjectDigest',v_subject_digest,
  'observedAt',p_must_pass_receipt->>'observedAt','caseSetFingerprint',p_must_pass_receipt->>'caseSetFingerprint',
  'evaluatedCaseIds',p_must_pass_receipt->'evaluatedCaseIds','failedCaseIds','[]'::jsonb,
  'runDigest',p_must_pass_receipt->>'candidateRunDigest','populationFingerprint',
  p_must_pass_receipt->>'populationFingerprint','baselineRunDigest',p_must_pass_receipt->>'baselineRunDigest',
  'gatePolicyDigest',p_must_pass_receipt->>'gatePolicyDigest','gateDecisionDigest',
 p_must_pass_receipt->>'gateDecisionDigest');
 v_must_pass:=v_must_pass||pg_catalog.jsonb_build_object('digest',public.site_content_json_digest(v_must_pass));
 if v_existing_count=3 then
  if v_stored_public is distinct from v_public or v_stored_governance is distinct from v_governance
   or v_stored_must_pass is distinct from v_must_pass
   or exists(select 1 from public.site_content_release_gate_artifacts artifact
     where artifact.release_id=p_release_id and (artifact.subject is distinct from v_subject
       or artifact.subject_digest is distinct from v_subject_digest
       or artifact.artifact_digest is distinct from artifact.artifact->>'digest'
       or artifact.observed_at is distinct from (artifact.artifact->>'observedAt')::timestamptz))
  then raise exception 'existing immutable gate artifact set invalid'; end if;
  return pg_catalog.jsonb_build_object('releaseId',p_release_id,'verificationNow',v_verification_now_text,
    'derived',false);
 end if;
 insert into public.site_content_release_gate_artifacts(release_id,owner,subject,subject_digest,artifact,
  artifact_digest,observed_at) values
  (p_release_id,'public-site-content-reader-v1',v_subject,v_subject_digest,v_public,v_public->>'digest',(v_public->>'observedAt')::timestamptz),
  (p_release_id,'site-content-governance-registry-v1',v_subject,v_subject_digest,v_governance,v_governance->>'digest',(v_governance->>'observedAt')::timestamptz),
  (p_release_id,'rag-programme-eval-v1',v_subject,v_subject_digest,v_must_pass,v_must_pass->>'digest',(v_must_pass->>'observedAt')::timestamptz);
 return pg_catalog.jsonb_build_object('releaseId',p_release_id,'verificationNow',v_verification_now_text,
   'derived',true);
end $$;

create or replace function public.read_site_content_release_gate_artifacts(p_release_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_subject jsonb; v_subject_digest text; v_count integer; v_result jsonb;
begin
 if not public.site_content_admin_authorized() or auth.uid() is null then raise exception 'administrator required'; end if;
 select count(*),min(subject::text)::jsonb,min(subject_digest) into v_count,v_subject,v_subject_digest
  from public.site_content_release_gate_artifacts where release_id=p_release_id;
 if v_count<>3 or exists(select 1 from public.site_content_release_gate_artifacts
   where release_id=p_release_id and (subject is distinct from v_subject or subject_digest is distinct from v_subject_digest))
 then raise exception 'complete immutable release gate artifacts are unavailable'; end if;
 select pg_catalog.jsonb_build_object('version','site-content-release-gate-artifacts-v1','subject',v_subject,
   'subjectDigest',v_subject_digest,
   'publicVisibility',max(artifact) filter(where owner='public-site-content-reader-v1'),
   'governance',max(artifact) filter(where owner='site-content-governance-registry-v1'),
   'mustPass',max(artifact) filter(where owner='rag-programme-eval-v1')) into v_result
 from public.site_content_release_gate_artifacts where release_id=p_release_id;
 return v_result;
end $$;

create or replace function public.provision_site_content_validation_secret(p_configuration jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid; v_current text; v_current_digest text; v_new_digest text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
 if coalesce(p_configuration->>'secret','')='' or pg_catalog.length(p_configuration->>'secret')<32
 then raise exception 'site-content validation secret is invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content_authority_secrets',0));
 select secret.id,secret.decrypted_secret into v_secret_id,v_current from vault.decrypted_secrets secret
  where secret.name='site_content_recovery_validation_secret' limit 1;
 v_new_digest:='sha256:'||pg_catalog.encode(extensions.digest(
  pg_catalog.convert_to(p_configuration->>'secret','UTF8'),'sha256'),'hex');
 if exists(select 1 from vault.decrypted_secrets secret where secret.name in
   ('site_content_governance_gate_owner_secret','rag_programme_gate_owner_secret')
   and 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
     secret.decrypted_secret,'UTF8'),'sha256'),'hex')=v_new_digest)
 then raise exception 'cross-purpose site-content authority secrets must be distinct'; end if;
 if v_secret_id is null then
  if nullif(p_configuration->>'expectedCurrentDigest','') is not null
  then raise exception 'initial secret provisioning cannot claim a predecessor'; end if;
  perform vault.create_secret(p_configuration->>'secret','site_content_recovery_validation_secret',
    'Site-content recovery validation HMAC; provisioned by guarded operator route');
  return pg_catalog.jsonb_build_object('configured',true,'rotated',false,'digest',v_new_digest);
 end if;
 v_current_digest:='sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_current,'UTF8'),'sha256'),'hex');
 if p_configuration->>'expectedCurrentDigest' is distinct from v_current_digest
  or coalesce(pg_catalog.btrim(p_configuration->>'rotationReason'),'')=''
 then raise exception 'secret rotation requires exact predecessor digest and reason'; end if;
 if v_new_digest=v_current_digest then raise exception 'secret rotation must change the secret digest'; end if;
 perform vault.update_secret(v_secret_id,p_configuration->>'secret','site_content_recovery_validation_secret',
  'Rotated site-content validation HMAC: '||pg_catalog.left(p_configuration->>'rotationReason',200));
 return pg_catalog.jsonb_build_object('configured',true,'rotated',true,'digest',v_new_digest,
  'previousDigest',v_current_digest);
end $$;

create or replace function public.provision_site_content_governance_gate_owner_secret(p_configuration jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid; v_current text; v_current_digest text; v_new_digest text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
 if coalesce(p_configuration->>'secret','')='' or pg_catalog.length(p_configuration->>'secret')<32
 then raise exception 'site-content governance owner secret is invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content_authority_secrets',0));
 select secret.id,secret.decrypted_secret into v_secret_id,v_current from vault.decrypted_secrets secret
  where secret.name='site_content_governance_gate_owner_secret' limit 1;
 v_new_digest:='sha256:'||pg_catalog.encode(extensions.digest(
  pg_catalog.convert_to(p_configuration->>'secret','UTF8'),'sha256'),'hex');
 if exists(select 1 from vault.decrypted_secrets secret where secret.name in
   ('site_content_recovery_validation_secret','rag_programme_gate_owner_secret')
   and 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
     secret.decrypted_secret,'UTF8'),'sha256'),'hex')=v_new_digest)
 then raise exception 'cross-purpose site-content authority secrets must be distinct'; end if;
 if v_secret_id is null then
  if nullif(p_configuration->>'expectedCurrentDigest','') is not null
  then raise exception 'initial secret provisioning cannot claim a predecessor'; end if;
  perform vault.create_secret(p_configuration->>'secret','site_content_governance_gate_owner_secret',
    'Fixed site-content governance gate-owner HMAC; provisioned by guarded operator route');
  return pg_catalog.jsonb_build_object('configured',true,'rotated',false,'digest',v_new_digest);
 end if;
 v_current_digest:='sha256:'||pg_catalog.encode(extensions.digest(
  pg_catalog.convert_to(v_current,'UTF8'),'sha256'),'hex');
 if p_configuration->>'expectedCurrentDigest' is distinct from v_current_digest
  or coalesce(pg_catalog.btrim(p_configuration->>'rotationReason'),'')=''
 then raise exception 'secret rotation requires exact predecessor digest and reason'; end if;
 if v_new_digest=v_current_digest then raise exception 'secret rotation must change the secret digest'; end if;
 perform vault.update_secret(v_secret_id,p_configuration->>'secret','site_content_governance_gate_owner_secret',
  'Rotated fixed governance gate-owner HMAC: '||pg_catalog.left(p_configuration->>'rotationReason',200));
 return pg_catalog.jsonb_build_object('configured',true,'rotated',true,'digest',v_new_digest,
  'previousDigest',v_current_digest);
end $$;

create or replace function public.provision_rag_programme_gate_owner_secret(p_configuration jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid; v_current text; v_current_digest text; v_new_digest text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
 if coalesce(p_configuration->>'secret','')='' or pg_catalog.length(p_configuration->>'secret')<32
 then raise exception 'RAG programme gate owner secret is invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content_authority_secrets',0));
 select secret.id,secret.decrypted_secret into v_secret_id,v_current from vault.decrypted_secrets secret
  where secret.name='rag_programme_gate_owner_secret' limit 1;
 v_new_digest:='sha256:'||pg_catalog.encode(extensions.digest(
  pg_catalog.convert_to(p_configuration->>'secret','UTF8'),'sha256'),'hex');
 if exists(select 1 from vault.decrypted_secrets secret where secret.name in
   ('site_content_recovery_validation_secret','site_content_governance_gate_owner_secret')
   and 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
     secret.decrypted_secret,'UTF8'),'sha256'),'hex')=v_new_digest)
 then raise exception 'cross-purpose site-content authority secrets must be distinct'; end if;
 if v_secret_id is null then
  if nullif(p_configuration->>'expectedCurrentDigest','') is not null
  then raise exception 'initial secret provisioning cannot claim a predecessor'; end if;
  perform vault.create_secret(p_configuration->>'secret','rag_programme_gate_owner_secret',
    'Fixed RAG programme gate-owner HMAC; provisioned by guarded operator route');
  return pg_catalog.jsonb_build_object('configured',true,'rotated',false,'digest',v_new_digest);
 end if;
 v_current_digest:='sha256:'||pg_catalog.encode(extensions.digest(
  pg_catalog.convert_to(v_current,'UTF8'),'sha256'),'hex');
 if p_configuration->>'expectedCurrentDigest' is distinct from v_current_digest
  or coalesce(pg_catalog.btrim(p_configuration->>'rotationReason'),'')=''
 then raise exception 'secret rotation requires exact predecessor digest and reason'; end if;
 if v_new_digest=v_current_digest then raise exception 'secret rotation must change the secret digest'; end if;
 perform vault.update_secret(v_secret_id,p_configuration->>'secret','rag_programme_gate_owner_secret',
  'Rotated fixed RAG programme gate-owner HMAC: '||pg_catalog.left(p_configuration->>'rotationReason',200));
 return pg_catalog.jsonb_build_object('configured',true,'rotated',true,'digest',v_new_digest,
  'previousDigest',v_current_digest);
end $$;

create or replace function public.site_content_admin_authorized() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt()->'app_metadata'->>'administrator')::boolean,false)
      or coalesce((auth.jwt()->'app_metadata'->>'is_administrator')::boolean,false)
$$;
create or replace function public.adopt_site_content_baseline(p_adoption jsonb,p_validation_binding jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_release_id uuid; v_count integer; v_plan jsonb:=p_adoption->'plan';
 v_verification jsonb; v_governance_receipt jsonb:=p_adoption->'governanceReceipt';
 v_must_pass_receipt jsonb:=p_adoption->'mustPassReceipt';
begin
 if not public.site_content_admin_authorized() or v_actor is null then raise exception 'administrator required'; end if;
 begin v_release_id:=(v_plan->>'candidateReleaseId')::uuid;
 exception when invalid_text_representation then raise exception 'invalid adoption release identity'; end;
 if not public.site_content_consume_validation_binding(p_validation_binding,'adopt',v_plan->>'projectRef',
    v_plan->>'recoveryEvidenceDigest',p_adoption)
  or v_plan->>'mode' is distinct from 'write'
  or v_plan->>'planDigest' is distinct from public.site_content_json_digest(v_plan-'planDigest')
  or v_plan->>'releaseDigest' is distinct from public.site_content_json_digest(pg_catalog.jsonb_build_object(
      'projectRef',v_plan->'projectRef','candidateReleaseId',v_plan->'candidateReleaseId',
      'previousReleaseId',v_plan->'previousReleaseId','generationId',v_plan->'generationId',
      'registryVersion',v_plan->'registryVersion','staticManifestDigest',v_plan->'staticManifestDigest',
      'embeddingContract',v_plan->'embeddingContract','dynamicStateDigest',v_plan->'dynamicStateDigest',
      'operations',v_plan->'operations','legacyReconciliationDigest',v_plan->'legacyReconciliationDigest',
      'legacyDispositions',v_plan->'legacyDispositions','expectedCounts',v_plan->'expectedCounts',
      'recoveryEvidenceDigest',v_plan->'recoveryEvidenceDigest'))
  or v_plan->>'recoveryEvidenceDigest' is distinct from v_plan#>>'{recoveryEvidence,digest}'
  or v_plan->>'legacyReconciliationDigest' is distinct from public.site_content_json_digest(v_plan->'legacyReconciliation')
  or (v_plan#>>'{expectedCounts,desired}')::integer is distinct from
    (v_plan#>>'{expectedCounts,changed}')::integer+(v_plan#>>'{expectedCounts,unchanged}')::integer
  or (v_plan#>>'{expectedCounts,unchanged}')::integer<>0 or (v_plan#>>'{expectedCounts,tombstoned}')::integer<>0
  or pg_catalog.jsonb_typeof(p_adoption->'records') is distinct from 'array'
  or pg_catalog.jsonb_typeof(v_governance_receipt) is distinct from 'object'
  or pg_catalog.jsonb_typeof(v_must_pass_receipt) is distinct from 'object'
 then raise exception 'evidence/digest-bound adoption authority invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content_release',0));
 if exists(select 1 from public.site_content_releases)
  or exists(select 1 from public.site_content_public_authority where singleton and active_release_id is not null)
 then raise exception 'baseline adoption requires empty authority'; end if;
 select count(*) into v_count from pg_catalog.jsonb_array_elements(p_adoption->'records');
 if v_count<>(select count(distinct record->>'logicalId') from pg_catalog.jsonb_array_elements(p_adoption->'records') record)
  or v_count<>(v_plan#>>'{expectedCounts,desired}')::integer
  or exists(select 1 from pg_catalog.jsonb_array_elements(p_adoption->'records') record where not exists(
    select 1 from pg_catalog.jsonb_array_elements(v_plan->'operations') operation
    where operation->>'operation'='changed' and operation->>'logicalId'=record->>'logicalId'
      and operation->>'contentHash'=record->>'contentHash'))
 then raise exception 'adoption logical identities must be unique'; end if;
 insert into public.site_content_releases(id,project_ref,state,generation_id,registry_version,plan_digest,plan_json,
  static_manifest_digest,dynamic_state_digest,release_digest,recovery_evidence,recovery_evidence_digest,verification_evidence,
  legacy_reconciliation_digest,legacy_dispositions,expected_record_count,expected_changed_count,
  expected_unchanged_count,expected_tombstone_count,projected_record_count,integrity_verified,
  public_visibility_verified,governance_verified,must_pass_verified,activated_at)
  values(v_release_id,v_plan->>'projectRef','candidate',(v_plan->>'generationId')::uuid,
  v_plan->>'registryVersion',v_plan->>'planDigest',v_plan,v_plan->>'staticManifestDigest',
  v_plan->>'dynamicStateDigest',v_plan->>'releaseDigest',v_plan->'recoveryEvidence',
   v_plan->>'recoveryEvidenceDigest',null,v_plan->>'legacyReconciliationDigest',
   coalesce(v_plan->'legacyDispositions','[]'::jsonb),v_count,v_count,0,0,v_count,false,false,false,false,null);
 insert into public.site_content_publications(logical_id,domain,record_kind,slug,payload,governance,publication_version,
  content_hash,source_lineage_digest,actor_id)
 select record->>'logicalId',record->>'domain',record->>'recordKind',record->>'slug',record->'payload',
  coalesce(record->'governance','{}'::jsonb),record->>'publicationVersion',record->>'contentHash',
  record->>'sourceLineageDigest',v_actor from pg_catalog.jsonb_array_elements(p_adoption->'records') record;
 insert into public.site_content_release_projections(release_id,publication_id,logical_id,domain,record_kind,slug,payload,
  governance,publication_version,content_hash,source_lineage_digest,tombstoned)
  select v_release_id,publication.id,publication.logical_id,publication.domain,publication.record_kind,publication.slug,
  publication.payload,publication.governance,publication.publication_version,publication.content_hash,
   publication.source_lineage_digest,false from public.site_content_publications publication;
  insert into public.site_content_release_operations(release_id,logical_id,operation,content_hash,status,completed_at)
  select v_release_id,operation->>'logicalId',operation->>'operation',operation->>'contentHash','complete',now()
  from pg_catalog.jsonb_array_elements(v_plan->'operations') operation;
  perform public.derive_site_content_release_gate_artifacts(v_release_id,v_governance_receipt,v_must_pass_receipt);
  select pg_catalog.jsonb_build_object('version','site-content-release-verification-v2','subject',min(subject::text)::jsonb,
    'subjectDigest',min(subject_digest),'publicVisibility',max(artifact) filter(where owner='public-site-content-reader-v1'),
    'governance',max(artifact) filter(where owner='site-content-governance-registry-v1'),
    'mustPass',max(artifact) filter(where owner='rag-programme-eval-v1')) into v_verification
  from public.site_content_release_gate_artifacts where release_id=v_release_id;
  v_verification:=v_verification||pg_catalog.jsonb_build_object('digest',public.site_content_json_digest(v_verification));
  update public.site_content_releases set state='active',verification_evidence=v_verification,integrity_verified=true,
    public_visibility_verified=true,governance_verified=true,must_pass_verified=true,activated_at=now()
  where id=v_release_id and state='candidate';
 update public.site_content_public_authority set active_release_id=v_release_id,change_epoch=change_epoch+1,updated_at=now()
  where singleton and active_release_id is null;
 if not found then raise exception 'adoption authority changed'; end if;
 return pg_catalog.jsonb_build_object('activeReleaseId',v_release_id,'adoptedRecordCount',v_count);
end $$;
create or replace function public.begin_site_content_candidate_release(p_plan jsonb,p_validation_binding jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_candidate uuid; v_previous uuid; v_generation uuid; v_release public.site_content_releases%rowtype;
begin
  if not public.site_content_admin_authorized() or auth.uid() is null then raise exception 'administrator required'; end if;
  begin
    v_candidate := (p_plan->>'candidateReleaseId')::uuid;
    v_previous := (p_plan->>'previousReleaseId')::uuid;
    v_generation := (p_plan->>'generationId')::uuid;
  exception when invalid_text_representation then raise exception 'invalid candidate identity'; end;
  if not public.site_content_consume_validation_binding(p_validation_binding,'begin',p_plan->>'projectRef',
      p_plan->>'recoveryEvidenceDigest',p_plan)
    or p_plan->>'mode' is distinct from 'write'
    or p_plan->>'planDigest' is distinct from public.site_content_json_digest(p_plan-'planDigest')
    or p_plan->>'releaseDigest' is distinct from public.site_content_json_digest(pg_catalog.jsonb_build_object(
      'projectRef',p_plan->'projectRef','candidateReleaseId',p_plan->'candidateReleaseId',
      'previousReleaseId',p_plan->'previousReleaseId','generationId',p_plan->'generationId',
      'registryVersion',p_plan->'registryVersion','staticManifestDigest',p_plan->'staticManifestDigest',
      'embeddingContract',p_plan->'embeddingContract','dynamicStateDigest',p_plan->'dynamicStateDigest',
      'operations',p_plan->'operations','legacyReconciliationDigest',p_plan->'legacyReconciliationDigest',
      'legacyDispositions',p_plan->'legacyDispositions','expectedCounts',p_plan->'expectedCounts',
      'recoveryEvidenceDigest',p_plan->'recoveryEvidenceDigest'))
    or p_plan->>'staticManifestDigest' !~ '^sha256:[0-9a-f]{64}$'
    or p_plan->>'dynamicStateDigest' !~ '^sha256:[0-9a-f]{64}$'
    or p_plan->>'recoveryEvidenceDigest' !~ '^sha256:[0-9a-f]{64}$'
    or p_plan->>'recoveryEvidenceDigest' is distinct from p_plan#>>'{recoveryEvidence,digest}'
    or p_plan->>'legacyReconciliationDigest' is distinct from public.site_content_json_digest(p_plan->'legacyReconciliation')
    or pg_catalog.jsonb_typeof(p_plan->'operations') is distinct from 'array'
  then raise exception 'candidate plan binding invalid'; end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_plan->'operations'))<>
     (select count(distinct operation->>'logicalId') from pg_catalog.jsonb_array_elements(p_plan->'operations') operation)
  then raise exception 'candidate operation identities must be unique'; end if;
  select * into strict v_release from public.site_content_releases where id=v_previous and state='active' for update;
  if v_release.project_ref is distinct from p_plan->>'projectRef' then raise exception 'candidate predecessor project mismatch'; end if;
  insert into public.site_content_releases(id,project_ref,state,generation_id,previous_release_id,registry_version,
    plan_digest,plan_json,static_manifest_digest,dynamic_state_digest,release_digest,recovery_evidence,recovery_evidence_digest,
    legacy_reconciliation_digest,legacy_dispositions,
    expected_record_count,expected_changed_count,expected_unchanged_count,expected_tombstone_count)
  values(v_candidate,p_plan->>'projectRef','candidate',v_generation,v_previous,p_plan->>'registryVersion',
    p_plan->>'planDigest',p_plan,p_plan->>'staticManifestDigest',p_plan->>'dynamicStateDigest',p_plan->>'releaseDigest',
    p_plan->'recoveryEvidence',p_plan->>'recoveryEvidenceDigest',p_plan->>'legacyReconciliationDigest',
    p_plan->'legacyDispositions',(p_plan#>>'{expectedCounts,desired}')::integer,
    (p_plan#>>'{expectedCounts,changed}')::integer,(p_plan#>>'{expectedCounts,unchanged}')::integer,
    (p_plan#>>'{expectedCounts,tombstoned}')::integer)
  on conflict(id) do nothing;
  select * into strict v_release from public.site_content_releases where id=v_candidate and project_ref=p_plan->>'projectRef'
    and generation_id=v_generation and plan_digest=p_plan->>'planDigest' and release_digest=p_plan->>'releaseDigest'
    and static_manifest_digest=p_plan->>'staticManifestDigest' and dynamic_state_digest=p_plan->>'dynamicStateDigest'
    and recovery_evidence_digest=p_plan->>'recoveryEvidenceDigest' and plan_json=p_plan and state='candidate' for update;
  insert into public.site_content_release_operations(release_id,logical_id,operation,content_hash,status)
  select v_candidate,operation->>'logicalId',operation->>'operation',operation->>'contentHash',
    case when operation->>'operation'='unchanged' then 'complete' else 'pending' end
  from pg_catalog.jsonb_array_elements(p_plan->'operations') as operations(operation)
  where operation->>'operation' in ('changed','unchanged','tombstone')
    and operation->>'contentHash' ~ '^sha256:[0-9a-f]{64}$'
  on conflict do nothing;
  if (select count(*) from public.site_content_release_operations where release_id=v_candidate)<>
      pg_catalog.jsonb_array_length(p_plan->'operations')
    or exists(select 1 from public.site_content_release_operations persisted where persisted.release_id=v_candidate
      and not exists(select 1 from pg_catalog.jsonb_array_elements(p_plan->'operations') operation
        where operation->>'logicalId'=persisted.logical_id and operation->>'operation'=persisted.operation
          and operation->>'contentHash'=persisted.content_hash))
  then raise exception 'candidate operation manifest persistence mismatch'; end if;
  insert into public.site_content_release_projections(release_id,publication_id,logical_id,domain,record_kind,slug,payload,
    governance,publication_version,content_hash,source_lineage_digest,embedding,embedding_model,embedding_dimensions,
    embedding_digest,embedding_bytes_digest,tombstoned)
  select v_candidate,prior.publication_id,prior.logical_id,prior.domain,prior.record_kind,prior.slug,prior.payload,
    prior.governance,prior.publication_version,prior.content_hash,prior.source_lineage_digest,prior.embedding,
    prior.embedding_model,prior.embedding_dimensions,prior.embedding_digest,prior.embedding_bytes_digest,false
  from public.site_content_release_operations operation
  join public.site_content_release_projections prior on prior.release_id=v_previous and prior.logical_id=operation.logical_id
    and prior.content_hash=operation.content_hash and not prior.tombstoned
  where operation.release_id=v_candidate and operation.operation='unchanged'
    and prior.embedding is not null and prior.embedding_model=p_plan#>>'{embeddingContract,model}'
    and prior.embedding_dimensions=(p_plan#>>'{embeddingContract,dimensions}')::integer
  on conflict do nothing;
  if (select count(*) from public.site_content_release_projections where release_id=v_candidate)<>
      v_release.expected_unchanged_count then raise exception 'unchanged projection population mismatch'; end if;
  insert into public.site_content_sync_outbox(publication_id,candidate_release_id,project_ref,logical_id,content_hash,
    plan_digest,release_digest,static_manifest_digest,dynamic_state_digest,recovery_evidence_digest,generation_id,operation)
  select publication.id,v_candidate,v_release.project_ref,operation->>'logicalId',publication.content_hash,v_release.plan_digest,
    v_release.release_digest,v_release.static_manifest_digest,v_release.dynamic_state_digest,v_release.recovery_evidence_digest,
    v_release.generation_id,operation->>'operation'
  from pg_catalog.jsonb_array_elements(p_plan->'operations') as operations(operation)
  join public.site_content_publications publication on publication.logical_id=operation->>'logicalId'
  where operation->>'operation'='tombstone'
  on conflict do nothing;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_plan->'operations') as operations(operation)
      where operation->>'operation'='changed')<>v_release.expected_changed_count
    or (select count(*) from pg_catalog.jsonb_array_elements(p_plan->'operations') as operations(operation)
      where operation->>'operation'='unchanged')<>v_release.expected_unchanged_count
    or (select count(*) from pg_catalog.jsonb_array_elements(p_plan->'operations') as operations(operation)
      where operation->>'operation'='tombstone')<>v_release.expected_tombstone_count
  then raise exception 'candidate operation counts invalid'; end if;
  update public.site_content_releases set projected_record_count=expected_unchanged_count where id=v_candidate;
  return pg_catalog.jsonb_build_object('candidateReleaseId',v_candidate,'generationId',v_generation);
end $$;
create or replace function public.publish_site_content_record(p_record jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_release public.site_content_releases%rowtype; v_publication uuid; v_candidate uuid;
begin
  if not public.site_content_admin_authorized() or v_actor is null then raise exception 'administrator required'; end if;
  begin v_candidate := (p_record->>'candidateReleaseId')::uuid;
  exception when invalid_text_representation then raise exception 'invalid candidate release'; end;
  select * into strict v_release from public.site_content_releases where id=v_candidate and state='candidate' for update;
  if p_record->>'projectRef' is distinct from v_release.project_ref
    or p_record->>'generationId' is distinct from v_release.generation_id::text
    or p_record->>'planDigest' is distinct from v_release.plan_digest
    or p_record->>'releaseDigest' is distinct from v_release.release_digest
    or p_record->>'staticManifestDigest' is distinct from v_release.static_manifest_digest
    or p_record->>'dynamicStateDigest' is distinct from v_release.dynamic_state_digest
    or p_record->>'recoveryEvidenceDigest' is distinct from v_release.recovery_evidence_digest
    or coalesce(p_record->>'domain','') not in ('services','forms','medications','differentials')
    or coalesce(p_record->>'contentHash','') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_record->>'sourceLineageDigest','') !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(p_record->'payload') is distinct from 'object'
    or not exists(select 1 from public.site_content_release_operations operation
      where operation.release_id=v_release.id and operation.logical_id=p_record->>'logicalId'
        and operation.operation='changed' and operation.content_hash=p_record->>'contentHash'
        and operation.status='pending')
  then raise exception 'record/candidate binding mismatch'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content:'||p_record->>'logicalId',0));
  insert into public.site_content_publications(logical_id,domain,record_kind,slug,payload,governance,publication_version,
    content_hash,source_lineage_digest,actor_id)
  values(p_record->>'logicalId',p_record->>'domain',p_record->>'kind',p_record->>'slug',p_record->'payload',
    coalesce(p_record->'governance','{}'::jsonb),p_record->>'publicationVersion',p_record->>'contentHash',
    p_record->>'sourceLineageDigest',v_actor)
  on conflict(logical_id) do update set domain=excluded.domain,record_kind=excluded.record_kind,slug=excluded.slug,
    payload=excluded.payload,governance=excluded.governance,publication_version=excluded.publication_version,
    content_hash=excluded.content_hash,source_lineage_digest=excluded.source_lineage_digest,actor_id=excluded.actor_id,updated_at=now()
  returning id into v_publication;
  update public.site_content_public_authority set change_epoch=change_epoch+1,updated_at=now() where singleton;
  insert into public.site_content_sync_outbox(publication_id,candidate_release_id,project_ref,logical_id,content_hash,
    plan_digest,release_digest,static_manifest_digest,dynamic_state_digest,recovery_evidence_digest,generation_id,operation)
  values(v_publication,v_release.id,v_release.project_ref,p_record->>'logicalId',p_record->>'contentHash',v_release.plan_digest,
    v_release.release_digest,v_release.static_manifest_digest,v_release.dynamic_state_digest,v_release.recovery_evidence_digest,v_release.generation_id,'changed')
  on conflict do nothing;
  delete from public.rag_response_cache where owner_id is null;
  return jsonb_build_object('publicationId',v_publication,'candidateReleaseId',v_release.id);
end $$;

create or replace function public.read_public_site_content_records(p_domain text,p_record_kind text default null,p_slug text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('changeEpoch',authority.change_epoch,'activeReleaseId',authority.active_release_id,
    'state',case when authority.active_release_id is null then 'unavailable'
      when exists(select 1 from public.site_content_releases candidate
        join public.site_content_release_operations operation on operation.release_id=candidate.id
        where candidate.state='candidate' and candidate.previous_release_id=authority.active_release_id
          and (operation.operation<>'unchanged' or operation.status<>'complete'))
      then 'updating' else 'current' end,
    'records',coalesce(jsonb_agg(jsonb_build_object('logical_id',projection.logical_id,'domain',projection.domain,
      'record_kind',projection.record_kind,'slug',projection.slug,'payload',projection.payload,'governance',projection.governance,
      'publication_version',projection.publication_version,'content_hash',projection.content_hash,
      'source_lineage_digest',projection.source_lineage_digest) order by projection.logical_id)
      filter(where projection.logical_id is not null),'[]'::jsonb))
  from public.site_content_public_authority authority
  left join public.site_content_release_projections projection on projection.release_id=authority.active_release_id
    and not projection.tombstoned and projection.domain=p_domain
    and (p_record_kind is null or projection.record_kind=p_record_kind) and (p_slug is null or projection.slug=p_slug)
    and not exists(select 1 from public.site_content_releases candidate
      join public.site_content_release_operations operation on operation.release_id=candidate.id
        and operation.logical_id=projection.logical_id
      where candidate.state='candidate' and candidate.previous_release_id=authority.active_release_id
        and (operation.operation<>'unchanged' or operation.status<>'complete'))
    and not exists(select 1 from public.site_content_sync_outbox pending
      join public.site_content_releases candidate on candidate.id=pending.candidate_release_id
      where pending.logical_id=projection.logical_id and pending.status<>'complete'
        and candidate.state='candidate' and candidate.previous_release_id=authority.active_release_id)
  where authority.singleton group by authority.change_epoch,authority.active_release_id
$$;

create or replace function public.claim_site_content_sync_events(p_worker_id uuid,p_limit integer,p_lease_seconds integer)
returns setof public.site_content_sync_outbox language plpgsql security definer set search_path = '' as $$
begin
 if p_worker_id is null or p_limit not between 1 and 100 or p_lease_seconds not between 5 and 900 then raise exception 'invalid claim'; end if;
 return query with claimable as (select event_id from public.site_content_sync_outbox
   where status in ('pending','leased') and available_at<=now() and (status='pending' or lease_expires_at<=now())
   order by created_at limit p_limit for update skip locked)
 update public.site_content_sync_outbox event set status='leased',worker_id=p_worker_id,lease_id=gen_random_uuid(),
   lease_expires_at=now()+make_interval(secs=>p_lease_seconds),attempt_count=event.attempt_count+1
 from claimable where event.event_id=claimable.event_id returning event.*;
end $$;
create or replace function public.heartbeat_site_content_sync_event(p_event_id uuid,p_worker_id uuid,p_lease_id uuid,
 p_generation_id uuid,p_attempt_count integer,p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$ declare v_count integer; begin
 update public.site_content_sync_outbox set lease_expires_at=now()+make_interval(secs=>p_lease_seconds)
 where event_id=p_event_id and worker_id=p_worker_id and lease_id=p_lease_id and generation_id=p_generation_id
   and attempt_count=p_attempt_count and status='leased' and lease_expires_at>now();
 get diagnostics v_count=row_count; return jsonb_build_object('ok',v_count=1); end $$;
create or replace function public.read_site_content_sync_event_payload(p_event_id uuid,p_worker_id uuid,p_lease_id uuid,
 p_generation_id uuid,p_attempt_count integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event public.site_content_sync_outbox%rowtype; v_publication public.site_content_publications%rowtype;
begin
 select * into strict v_event from public.site_content_sync_outbox where event_id=p_event_id and worker_id=p_worker_id
  and lease_id=p_lease_id and generation_id=p_generation_id and attempt_count=p_attempt_count
  and status='leased' and lease_expires_at>now() for update;
 select * into strict v_publication from public.site_content_publications where id=v_event.publication_id;
 return jsonb_build_object('logicalId',v_publication.logical_id,'embeddingInput',v_publication.payload::text,
  'candidateReleaseId',v_event.candidate_release_id,'contentHash',v_event.content_hash,'operation',v_event.operation);
end $$;
create or replace function public.stage_site_content_candidate_projection(p_event_id uuid,p_worker_id uuid,p_lease_id uuid,
 p_generation_id uuid,p_attempt_count integer,p_candidate_release_id uuid,p_embedding jsonb,p_embedding_model text,
 p_embedding_dimensions integer,p_embedding_digest text,p_embedding_bytes_digest text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event public.site_content_sync_outbox%rowtype; v_publication public.site_content_publications%rowtype;
begin
 select * into strict v_event from public.site_content_sync_outbox where event_id=p_event_id and worker_id=p_worker_id
  and lease_id=p_lease_id and generation_id=p_generation_id and attempt_count=p_attempt_count
  and candidate_release_id=p_candidate_release_id and status='leased' and lease_expires_at>now() for update;
 if jsonb_typeof(p_embedding) is distinct from 'array' or jsonb_array_length(p_embedding)<>p_embedding_dimensions
  or p_embedding_model='' or p_embedding_digest !~ '^sha256:[0-9a-f]{64}$'
  or p_embedding_bytes_digest !~ '^sha256:[0-9a-f]{64}$'
  or p_embedding_bytes_digest is distinct from (select 'sha256:'||pg_catalog.encode(extensions.digest(
    pg_catalog.decode(pg_catalog.string_agg(pg_catalog.encode(pg_catalog.float4send((value#>>'{}')::real),'hex'),''
      order by ordinal),'hex'),'sha256'),'hex')
    from pg_catalog.jsonb_array_elements(p_embedding) with ordinality as embedding_value(value,ordinal))
 then raise exception 'embedding byte/model/dimension identity invalid'; end if;
 select * into strict v_publication from public.site_content_publications where id=v_event.publication_id;
 insert into public.site_content_release_projections(release_id,publication_id,logical_id,domain,record_kind,slug,payload,
  governance,publication_version,content_hash,source_lineage_digest,embedding,embedding_model,embedding_dimensions,
  embedding_digest,embedding_bytes_digest,tombstoned)
 values(v_event.candidate_release_id,v_publication.id,v_publication.logical_id,v_publication.domain,v_publication.record_kind,
  v_publication.slug,v_publication.payload,v_publication.governance,v_publication.publication_version,
  v_publication.content_hash,v_publication.source_lineage_digest,p_embedding,p_embedding_model,p_embedding_dimensions,
  p_embedding_digest,p_embedding_bytes_digest,false)
 on conflict(release_id,logical_id) do update set publication_id=excluded.publication_id,payload=excluded.payload,
  governance=excluded.governance,content_hash=excluded.content_hash,source_lineage_digest=excluded.source_lineage_digest,
  embedding=excluded.embedding,embedding_model=excluded.embedding_model,embedding_dimensions=excluded.embedding_dimensions,
  embedding_digest=excluded.embedding_digest,embedding_bytes_digest=excluded.embedding_bytes_digest,tombstoned=false;
 update public.site_content_releases release set projected_record_count=(select count(*) from public.site_content_release_projections
  projection where projection.release_id=release.id and not projection.tombstoned)
 where release.id=v_event.candidate_release_id and release.state='candidate' and release.generation_id=v_event.generation_id;
 return jsonb_build_object('releaseId',v_event.candidate_release_id);
end $$;
create or replace function public.stage_site_content_candidate_operation(p_event_id uuid,p_worker_id uuid,p_lease_id uuid,
 p_generation_id uuid,p_attempt_count integer,p_candidate_release_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event public.site_content_sync_outbox%rowtype; v_release public.site_content_releases%rowtype;
begin
 select * into strict v_event from public.site_content_sync_outbox where event_id=p_event_id and worker_id=p_worker_id
  and lease_id=p_lease_id and generation_id=p_generation_id and attempt_count=p_attempt_count
  and candidate_release_id=p_candidate_release_id and operation in ('unchanged','tombstone')
  and status='leased' and lease_expires_at>now() for update;
 select * into strict v_release from public.site_content_releases where id=v_event.candidate_release_id
  and state='candidate' and generation_id=v_event.generation_id for update;
 insert into public.site_content_release_projections(release_id,publication_id,logical_id,domain,record_kind,slug,payload,
  governance,publication_version,content_hash,source_lineage_digest,embedding,embedding_model,embedding_dimensions,
  embedding_digest,embedding_bytes_digest,tombstoned)
 select v_release.id,prior.publication_id,prior.logical_id,prior.domain,prior.record_kind,prior.slug,prior.payload,
  prior.governance,prior.publication_version,prior.content_hash,prior.source_lineage_digest,
  case when v_event.operation='unchanged' then prior.embedding end,
  case when v_event.operation='unchanged' then prior.embedding_model end,
  case when v_event.operation='unchanged' then prior.embedding_dimensions end,
  case when v_event.operation='unchanged' then prior.embedding_digest end,
  case when v_event.operation='unchanged' then prior.embedding_bytes_digest end,v_event.operation='tombstone'
 from public.site_content_release_projections prior where prior.release_id=v_release.previous_release_id
  and prior.logical_id=v_event.logical_id and not prior.tombstoned and prior.content_hash=v_event.content_hash
  and (v_event.operation='tombstone' or (prior.embedding is not null and prior.embedding_model is not null
    and prior.embedding_dimensions is not null and prior.embedding_digest is not null and prior.embedding_bytes_digest is not null))
 on conflict(release_id,logical_id) do update set publication_id=excluded.publication_id,payload=excluded.payload,
  governance=excluded.governance,content_hash=excluded.content_hash,source_lineage_digest=excluded.source_lineage_digest,
  embedding=excluded.embedding,embedding_model=excluded.embedding_model,embedding_dimensions=excluded.embedding_dimensions,
  embedding_digest=excluded.embedding_digest,embedding_bytes_digest=excluded.embedding_bytes_digest,
  tombstoned=excluded.tombstoned;
 if not found then raise exception 'verified predecessor projection unavailable'; end if;
 update public.site_content_releases release set projected_record_count=(select count(*) from public.site_content_release_projections
  projection where projection.release_id=release.id and not projection.tombstoned) where release.id=v_release.id;
 return pg_catalog.jsonb_build_object('releaseId',v_release.id,'operation',v_event.operation);
end $$;
create or replace function public.complete_site_content_sync_event(p_event_id uuid,p_worker_id uuid,p_lease_id uuid,
 p_generation_id uuid,p_attempt_count integer,p_release_id uuid,p_expected_content_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$ declare v_count integer; begin
 if p_release_id is null then raise exception 'candidate release required'; end if;
 update public.site_content_sync_outbox set status='complete',completed_release_id=p_release_id,completed_at=now(),
  worker_id=null,lease_id=null,lease_expires_at=null
 where event_id=p_event_id and worker_id=p_worker_id and lease_id=p_lease_id and generation_id=p_generation_id
  and attempt_count=p_attempt_count and candidate_release_id=p_release_id and content_hash=p_expected_content_hash
  and status='leased' and lease_expires_at>now()
  and exists(select 1 from public.site_content_releases candidate where candidate.id=p_release_id and candidate.state='candidate')
 and exists(select 1 from public.site_content_release_projections projection where projection.release_id=p_release_id
    and projection.logical_id=site_content_sync_outbox.logical_id and projection.content_hash=p_expected_content_hash);
 get diagnostics v_count=row_count;
 if v_count=1 then
  update public.site_content_release_operations operation set status='complete',completed_at=now()
  from public.site_content_sync_outbox event where event.event_id=p_event_id
    and operation.release_id=p_release_id and operation.logical_id=event.logical_id
    and operation.content_hash=p_expected_content_hash;
 end if;
 return jsonb_build_object('ok',v_count=1); end $$;
create or replace function public.fail_site_content_sync_event(p_event_id uuid,p_worker_id uuid,p_lease_id uuid,
 p_generation_id uuid,p_attempt_count integer,p_error_code text,p_quarantine boolean,p_retry_after_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$ declare v_count integer; begin
 update public.site_content_sync_outbox set status=case when p_quarantine then 'quarantined' else 'pending' end,
  error_code=left(coalesce(p_error_code,'sync_failed'),80),
  available_at=case when p_quarantine then available_at else now()+make_interval(secs=>p_retry_after_seconds) end,
  worker_id=null,lease_id=null,lease_expires_at=null
 where event_id=p_event_id and worker_id=p_worker_id and lease_id=p_lease_id and generation_id=p_generation_id
  and attempt_count=p_attempt_count and status='leased' and lease_expires_at>now();
 get diagnostics v_count=row_count;
 if v_count=1 and p_quarantine then
  update public.site_content_release_operations operation set status='quarantined'
  from public.site_content_sync_outbox event where event.event_id=p_event_id
    and operation.release_id=event.candidate_release_id and operation.logical_id=event.logical_id;
 end if;
 return jsonb_build_object('ok',v_count=1); end $$;

create or replace function public.verify_site_content_candidate_release(p_verification jsonb,p_validation_binding jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_release public.site_content_releases%rowtype; v_plan jsonb:=p_verification->'plan';
 v_evidence jsonb:=p_verification->'verificationEvidence';
begin
 if not public.site_content_admin_authorized() or auth.uid() is null then raise exception 'administrator required'; end if;
 select * into strict v_release from public.site_content_releases where id=(v_plan->>'candidateReleaseId')::uuid
  and state='candidate' for update;
 if not public.site_content_consume_validation_binding(p_validation_binding,'verify',v_release.project_ref,
    v_release.recovery_evidence_digest,p_verification)
  or v_plan is distinct from v_release.plan_json
  or v_evidence->>'version' is distinct from 'site-content-release-verification-v2'
  or v_evidence->>'subjectDigest' is distinct from public.site_content_json_digest(v_evidence->'subject')
  or v_evidence#>>'{subject,projectRef}' is distinct from v_release.project_ref
  or v_evidence#>>'{subject,releaseId}' is distinct from v_release.id::text
  or v_evidence#>>'{subject,planDigest}' is distinct from v_release.plan_digest
  or v_evidence#>>'{subject,releaseDigest}' is distinct from v_release.release_digest
  or v_evidence->>'digest' is distinct from public.site_content_json_digest(v_evidence-'digest')
  or v_evidence#>>'{publicVisibility,owner}' is distinct from 'public-site-content-reader-v1'
  or v_evidence#>>'{publicVisibility,subjectDigest}' is distinct from v_evidence->>'subjectDigest'
  or v_evidence#>>'{publicVisibility,digest}' is distinct from
    public.site_content_json_digest((v_evidence->'publicVisibility')-'digest')
  or v_evidence#>>'{governance,subjectDigest}' is distinct from v_evidence->>'subjectDigest'
  or v_evidence#>>'{governance,owner}' is distinct from 'site-content-governance-registry-v1'
  or v_evidence#>>'{governance,digest}' is distinct from public.site_content_json_digest((v_evidence->'governance')-'digest')
  or v_evidence#>>'{mustPass,subjectDigest}' is distinct from v_evidence->>'subjectDigest'
  or v_evidence#>>'{mustPass,owner}' is distinct from 'rag-programme-eval-v1'
  or v_evidence#>>'{mustPass,caseSetFingerprint}' is distinct from
    'sha256:4bf13e036a49ee077a9227c6b61d6f597efff15e8a5f2e3ea36f0cd4e4ea5107'
  or pg_catalog.jsonb_array_length(v_evidence#>'{mustPass,failedCaseIds}')<>0
  or v_evidence#>>'{mustPass,digest}' is distinct from public.site_content_json_digest((v_evidence->'mustPass')-'digest')
  or not exists(select 1 from public.site_content_release_gate_artifacts artifact where artifact.release_id=v_release.id
    and artifact.owner='public-site-content-reader-v1' and artifact.artifact=v_evidence->'publicVisibility')
  or not exists(select 1 from public.site_content_release_gate_artifacts artifact where artifact.release_id=v_release.id
    and artifact.owner='site-content-governance-registry-v1' and artifact.artifact=v_evidence->'governance')
  or not exists(select 1 from public.site_content_release_gate_artifacts artifact where artifact.release_id=v_release.id
    and artifact.owner='rag-programme-eval-v1' and artifact.artifact=v_evidence->'mustPass')
 then raise exception 'candidate verification authority invalid'; end if;
 update public.site_content_releases set integrity_verified=true,public_visibility_verified=true,
  governance_verified=true,must_pass_verified=true,verification_evidence=v_evidence where id=v_release.id;
 return pg_catalog.jsonb_build_object('releaseId',v_release.id,'verified',true);
end $$;

create or replace function public.read_site_content_release_activation_context(p_release_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_release public.site_content_releases%rowtype; v_previous public.site_content_releases%rowtype;
begin
 if not public.site_content_admin_authorized() or auth.uid() is null then raise exception 'administrator required'; end if;
 select * into strict v_release from public.site_content_releases where id=p_release_id;
 select * into strict v_previous from public.site_content_releases where id=v_release.previous_release_id;
 return pg_catalog.jsonb_build_object('resource',pg_catalog.jsonb_build_object('kind','site-release',
   'releaseId',v_release.id,'releaseDigest',v_release.release_digest),
  'previousResource',pg_catalog.jsonb_build_object('kind','site-release','releaseId',v_previous.id,
   'releaseDigest',v_previous.release_digest),'stateDigest',v_release.dynamic_state_digest);
end $$;

create or replace function public.activate_site_content_release(p_release_id uuid,p_expected_release_digest text,
 p_recovery_evidence jsonb,p_activation_receipt jsonb,p_validation_binding jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_release public.site_content_releases%rowtype; v_previous public.site_content_releases%rowtype;
begin
 if not public.site_content_admin_authorized() or auth.uid() is null then raise exception 'administrator required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content_release',0));
 select * into strict v_release from public.site_content_releases where id=p_release_id for update;
 select release.* into strict v_previous from public.site_content_public_authority authority
  join public.site_content_releases release on release.id=authority.active_release_id where authority.singleton for update;
 if not public.site_content_consume_validation_binding(p_validation_binding,'activate',v_release.project_ref,
      v_release.recovery_evidence_digest,pg_catalog.jsonb_build_object('action','activate','evidence',p_recovery_evidence,
        'activation',p_activation_receipt))
  or v_release.state<>'candidate' or v_release.release_digest<>p_expected_release_digest
  or p_recovery_evidence is distinct from v_release.recovery_evidence
  or p_recovery_evidence->>'digest' is distinct from public.site_content_p05_digest(p_recovery_evidence)
  or (p_recovery_evidence->>'validUntil')::timestamptz<=now()
  or (p_activation_receipt->>'version')::integer<>1
  or (p_activation_receipt->>'receiptId')::uuid is null
  or p_activation_receipt->>'digest' is distinct from public.site_content_p05_digest(p_activation_receipt)
  or p_activation_receipt->>'projectRef' is distinct from v_release.project_ref
  or p_activation_receipt->>'operation' is distinct from 'site-release'
  or p_activation_receipt->>'recoveryEvidenceId' is distinct from p_recovery_evidence->>'evidenceId'
  or p_activation_receipt->>'recoveryEvidenceDigest' is distinct from v_release.recovery_evidence_digest
  or p_activation_receipt->>'stateDigest' is distinct from v_release.dynamic_state_digest
  or p_activation_receipt#>>'{resource,releaseId}' is distinct from v_release.id::text
  or p_activation_receipt#>>'{resource,releaseDigest}' is distinct from v_release.release_digest
  or p_activation_receipt#>>'{previousResource,releaseId}' is distinct from v_previous.id::text
  or p_activation_receipt#>>'{previousResource,releaseDigest}' is distinct from v_previous.release_digest
  or (p_activation_receipt->>'sequence')::bigint<=0
  or (p_activation_receipt->>'recordedAt')::timestamptz<=(p_recovery_evidence->>'verifiedAt')::timestamptz
  or v_release.projected_record_count<>v_release.expected_record_count
  or (select count(*) from public.site_content_release_projections where release_id=v_release.id and not tombstoned)<>v_release.expected_record_count
  or not v_release.integrity_verified or not v_release.public_visibility_verified or not v_release.governance_verified
  or not v_release.must_pass_verified
  or exists(select 1 from public.site_content_sync_outbox where candidate_release_id=v_release.id
    and status in ('pending', 'leased', 'quarantined'))
  or exists(select 1 from public.site_content_release_operations where release_id=v_release.id and status<>'complete')
  or (select count(*) from public.site_content_release_operations where release_id=v_release.id)<>
    v_release.expected_changed_count+v_release.expected_unchanged_count+v_release.expected_tombstone_count
  or exists(select 1 from public.site_content_release_operations operation where operation.release_id=v_release.id
    and operation.operation<>'tombstone' and not exists(select 1 from public.site_content_release_projections projection
      where projection.release_id=v_release.id and projection.logical_id=operation.logical_id
        and projection.content_hash=operation.content_hash and not projection.tombstoned))
  or exists(select 1 from public.site_content_release_projections projection where projection.release_id=v_release.id
    and not exists(select 1 from public.site_content_release_operations operation where operation.release_id=v_release.id
      and operation.logical_id=projection.logical_id and operation.content_hash=projection.content_hash))
 then raise exception 'candidate or P05 activation authority invalid'; end if;
 update public.site_content_releases set state='retained' where id=v_previous.id;
 update public.site_content_releases set state='active',previous_release_id=v_previous.id,
  activation_receipt=p_activation_receipt,activated_at=now() where id=v_release.id;
 update public.site_content_public_authority set active_release_id=v_release.id,change_epoch=change_epoch+1,updated_at=now()
  where singleton and active_release_id=v_previous.id;
 return jsonb_build_object('activeReleaseId',v_release.id,'previousReleaseId',v_previous.id,
  'activationReceiptId',p_activation_receipt->>'receiptId');
end $$;
create or replace function public.rollback_site_content_release(p_failed_release_id uuid,p_activation_receipt jsonb,
 p_rollback_receipt jsonb,p_recovery_evidence jsonb,p_validation_binding jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_failed public.site_content_releases%rowtype; v_retained public.site_content_releases%rowtype;
begin
 if not public.site_content_admin_authorized() or auth.uid() is null then raise exception 'administrator required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_content_release',0));
 select * into strict v_failed from public.site_content_releases where id=p_failed_release_id and state='active' for update;
 if not public.site_content_consume_validation_binding(p_validation_binding,'rollback',v_failed.project_ref,
      v_failed.recovery_evidence_digest,pg_catalog.jsonb_build_object('action','rollback','evidence',p_recovery_evidence,
        'activation',p_activation_receipt,'rollback',p_rollback_receipt))
  or p_recovery_evidence is distinct from v_failed.recovery_evidence
  or p_activation_receipt is distinct from v_failed.activation_receipt
  or p_activation_receipt->>'digest' is distinct from public.site_content_p05_digest(p_activation_receipt)
  or (p_rollback_receipt->>'version')::integer<>1
  or (p_rollback_receipt->>'receiptId')::uuid is null
  or p_rollback_receipt->>'receiptId' is not distinct from p_activation_receipt->>'receiptId'
  or p_rollback_receipt->>'digest' is distinct from public.site_content_p05_digest(p_rollback_receipt)
  or p_rollback_receipt->>'projectRef' is distinct from v_failed.project_ref
  or p_rollback_receipt->>'operation' is distinct from 'site-release'
  or p_rollback_receipt->>'activationReceiptId' is distinct from p_activation_receipt->>'receiptId'
  or p_rollback_receipt->>'activationReceiptDigest' is distinct from p_activation_receipt->>'digest'
  or p_rollback_receipt->>'recoveryEvidenceDigest' is distinct from v_failed.recovery_evidence_digest
  or p_rollback_receipt#>>'{failedResource,releaseId}' is distinct from v_failed.id::text
  or p_rollback_receipt#>>'{failedResource,releaseDigest}' is distinct from v_failed.release_digest
  or p_rollback_receipt#>>'{restoredResource,releaseId}' is distinct from v_failed.previous_release_id::text
  or p_rollback_receipt->>'restorationMethod' is distinct from 'retained-pointer'
  or (p_rollback_receipt->>'sequence')::bigint<=(p_activation_receipt->>'sequence')::bigint
  or (p_rollback_receipt->>'recordedAt')::timestamptz<=(p_activation_receipt->>'recordedAt')::timestamptz
 then raise exception 'P05 rollback receipt binding invalid'; end if;
 select * into strict v_retained from public.site_content_releases where id=v_failed.previous_release_id and state='retained'
  and release_digest=p_rollback_receipt#>>'{restoredResource,releaseDigest}' for update;
 update public.site_content_releases set state='failed',rollback_receipt=p_rollback_receipt where id=v_failed.id;
 update public.site_content_releases set state='active' where id=v_retained.id;
 update public.site_content_public_authority set active_release_id=v_retained.id,change_epoch=change_epoch+1,updated_at=now()
  where singleton and active_release_id=v_failed.id;
 if not found then raise exception 'rollback authority changed'; end if;
 return jsonb_build_object('activeReleaseId',v_retained.id,'restorationMethod','retained-pointer');
end $$;

alter table public.site_content_public_authority enable row level security;
alter table public.site_content_releases enable row level security;
alter table public.site_content_publications enable row level security;
alter table public.site_content_release_projections enable row level security;
alter table public.site_content_sync_outbox enable row level security;
alter table public.site_content_release_operations enable row level security;
alter table public.site_content_validation_binding_consumptions enable row level security;
alter table public.site_content_release_gate_artifacts enable row level security;
revoke all on public.site_content_public_authority,public.site_content_releases,public.site_content_publications,
 public.site_content_release_projections,public.site_content_sync_outbox,public.site_content_release_operations,
 public.site_content_validation_binding_consumptions,public.site_content_release_gate_artifacts
 from public,anon,authenticated,service_role;
revoke all on function public.site_content_canonical_json(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.site_content_p05_digest(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.site_content_json_digest(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.site_content_validation_binding_valid(jsonb,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.site_content_consume_validation_binding(jsonb,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.site_content_gate_owner_receipt_valid(jsonb,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.derive_site_content_release_gate_artifacts(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.read_site_content_release_gate_artifacts(uuid) from public,anon,authenticated,service_role;
revoke all on function public.provision_site_content_validation_secret(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.provision_site_content_governance_gate_owner_secret(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.provision_rag_programme_gate_owner_secret(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.site_content_admin_authorized() from public,anon,authenticated;
revoke all on function public.adopt_site_content_baseline(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.begin_site_content_candidate_release(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.publish_site_content_record(jsonb) from public,anon,authenticated;
revoke all on function public.read_public_site_content_records(text,text,text) from public,anon,authenticated;
revoke all on function public.claim_site_content_sync_events(uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_site_content_sync_event(uuid,uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.read_site_content_sync_event_payload(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.stage_site_content_candidate_projection(uuid,uuid,uuid,uuid,integer,uuid,jsonb,text,integer,text,text) from public,anon,authenticated;
revoke all on function public.stage_site_content_candidate_operation(uuid,uuid,uuid,uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.complete_site_content_sync_event(uuid,uuid,uuid,uuid,integer,uuid,text) from public,anon,authenticated;
revoke all on function public.fail_site_content_sync_event(uuid,uuid,uuid,uuid,integer,text,boolean,integer) from public,anon,authenticated;
revoke all on function public.verify_site_content_candidate_release(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.read_site_content_release_activation_context(uuid) from public,anon,authenticated;
revoke all on function public.activate_site_content_release(uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.rollback_site_content_release(uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.site_content_admin_authorized() to authenticated;
grant execute on function public.adopt_site_content_baseline(jsonb,jsonb) to authenticated;
grant execute on function public.begin_site_content_candidate_release(jsonb,jsonb) to authenticated;
grant execute on function public.publish_site_content_record(jsonb) to authenticated;
grant execute on function public.verify_site_content_candidate_release(jsonb,jsonb) to authenticated;
grant execute on function public.read_site_content_release_activation_context(uuid) to authenticated;
grant execute on function public.activate_site_content_release(uuid,text,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.rollback_site_content_release(uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.read_site_content_release_gate_artifacts(uuid) to authenticated;
grant execute on function public.derive_site_content_release_gate_artifacts(uuid,jsonb,jsonb) to authenticated;
grant execute on function public.provision_site_content_validation_secret(jsonb) to service_role;
grant execute on function public.provision_site_content_governance_gate_owner_secret(jsonb) to service_role;
grant execute on function public.provision_rag_programme_gate_owner_secret(jsonb) to service_role;
grant execute on function public.read_public_site_content_records(text,text,text) to service_role;
grant execute on function public.claim_site_content_sync_events(uuid,integer,integer) to service_role;
grant execute on function public.heartbeat_site_content_sync_event(uuid,uuid,uuid,uuid,integer,integer) to service_role;
grant execute on function public.read_site_content_sync_event_payload(uuid,uuid,uuid,uuid,integer) to service_role;
grant execute on function public.stage_site_content_candidate_projection(uuid,uuid,uuid,uuid,integer,uuid,jsonb,text,integer,text,text) to service_role;
grant execute on function public.stage_site_content_candidate_operation(uuid,uuid,uuid,uuid,integer,uuid) to service_role;
grant execute on function public.complete_site_content_sync_event(uuid,uuid,uuid,uuid,integer,uuid,text) to service_role;
grant execute on function public.fail_site_content_sync_event(uuid,uuid,uuid,uuid,integer,text,boolean,integer) to service_role;
