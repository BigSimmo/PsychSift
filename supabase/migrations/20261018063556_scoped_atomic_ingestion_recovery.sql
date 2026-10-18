-- Draft only: merging this migration to main applies it to production. Merge only
-- inside the owner's specifically approved database-change window.
-- Recovery is a queue transition; it never resets/deletes committed or staged
-- artifacts, source bytes, retained evidence, or Storage objects.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.recover_ingestion_job_scoped(
  p_document_id uuid, p_owner_id uuid, p_file_type text, p_job_id uuid,
  p_apply boolean, p_expected_snapshot text, p_stale_after_minutes integer
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  v_locked jsonb; v_document jsonb; v_job public.ingestion_jobs%rowtype;
  v_generation uuid; v_snapshot text; v_action text; v_now timestamptz; v_cutoff timestamptz;
  v_batch jsonb; v_outcome text; v_pending integer; v_processing integer; v_failed integer;
begin
  -- ACLs reject anonymous/authenticated callers; also require an authenticated
  -- service JWT rather than treating an absent request identity as service access.
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_document_id is null or p_job_id is null or p_apply is null
    or p_file_type is null or p_file_type !~ '^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$'
    or p_stale_after_minutes is null or p_stale_after_minutes not between 1 and 1440
    or (p_apply and (p_expected_snapshot is null or p_expected_snapshot !~ '^sha256:[0-9a-f]{64}$'))
    or (not p_apply and p_expected_snapshot is not null)
    then raise exception 'invalid_scoped_recovery_configuration' using errcode = '22023'; end if;

  -- Same lock order as assert_current_ingestion_attempt and both claim RPCs:
  -- source authority/document, all node jobs in id order, then all agent jobs.
  v_locked := public.lock_ingestion_document_authority(p_document_id, false);
  if v_locked is null then return jsonb_build_object('outcome','skipped','reason','authority_unavailable'); end if;
  v_document := v_locked->'document';
  if (v_document->>'owner_id')::uuid is distinct from p_owner_id
    or lower(btrim(split_part(v_document->>'file_type', ';', 1))) is distinct from p_file_type
    then return jsonb_build_object('outcome','skipped','reason','scope_changed'); end if;
  perform 1 from public.ingestion_jobs where document_id = p_document_id order by id for update;
  perform 1 from public.indexing_v3_agent_jobs where document_id = p_document_id order by id for update;
  select * into v_job from public.ingestion_jobs where id = p_job_id and document_id = p_document_id;
  if not found then return jsonb_build_object('outcome','skipped','reason','job_changed'); end if;
  v_generation := (v_document->>'index_generation_id')::uuid;
  if v_generation is null and (v_document->'metadata' ? 'index_generation_id') then
    return jsonb_build_object('outcome','skipped','reason','generation_unknown');
  end if;
  v_now := pg_catalog.clock_timestamp();
  v_cutoff := v_now - make_interval(mins => p_stale_after_minutes);
  if v_job.status not in ('failed','processing') then
    return jsonb_build_object('outcome','skipped','reason','job_not_recoverable');
  end if;
  -- A timestamp-only old lock cannot prove an issued lease has expired. Unknown
  -- lease expiry fails closed, as does a recently refreshed lock on an old lease.
  if v_job.status = 'processing' and (v_job.lease_expires_at is null or v_job.locked_at is null
    or v_job.lease_expires_at > v_now or v_job.locked_at >= v_cutoff) then
    return jsonb_build_object('outcome','skipped','reason','lease_active_or_unknown');
  end if;
  if exists(select 1 from public.ingestion_jobs where document_id = p_document_id and id <> p_job_id
      and status in ('pending','processing')) then
    return jsonb_build_object('outcome','skipped','reason','sibling_job_open');
  end if;
  if exists(select 1 from public.indexing_v3_agent_jobs where document_id = p_document_id and status = 'processing'
      and (lease_expires_at is null or lease_expires_at > v_now or locked_at is null or locked_at >= v_cutoff)) then
    return jsonb_build_object('outcome','skipped','reason','agent_active_or_unknown');
  end if;
  -- An indexed predecessor survives a failed refresh. It does not prove that
  -- refresh completed: only its own committed write generation under the same
  -- source authority, or a different generation beyond its predecessor/write,
  -- can conclusively supersede it. Incomplete legacy fences safely retry.
  v_action := case when v_document->>'status' = 'indexed' and v_generation is not null
    and v_job.lease_token is not null and v_job.lease_write_generation_id is not null
    and v_job.lease_authority_digest is not null and v_job.lease_expires_at is not null
    and v_job.lease_duration_seconds is not null
    and ((v_generation = v_job.lease_write_generation_id and v_job.lease_authority_digest = v_locked->>'authority_digest')
      or (v_generation is distinct from v_job.lease_expected_generation_id
        and v_generation is distinct from v_job.lease_write_generation_id))
    then 'supersede' else 'retry' end;
  if v_action = 'retry' and v_job.status = 'processing'
    and v_job.lease_expected_generation_id is distinct from v_generation then
    return jsonb_build_object('outcome','skipped','reason','generation_changed');
  end if;

  -- Terminal worker transitions take the parent batch after document/job locks.
  -- Preview and apply bind the same parent state before changing its rollup.
  if v_job.batch_id is not null then
    select to_jsonb(b) into v_batch from public.import_batches b where id=v_job.batch_id for update;
    if not found then return jsonb_build_object('outcome','skipped','reason','batch_changed'); end if;
  end if;

  -- Bind every document/source/authority and job field observed under these locks.
  -- A new lease, heartbeat, generation commit, repoint, source/owner/MIME change,
  -- or terminal transition invalidates the reviewed preview without any writes.
  v_snapshot := 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
    'authority', v_locked, 'job', to_jsonb(v_job), 'stale_after_minutes', p_stale_after_minutes, 'batch', v_batch,
    'node_jobs', (select coalesce(jsonb_agg(to_jsonb(j) order by id), '[]'::jsonb) from public.ingestion_jobs j where document_id=p_document_id),
    'agent_jobs', (select coalesce(jsonb_agg(to_jsonb(j) order by id), '[]'::jsonb) from public.indexing_v3_agent_jobs j where document_id=p_document_id)
  )::text, 'UTF8'), 'sha256'), 'hex');
  if not p_apply then
    return jsonb_build_object('outcome','planned','action',v_action,'snapshot',v_snapshot,
      'document_id',p_document_id,'job_id',p_job_id,'generation_id',v_generation);
  end if;
  if p_expected_snapshot is distinct from v_snapshot then
    return jsonb_build_object('outcome','skipped','reason','snapshot_changed');
  end if;

  if v_action = 'supersede' then
    update public.ingestion_jobs set status='completed',stage='superseded by scoped recovery',progress=100,
      error_message=null,completed_at=v_now,next_run_at=null,locked_at=null,locked_by=null,
      lease_token=null,lease_expected_generation_id=null,lease_write_generation_id=null,
      lease_authority_digest=null,lease_expires_at=null,lease_duration_seconds=null where id=p_job_id;
    v_outcome := 'superseded';
  else
    update public.ingestion_jobs set status='pending',stage='queued after scoped recovery',progress=0,
      error_message=null,completed_at=null,next_run_at=v_now,attempt_count=0,locked_at=null,locked_by=null,
      lease_token=null,lease_expected_generation_id=null,lease_write_generation_id=null,
      lease_authority_digest=null,lease_expires_at=null,lease_duration_seconds=null where id=p_job_id;
    update public.documents set
      status=case when v_generation is not null or status='indexed' then status else 'queued' end,
      error_message=null,updated_at=v_now where id=p_document_id;
    v_outcome := 'requeued';
  end if;
  if v_job.batch_id is not null then
    select count(*) filter(where status='pending'),count(*) filter(where status='processing'),count(*) filter(where status='failed')
      into v_pending,v_processing,v_failed from public.ingestion_jobs where batch_id=v_job.batch_id;
    update public.import_batches set
      status=case when v_pending+v_processing>0 then 'processing' when v_failed>0 then 'completed_with_errors' else 'completed' end,
      failed_files=v_failed,completed_at=case when v_pending+v_processing>0 then null else v_now end
      where id=v_job.batch_id;
  end if;
  return jsonb_build_object('outcome',v_outcome,'document_id',p_document_id,'job_id',p_job_id);
end $$;

alter function public.recover_ingestion_job_scoped(uuid, uuid, text, uuid, boolean, text, integer) owner to postgres;
revoke all on function public.recover_ingestion_job_scoped(uuid, uuid, text, uuid, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.recover_ingestion_job_scoped(uuid, uuid, text, uuid, boolean, text, integer) to service_role;
