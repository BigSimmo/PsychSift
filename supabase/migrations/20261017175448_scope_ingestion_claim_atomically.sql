-- Scope is enforced inside the fenced claim transaction. The three-argument
-- function remains available for older, unscoped workers during rollout.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.claim_ingestion_jobs(p_worker_id text, p_claim_limit integer, p_stale_after_minutes integer, p_allowed_document_ids uuid[], p_allowed_file_types text[])
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare v_candidate record; v_locked jsonb; v_job public.ingestion_jobs%rowtype; v_count integer := 0; v_now timestamptz; v_generation uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' or p_claim_limit is null or p_claim_limit not between 1 and 100
    or p_stale_after_minutes not between 1 and 1440 or p_stale_after_minutes is null then raise exception 'invalid_ingestion_claim_configuration'; end if;
  for v_candidate in select j.id, j.document_id from public.ingestion_jobs j
    where (p_allowed_document_ids is null or j.document_id = any(p_allowed_document_ids))
      and (p_allowed_file_types is null or exists (select 1 from public.documents d where d.id = j.document_id
        and lower(btrim(split_part(d.file_type, ';', 1))) = any(p_allowed_file_types)))
      and j.attempt_count < j.max_attempts
      and (j.status = 'pending' and coalesce(j.next_run_at, pg_catalog.clock_timestamp()) <= pg_catalog.clock_timestamp()
        or j.status = 'processing' and j.lease_expires_at <= pg_catalog.clock_timestamp())
    order by j.created_at, j.id
  loop
    exit when v_count >= p_claim_limit;
    v_locked := public.lock_ingestion_document_authority(v_candidate.document_id, true);
    if v_locked is null then continue; end if;
    -- File type can change while authority is acquired. Recheck the locked document
    -- before minting a lease or incrementing attempts; the client snapshot is not authority.
    if p_allowed_file_types is not null and not coalesce(
      lower(btrim(split_part(v_locked->'document'->>'file_type', ';', 1))) = any(p_allowed_file_types), false)
      then continue; end if;
    perform 1 from public.ingestion_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    perform 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    v_now := pg_catalog.clock_timestamp();
    if exists (select 1 from public.ingestion_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now)
      or exists (select 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now) then continue; end if;
    select * into v_job from public.ingestion_jobs where id = v_candidate.id for update skip locked;
    if not found or v_job.attempt_count >= v_job.max_attempts or not (
      v_job.status = 'pending' and coalesce(v_job.next_run_at, v_now) <= v_now
      or v_job.status = 'processing' and v_job.lease_expires_at <= v_now) then continue; end if;
    v_generation := (v_locked->'document'->>'index_generation_id')::uuid;
    if v_generation is null and (v_locked->'document'->'metadata' ? 'index_generation_id') then continue; end if;

    update public.ingestion_jobs set status = 'processing', locked_by = p_worker_id, locked_at = v_now,
      lease_token = gen_random_uuid(), lease_expected_generation_id = v_generation,
      lease_write_generation_id = gen_random_uuid(),
      lease_authority_digest = v_locked->>'authority_digest', lease_expires_at = v_now + make_interval(secs => p_stale_after_minutes * 60),
      lease_duration_seconds = p_stale_after_minutes * 60, attempt_count = attempt_count + 1, next_run_at = null
    where id = v_job.id returning * into v_job;
    return next to_jsonb(v_job) || jsonb_build_object('job_kind','node', 'documents',v_locked->'document');
    v_count := v_count + 1;
  end loop;
end $$;

alter function public.claim_ingestion_jobs(text, integer, integer, uuid[], text[]) owner to postgres;
revoke all on function public.claim_ingestion_jobs(text, integer, integer, uuid[], text[]) from public, anon, authenticated;
grant execute on function public.claim_ingestion_jobs(text, integer, integer, uuid[], text[]) to service_role;
