-- DRAFT. Merge only inside the owner's approved database-change window.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- F02: the tombstone cannot commit without its exact, durable cleanup obligation.
alter table public.storage_cleanup_jobs add column cme_evidence_id uuid
  references public.cme_evidence(id) on delete set null;
create unique index storage_cleanup_jobs_cme_evidence_key on public.storage_cleanup_jobs(cme_evidence_id)
  where cme_evidence_id is not null;
create or replace function public.cme_remove_evidence(p_owner_id uuid, p_evidence_id uuid, p_reason text)
returns public.cme_evidence
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_row public.cme_evidence%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'cme_evidence_removal_reason_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 23092026));
  select * into v_row from public.cme_evidence where id = p_evidence_id and owner_id = p_owner_id for update;
  if not found then raise exception 'cme_evidence_not_found'; end if;
  insert into public.storage_cleanup_jobs(owner_id, cme_evidence_id, document_bucket, document_paths, image_bucket, image_paths)
  values (p_owner_id, v_row.id, 'cme-private-evidence', array[v_row.storage_path], 'cme-private-evidence', '{}')
  on conflict (cme_evidence_id) where cme_evidence_id is not null do nothing;
  if v_row.removed_at is null then
    update public.cme_evidence set removed_at = now(), removal_reason = btrim(p_reason), file_name = 'Removed file'
    where id = v_row.id and owner_id = p_owner_id returning * into v_row;
  end if;
  return v_row;
end $$;
alter function public.cme_remove_evidence(uuid,uuid,text) owner to postgres;
revoke all on function public.cme_remove_evidence(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.cme_remove_evidence(uuid,uuid,text) to service_role;

-- The versioned entry point makes app-before-SQL fail before any tombstone write.
-- Retain the corrected original for old callers during a SQL-first rollout.
create function public.cme_remove_evidence_v2(p_owner_id uuid,p_evidence_id uuid,p_reason text)
returns public.cme_evidence language sql security invoker set search_path = '' as $$
  select public.cme_remove_evidence(p_owner_id,p_evidence_id,p_reason)
$$;
alter function public.cme_remove_evidence_v2(uuid,uuid,text) owner to postgres;
revoke all on function public.cme_remove_evidence_v2(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.cme_remove_evidence_v2(uuid,uuid,text) to service_role;

-- Reconcile pre-existing tombstones too, including earlier lost-response removals.
-- Deleting an already-absent object is idempotent in the existing janitor.
insert into public.storage_cleanup_jobs(owner_id,cme_evidence_id,document_bucket,document_paths,image_bucket,image_paths)
select owner_id,id,'cme-private-evidence',array[storage_path],'cme-private-evidence','{}'::text[]
from public.cme_evidence where removed_at is not null
on conflict (cme_evidence_id) where cme_evidence_id is not null do nothing;

-- F03: recovery owns the same authority and job locks as claims until its single
-- scheduling transaction commits. Preserve every artifact and generation. A next
-- worker claim mints a new write generation; no obsolete unfenced reset is called.
create function public.recover_ingestion_job(p_job_id uuid, p_action text, p_expected jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare v_document_id uuid; v_locked jsonb; v_job public.ingestion_jobs%rowtype; v_now timestamptz; v_active boolean; v_indexed boolean;
begin
  if p_action is null or p_action not in ('retry','supersede')
    or jsonb_typeof(p_expected) is distinct from 'object'
    or not (p_expected ?& array['jobStatus','jobLockedAt','jobLeaseToken','jobLeaseExpiresAt','documentStatus','documentOwnerId']) then
    raise exception 'invalid_ingestion_recovery_request';
  end if;
  select document_id into v_document_id from public.ingestion_jobs where id = p_job_id;
  if not found then return jsonb_build_object('ok',false,'reason','job_closed'); end if;
  v_locked := public.lock_ingestion_document_authority(v_document_id, false);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','authority_unavailable'); end if;
  perform 1 from public.ingestion_jobs where document_id = v_document_id order by id for update;
  perform 1 from public.indexing_v3_agent_jobs where document_id = v_document_id order by id for update;
  select * into v_job from public.ingestion_jobs where id = p_job_id and document_id = v_document_id;
  if not found or v_job.status not in ('failed','processing')
    or v_job.status is distinct from p_expected->>'jobStatus'
    or v_job.locked_at is distinct from (p_expected->>'jobLockedAt')::timestamptz
    or v_job.lease_token is distinct from (p_expected->>'jobLeaseToken')::uuid
    or v_job.lease_expires_at is distinct from (p_expected->>'jobLeaseExpiresAt')::timestamptz
    or v_locked->'document'->>'status' is distinct from p_expected->>'documentStatus'
    or v_locked->'document'->>'owner_id' is distinct from p_expected->>'documentOwnerId' then
    return jsonb_build_object('ok',false,'reason','state_changed');
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_job.status = 'processing' and v_job.lease_expires_at > v_now then
    return jsonb_build_object('ok',false,'reason','active_lease');
  end if;
  v_active := exists(select 1 from public.ingestion_jobs where document_id = v_document_id and id <> p_job_id
      and (status = 'pending' or status = 'processing' and lease_expires_at > v_now))
    or exists(select 1 from public.indexing_v3_agent_jobs where document_id = v_document_id
      and status = 'processing' and lease_expires_at > v_now);
  v_indexed := v_locked->'document'->>'status' = 'indexed'
    and coalesce((v_locked->'document'->>'chunk_count')::integer,0) > 0;
  if p_action = 'retry' then
    if v_active or v_indexed or exists(select 1 from public.ingestion_jobs where document_id = v_document_id
        and id <> p_job_id and status in ('pending','processing')) then
      return jsonb_build_object('ok',false,'reason','state_changed');
    end if;
    if exists(select 1 from ingestion_generation_evidence.candidates where document_id = v_document_id) then
      return jsonb_build_object('ok',false,'reason','managed_recovery_required');
    end if;
    update public.documents set status = 'queued', error_message = null where id = v_document_id;
  elsif not (v_active or v_indexed) then
    -- Stale redundant siblings may be closed before retry, in stable job id order.
    if not exists(select 1 from public.ingestion_jobs where document_id = v_document_id and id <> p_job_id
        and status in ('failed','processing')) then
      return jsonb_build_object('ok',false,'reason','state_changed');
    end if;
  end if;
  update public.ingestion_jobs set status = case when p_action = 'retry' then 'pending' else 'completed' end,
    stage = case when p_action = 'retry' then 'queued after recovery' else 'superseded during recovery' end,
    progress = case when p_action = 'retry' then 0 else 100 end,
    attempt_count = case when p_action = 'retry' then 0 else attempt_count end,
    next_run_at = case when p_action = 'retry' then v_now else null end,
    completed_at = case when p_action = 'retry' then null else v_now end,
    error_message = null, locked_by = null, locked_at = null,
    lease_token = null, lease_expected_generation_id = null, lease_write_generation_id = null,
    lease_authority_digest = null, lease_expires_at = null, lease_duration_seconds = null
  where id = p_job_id;
  return jsonb_build_object('ok',true,'action',p_action,'artifacts_preserved',true);
end $$;
alter function public.recover_ingestion_job(uuid,text,jsonb) owner to postgres;
revoke all on function public.recover_ingestion_job(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.recover_ingestion_job(uuid,text,jsonb) to service_role;

-- F13: one statement snapshot of the complete effective owner/public/document scope.
-- Per-row fixed-size hashes bound aggregate memory without returning document metadata.
create function public.rag_cache_scope_revision_v1(p_owner_id uuid, p_include_public boolean, p_document_ids uuid[] default null)
returns text language sql stable security invoker set search_path = '' as $$
  select 'rag-cache-scope-v1:' || pg_catalog.md5(coalesce(pg_catalog.string_agg(row_hash, '' order by id),''))
  from (
    select d.id, pg_catalog.md5(pg_catalog.jsonb_build_array(d.id,d.owner_id,d.status,d.updated_at,d.metadata,d.index_generation_id)::text) as row_hash
    from public.documents d
    where (d.owner_id = p_owner_id or (coalesce(p_include_public,false) and d.owner_id is null))
      and (coalesce(cardinality(p_document_ids),0) = 0 or d.id = any(p_document_ids))
  ) revision
$$;
alter function public.rag_cache_scope_revision_v1(uuid,boolean,uuid[]) owner to postgres;
revoke all on function public.rag_cache_scope_revision_v1(uuid,boolean,uuid[]) from public, anon, authenticated;
grant execute on function public.rag_cache_scope_revision_v1(uuid,boolean,uuid[]) to service_role;

-- HY05: team movement and removal of its whole-team authority commit together.
create function public.work_revoke_supervisors_on_team_move() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.hospital_id is distinct from old.hospital_id then
    update public.work_role_grants set revoked_at = now(), revoked_by = new.linked_by
    where role = 'supervisor' and service_id = new.service_id and subject_user_id is null and revoked_at is null;
  end if;
  return new;
end $$;
alter function public.work_revoke_supervisors_on_team_move() owner to postgres;
revoke all on function public.work_revoke_supervisors_on_team_move() from public, anon, authenticated;
grant execute on function public.work_revoke_supervisors_on_team_move() to service_role;
create trigger work_team_move_revokes_supervisors after update of hospital_id on public.work_hospital_teams
for each row execute function public.work_revoke_supervisors_on_team_move();

-- A grant admitted against an old hospital must not race the move. Both paths
-- lock the team before writing authority. Revocation itself needs no team lookup.
create function public.work_guard_whole_team_supervisor() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.role = 'supervisor' and new.service_id is not null and new.revoked_at is null then
    perform 1 from public.work_hospital_teams where service_id = new.service_id and hospital_id = new.hospital_id for share;
    if not found then raise exception 'work_team_changed'; end if;
  end if;
  return new;
end $$;
alter function public.work_guard_whole_team_supervisor() owner to postgres;
revoke all on function public.work_guard_whole_team_supervisor() from public, anon, authenticated;
grant execute on function public.work_guard_whole_team_supervisor() to service_role;
create trigger work_whole_team_supervisor_scope before insert or update on public.work_role_grants
for each row execute function public.work_guard_whole_team_supervisor();

-- Versioned application entry point: refuse app-before-SQL instead of moving
-- without the transactional revocation trigger. Old callers remain trigger-protected.
create function public.work_move_team_v1(p_actor_id uuid,p_service_id uuid,p_expected_hospital_id uuid,p_to_hospital_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from auth.users where id = p_actor_id
    and raw_app_meta_data->>'site_role' = 'administrator') then
    raise exception 'work_role_denied';
  end if;
  perform 1 from public.work_hospitals where id = p_to_hospital_id and archived_at is null for share;
  if not found then raise exception 'work_hospital_unavailable'; end if;
  if p_expected_hospital_id is not distinct from p_to_hospital_id then raise exception 'work_team_changed'; end if;
  update public.work_hospital_teams set hospital_id = p_to_hospital_id, linked_by = p_actor_id, linked_at = now()
  where service_id = p_service_id and hospital_id = p_expected_hospital_id;
  if not found then raise exception 'work_team_changed'; end if;
  return p_expected_hospital_id;
end $$;
alter function public.work_move_team_v1(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function public.work_move_team_v1(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.work_move_team_v1(uuid,uuid,uuid,uuid) to service_role;

-- F14 / HY06: pairing authority is locked before authorization and child writes.
create or replace function public.teaching_depth_command(p_actor_id uuid, p_service_id uuid, p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_service public.on_call_services;
  v_role text;
  v_occ public.teaching_occurrences;
  v_pairing public.teaching_supervision_pairings;
  v_entry public.teaching_supervision_entries;
  v_note public.teaching_supervision_notes;
  v_readiness public.teaching_readiness;
  v_id uuid;
  v_registrar uuid;
  v_supervisor uuid;
  v_ids uuid[];
  v_topics text[];
  v_starts date;
  v_ends date;
  v_date date;
  v_target numeric;
  v_text text;
  v_minutes integer;
  v_useful integer;
  v_count integer;
  v_result jsonb;
  v_row jsonb;
  v_leaver boolean := false;
begin
  if p_actor_id is null then raise exception 'teaching_auth_required'; end if;
  if p_action is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_service_id is null
    or p_action not in ('pairing.save','pairing.reassign','supervision.log','supervision.confirm','supervision.note',
      'supervision.note.confirm','supervision.read','supervision.target.set','readiness.set','readiness.deid.confirm',
      'feedback.submit','feedback.totals','import.commit') then
    raise exception 'teaching_invalid_request';
  end if;
  select * into v_service from public.on_call_services where id = p_service_id for share;
  if not found then raise exception 'teaching_access_denied'; end if;
  v_role := public.teaching_member_role(p_service_id, p_actor_id);
  if v_role is null then
    -- A leaver keeps read-only access to their own supervision entries (as registrar) for 90 days
    -- from the shared revoke, as logbook.read keeps their attendance (spec §9). Nothing else.
    v_leaver := p_action = 'supervision.read' and exists (select 1 from public.on_call_service_members m
      where m.service_id = p_service_id and m.user_id = p_actor_id
        and m.revoked_at is not null and m.revoked_at > now() - interval '90 days');
    if not v_leaver then raise exception 'teaching_access_denied'; end if;
  end if;
  if p_action not in ('supervision.read','feedback.totals') and not (v_service.verified_at is not null or v_service.is_demo) then
    raise exception 'teaching_team_unverified';
  end if;
  if p_action in ('pairing.save','pairing.reassign','import.commit') then
    perform pg_advisory_xact_lock(hashtextextended(p_service_id::text, 74818));
  end if;

  if p_action = 'pairing.save' then
    v_id := public.teaching_uuid_arg(p_payload, 'pairingId');
    v_registrar := public.teaching_uuid_arg(p_payload, 'registrarId');
    v_supervisor := public.teaching_uuid_arg(p_payload, 'supervisorId');
    v_starts := public.teaching_date_arg(p_payload, 'startsOn');
    v_ends := public.teaching_date_arg(p_payload, 'endsOn');
    -- The hours target is the registrar's own (supervision.target.set); an organiser never sets it.
    if p_payload ? 'targetHours' then raise exception 'teaching_invalid_request'; end if;
    -- Organisers pair other people. A pairing that includes the actor needs a Teaching admin.
    if not (v_role = 'admin' or (v_role = 'organiser' and p_actor_id <> v_registrar and p_actor_id <> v_supervisor)) then
      raise exception 'teaching_role_denied';
    end if;
    if v_registrar is null or v_supervisor is null or v_registrar = v_supervisor
      or v_starts is null or v_ends is null or v_ends < v_starts or v_ends > v_starts + 731
      or not public.service_member_active(p_service_id, v_registrar)
      or not public.service_member_active(p_service_id, v_supervisor) then
      raise exception 'teaching_invalid_request';
    end if;
    if v_id is null then
      if (select count(*) from public.teaching_supervision_pairings where service_id = p_service_id) >= 5000 then
        raise exception 'teaching_limit';
      end if;
      insert into public.teaching_supervision_pairings(service_id, registrar_id, supervisor_id, starts_on, ends_on, created_by)
      values (p_service_id, v_registrar, v_supervisor, v_starts, v_ends, p_actor_id)
      returning * into v_pairing;
    else
      select * into v_pairing from public.teaching_supervision_pairings where id = v_id and service_id = p_service_id for update;
      if not found then raise exception 'teaching_not_found'; end if;
      -- Once a pairing has entries, only its end date and target can change; the supervisor
      -- changes through pairing.reassign.
      if exists (select 1 from public.teaching_supervision_entries e where e.pairing_id = v_pairing.id)
        and (v_pairing.registrar_id is distinct from v_registrar or v_pairing.supervisor_id is distinct from v_supervisor
          or v_pairing.starts_on <> v_starts) then
        raise exception 'teaching_invalid_request';
      end if;
      update public.teaching_supervision_pairings set registrar_id = v_registrar, supervisor_id = v_supervisor,
        starts_on = v_starts, ends_on = v_ends, updated_at = now()
      where id = v_pairing.id returning * into v_pairing;
    end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'pairing.save', v_pairing.id);
    return jsonb_build_object('pairingId', v_pairing.id);

  elsif p_action = 'pairing.reassign' then
    v_id := public.teaching_uuid_arg(p_payload, 'pairingId');
    v_supervisor := public.teaching_uuid_arg(p_payload, 'supervisorId');
    select * into v_pairing from public.teaching_supervision_pairings where id = v_id and service_id = p_service_id for update;
    if not found then raise exception 'teaching_not_found'; end if;
    if not (v_role = 'admin' or (v_role = 'organiser' and p_actor_id is distinct from v_pairing.registrar_id and p_actor_id <> v_supervisor)) then
      raise exception 'teaching_role_denied';
    end if;
    if v_supervisor is null or v_supervisor is not distinct from v_pairing.registrar_id
      or not public.service_member_active(p_service_id, v_supervisor) then
      raise exception 'teaching_invalid_request';
    end if;
    -- Confirmed entries keep who confirmed them; pending entries and notes now wait for the new
    -- supervisor, because confirmation always checks the pairing's current supervisor.
    update public.teaching_supervision_pairings set supervisor_id = v_supervisor, updated_at = now() where id = v_pairing.id;
    select count(*) into v_count from public.teaching_supervision_entries where pairing_id = v_pairing.id and status = 'pending';
    perform public.teaching_audit(p_service_id, p_actor_id, 'pairing.reassign', v_pairing.id);
    return jsonb_build_object('pairingId', v_pairing.id, 'pendingMoved', v_count);

  elsif p_action = 'supervision.target.set' then
    -- The registrar's own hours target for this pairing: nullable, no default, and progress is shown
    -- only once it is set. Only the pairing's registrar sets or clears it (targetHours null).
    v_id := public.teaching_uuid_arg(p_payload, 'pairingId');
    select * into v_pairing from public.teaching_supervision_pairings where id = v_id and service_id = p_service_id for update;
    if not found then raise exception 'teaching_not_found'; end if;
    if v_pairing.registrar_id is distinct from p_actor_id then raise exception 'teaching_role_denied'; end if;
    if not (p_payload ? 'targetHours') then raise exception 'teaching_invalid_request'; end if;
    if p_payload->'targetHours' <> 'null'::jsonb then
      if jsonb_typeof(p_payload->'targetHours') <> 'number' or (p_payload->>'targetHours') !~ '^[0-9]{1,3}(\.[0-9])?$' then
        raise exception 'teaching_invalid_request';
      end if;
      v_target := (p_payload->>'targetHours')::numeric;
      if v_target not between 1 and 500 then raise exception 'teaching_invalid_request'; end if;
    end if;
    update public.teaching_supervision_pairings set target_hours = v_target, updated_at = now() where id = v_pairing.id;
    perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.target.set', v_pairing.id);
    return jsonb_build_object('pairingId', v_pairing.id, 'targetHours', v_target);

  elsif p_action = 'supervision.log' then
    v_id := public.teaching_uuid_arg(p_payload, 'pairingId');
    select * into v_pairing from public.teaching_supervision_pairings where id = v_id and service_id = p_service_id for update;
    if not found then raise exception 'teaching_not_found'; end if;
    if v_pairing.registrar_id is distinct from p_actor_id then raise exception 'teaching_role_denied'; end if;
    v_date := public.teaching_date_arg(p_payload, 'date');
    v_minutes := public.teaching_int_arg(p_payload, 'minutes');
    v_text := public.teaching_text_arg(p_payload, 'type');
    v_topics := public.teaching_text_array_arg(p_payload, 'topics', 5);
    if v_date is null or v_date < v_pairing.starts_on or v_date > v_pairing.ends_on
      or v_date > (now() at time zone 'Australia/Perth')::date
      or v_minutes is null or v_minutes not between 15 and 240 or v_minutes % 15 <> 0
      or v_text is null or v_text not in ('individual','group')
      -- Topics are optional: none to five.
      or cardinality(v_topics) not between 0 and 5
      or not (v_topics <@ array['case_review','risk','psychotherapy','formulation','medication','mha_legal','teaching_skills','career','exam_prep','wellbeing','other']::text[]) then
      raise exception 'teaching_invalid_request';
    end if;
    if (select count(*) from public.teaching_supervision_entries where pairing_id = v_pairing.id) >= 1000 then
      raise exception 'teaching_limit';
    end if;
    insert into public.teaching_supervision_entries(pairing_id, service_id, session_date, minutes, type, topics, logged_by)
    values (v_pairing.id, p_service_id, v_date, v_minutes, v_text, v_topics, p_actor_id)
    returning * into v_entry;
    perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.log', v_entry.id);
    return jsonb_build_object('entryId', v_entry.id);

  elsif p_action = 'supervision.confirm' then
    v_ids := public.teaching_uuid_array_arg(p_payload, 'entryIds', 20);
    if cardinality(v_ids) = 0 then raise exception 'teaching_invalid_request'; end if;
    -- Parent before child, sorted for multi-pairing batches. Authorization is checked
    -- after any wait, so confirmation linearizes with reassignment; a confirmation
    -- committed first remains historical evidence under its original supervisor.
    perform p.id from public.teaching_supervision_pairings p
      where p.service_id = p_service_id and p.id in (
        select e.pairing_id from public.teaching_supervision_entries e
        where e.id = any(v_ids) and e.service_id = p_service_id)
      order by p.id for update;
    perform e.id from public.teaching_supervision_entries e
      where e.id = any(v_ids) and e.service_id = p_service_id order by e.id for update;
    -- All or nothing: every entry must be pending and belong to a pairing the actor now supervises.
    if (select count(*) from public.teaching_supervision_entries e
        join public.teaching_supervision_pairings p on p.id = e.pairing_id
        where e.id = any(v_ids) and e.service_id = p_service_id and e.status = 'pending' and p.supervisor_id = p_actor_id)
      <> cardinality(v_ids) then
      raise exception 'teaching_not_found';
    end if;
    update public.teaching_supervision_entries set status = 'confirmed', confirmed_by = p_actor_id, confirmed_at = now(), locked = true
    where id = any(v_ids);
    insert into public.teaching_audit_events(service_id, actor_id, action, subject_id)
    select p_service_id, p_actor_id, 'supervision.confirm', u from unnest(v_ids) as u;
    return jsonb_build_object('confirmed', cardinality(v_ids));

  elsif p_action = 'supervision.note' then
    v_id := public.teaching_uuid_arg(p_payload, 'entryId');
    perform p.id from public.teaching_supervision_pairings p
      join public.teaching_supervision_entries e on e.pairing_id = p.id
      where e.id = v_id and e.service_id = p_service_id for update of p;
    select e.* into v_entry from public.teaching_supervision_entries e
    join public.teaching_supervision_pairings p on p.id = e.pairing_id
    where e.id = v_id and e.service_id = p_service_id and p.registrar_id = p_actor_id;
    if not found then raise exception 'teaching_not_found'; end if;
    v_text := public.teaching_text_arg(p_payload, 'reason');
    if v_text is null or not public.teaching_valid_correction(v_text, p_payload->'correctedValue') then
      raise exception 'teaching_invalid_request';
    end if;
    if v_text = 'wrong_date' then
      perform public.teaching_date_arg(p_payload->'correctedValue', 'date');
    end if;
    if (select count(*) from public.teaching_supervision_notes where entry_id = v_entry.id and confirmed_at is null) >= 5 then
      raise exception 'teaching_limit';
    end if;
    insert into public.teaching_supervision_notes(entry_id, service_id, reason, corrected_value, created_by)
    values (v_entry.id, p_service_id, v_text, p_payload->'correctedValue', p_actor_id)
    returning * into v_note;
    perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.note', v_note.id);
    return jsonb_build_object('noteId', v_note.id);

  elsif p_action = 'supervision.note.confirm' then
    v_id := public.teaching_uuid_arg(p_payload, 'noteId');
    perform p.id from public.teaching_supervision_pairings p
      join public.teaching_supervision_entries e on e.pairing_id = p.id
      join public.teaching_supervision_notes n on n.entry_id = e.id
      where n.id = v_id and n.service_id = p_service_id for update of p;
    select n.* into v_note from public.teaching_supervision_notes n
    join public.teaching_supervision_entries e on e.id = n.entry_id
    join public.teaching_supervision_pairings p on p.id = e.pairing_id
    where n.id = v_id and n.service_id = p_service_id and p.supervisor_id = p_actor_id and n.confirmed_at is null
    for update of n;
    if not found then raise exception 'teaching_not_found'; end if;
    update public.teaching_supervision_notes set confirmed_by = p_actor_id, confirmed_at = now() where id = v_note.id;
    perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.note.confirm', v_note.id);
    return jsonb_build_object('noteId', v_note.id);

  elsif p_action = 'supervision.read' then
    -- The registrar and supervisor of a pairing see its entries; an organiser sees totals and
    -- status only (never topics). Reading anyone else's pairing is audited. A leaver (v_leaver)
    -- sees only the pairings where they are the registrar, and reads their own record unaudited.
    v_id := public.teaching_uuid_arg(p_payload, 'pairingId');
    if v_id is not null and not exists (
      select 1 from public.teaching_supervision_pairings p where p.id = v_id and p.service_id = p_service_id
        and (p.registrar_id = p_actor_id or (not v_leaver and (p.supervisor_id = p_actor_id or v_role = 'organiser')))) then
      raise exception 'teaching_not_found';
    end if;
    if v_id is null and v_role = 'organiser' then
      -- An organiser's whole-team read (Logbook, Today): one service-level row per call.
      perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.read', null);
    elsif not v_leaver then
      insert into public.teaching_audit_events(service_id, actor_id, action, subject_id)
      select p_service_id, p_actor_id, 'supervision.read', p.id
      from public.teaching_supervision_pairings p
      where p.service_id = p_service_id and (v_id is null or p.id = v_id)
        and p.registrar_id is distinct from p_actor_id
        and (p.supervisor_id = p_actor_id or v_role = 'organiser');
    end if;
    select jsonb_build_object('pairings', coalesce(jsonb_agg(jsonb_build_object(
        'pairingId', p.id,
        'access', case when p.registrar_id = p_actor_id then 'registrar' when p.supervisor_id = p_actor_id then 'supervisor' else 'organiser' end,
        'registrarName', case when p.registrar_id is null then 'Former member' else coalesce((select coalesce(m.display_name, 'Member')
          from public.on_call_service_members m where m.service_id = p.service_id and m.user_id = p.registrar_id), 'Former member') end,
        'supervisorName', case when p.supervisor_id is null then 'Former member' else coalesce((select coalesce(m.display_name, 'Member')
          from public.on_call_service_members m where m.service_id = p.service_id and m.user_id = p.supervisor_id), 'Former member') end,
        'startsOn', p.starts_on, 'endsOn', p.ends_on,
        'targetHours', case when p.registrar_id = p_actor_id or p.supervisor_id = p_actor_id then p.target_hours else null end,
        'confirmedMinutes', (select coalesce(sum(e.minutes), 0) from public.teaching_supervision_entries e where e.pairing_id = p.id and e.status = 'confirmed'),
        'pendingMinutes', (select coalesce(sum(e.minutes), 0) from public.teaching_supervision_entries e where e.pairing_id = p.id and e.status = 'pending'),
        'pendingCount', (select count(*) from public.teaching_supervision_entries e where e.pairing_id = p.id and e.status = 'pending'),
        'oldestPendingAt', (select min(e.created_at) from public.teaching_supervision_entries e where e.pairing_id = p.id and e.status = 'pending'),
        'entries', case when p.registrar_id = p_actor_id or p.supervisor_id = p_actor_id then coalesce((select jsonb_agg(jsonb_build_object(
            'entryId', e.id, 'date', e.session_date, 'minutes', e.minutes, 'type', e.type, 'topics', to_jsonb(e.topics),
            'status', e.status, 'confirmedAt', e.confirmed_at,
            'confirmedByName', case when e.confirmed_at is null then null when e.confirmed_by is null then 'Former member' else coalesce(
              (select coalesce(m.display_name, 'Member') from public.on_call_service_members m where m.service_id = e.service_id and m.user_id = e.confirmed_by),
              'Former member') end,
            'notes', coalesce((select jsonb_agg(jsonb_build_object('noteId', n.id, 'reason', n.reason, 'correctedValue', n.corrected_value,
                'createdAt', n.created_at, 'confirmedAt', n.confirmed_at) order by n.created_at)
              from public.teaching_supervision_notes n where n.entry_id = e.id), '[]'::jsonb)
          ) order by e.session_date desc, e.created_at desc) from public.teaching_supervision_entries e where e.pairing_id = p.id), '[]'::jsonb)
          else null end
      ) order by p.starts_on desc, p.id), '[]'::jsonb))
    into v_result
    from public.teaching_supervision_pairings p
    where p.service_id = p_service_id and (v_id is null or p.id = v_id)
      and (p.registrar_id = p_actor_id or (not v_leaver and (p.supervisor_id = p_actor_id or v_role = 'organiser')));
    return v_result;

  elsif p_action in ('readiness.set','readiness.deid.confirm') then
    v_id := public.teaching_uuid_arg(p_payload, 'occurrenceId');
    select * into v_occ from public.teaching_occurrences where id = v_id and service_id = p_service_id;
    if not found then raise exception 'teaching_not_found'; end if;
    if v_occ.presenter_id is distinct from p_actor_id then raise exception 'teaching_role_denied'; end if;
    insert into public.teaching_readiness(occurrence_id, service_id) values (v_occ.id, p_service_id)
    on conflict (occurrence_id) do nothing;
    if p_action = 'readiness.set' then
      v_text := public.teaching_text_arg(p_payload, 'item');
      if v_text is null or v_text not in ('reading_list','aims','slides_link','room')
        or jsonb_typeof(p_payload->'done') is distinct from 'boolean' then
        raise exception 'teaching_invalid_request';
      end if;
      update public.teaching_readiness set
        items = case when (p_payload->>'done')::boolean
          then array(select distinct i from unnest(array_append(items, v_text)) as i order by i)
          else array_remove(items, v_text) end,
        updated_at = now()
      where occurrence_id = v_occ.id returning * into v_readiness;
    else
      update public.teaching_readiness set deid_confirmed_at = now(), deid_confirmed_by = p_actor_id, updated_at = now()
      where occurrence_id = v_occ.id returning * into v_readiness;
    end if;
    perform public.teaching_audit(p_service_id, p_actor_id, p_action, v_occ.id);
    return jsonb_build_object('items', to_jsonb(v_readiness.items), 'deidConfirmedAt', v_readiness.deid_confirmed_at);

  elsif p_action = 'feedback.submit' then
    v_id := public.teaching_uuid_arg(p_payload, 'occurrenceId');
    select * into v_occ from public.teaching_occurrences where id = v_id and service_id = p_service_id;
    if not found then raise exception 'teaching_not_found'; end if;
    if not exists (select 1 from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.user_id = p_actor_id) then
      raise exception 'teaching_not_attended';
    end if;
    if v_occ.status = 'cancelled' or now() < v_occ.ends_at or now() > v_occ.ends_at + interval '7 days' then
      raise exception 'teaching_window_closed';
    end if;
    v_useful := public.teaching_int_arg(p_payload, 'useful');
    v_text := public.teaching_text_arg(p_payload, 'pace');
    if v_useful is null or v_useful not between 1 and 5 or v_text is null or v_text not in ('slow','right','fast') then
      raise exception 'teaching_invalid_request';
    end if;
    -- One-way "already answered" marker. No responder id is stored with feedback anywhere.
    insert into public.teaching_feedback_replied(occurrence_id, reply_marker)
    values (v_occ.id, encode(extensions.digest(convert_to('teaching-feedback:' || v_occ.id::text || ':' || p_actor_id::text, 'UTF8'), 'sha256'), 'hex'))
    on conflict (occurrence_id, reply_marker) do nothing;
    if not found then raise exception 'teaching_limit'; end if;
    insert into public.teaching_feedback_answers(occurrence_id, service_id, useful, pace)
    values (v_occ.id, p_service_id, v_useful, v_text);
    -- No actor on this audit row: nothing may tie a person to the moment an answer was written.
    perform public.teaching_audit(p_service_id, null, 'feedback.submit', v_occ.id);
    return '{}'::jsonb;

  elsif p_action = 'import.commit' then
    -- A term from a spreadsheet, all or nothing: every row is a new series through the same save as
    -- series.save, inside this one transaction, so one refused row rolls back every row before it.
    -- Spec §4 gives import to organisers and admins.
    if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;
    if jsonb_typeof(p_payload->'rows') is distinct from 'array'
      or jsonb_array_length(p_payload->'rows') not between 1 and 200 then
      raise exception 'teaching_invalid_request';
    end if;
    v_count := 0;
    for v_row in select r.value from jsonb_array_elements(p_payload->'rows') as r(value) loop
      if jsonb_typeof(v_row) is distinct from 'object' or v_row ? 'seriesId' then
        raise exception 'teaching_invalid_request';
      end if;
      v_result := public.teaching_series_save(p_actor_id, p_service_id, v_row);
      perform public.teaching_audit(p_service_id, p_actor_id, 'series.save', public.teaching_uuid_arg(v_result, 'seriesId'));
      v_count := v_count + public.teaching_int_arg(v_result, 'occurrences');
    end loop;
    perform public.teaching_audit(p_service_id, p_actor_id, 'import.commit', null);
    return jsonb_build_object('series', jsonb_array_length(p_payload->'rows'), 'occurrences', v_count);

  elsif p_action = 'feedback.totals' then
    v_id := public.teaching_uuid_arg(p_payload, 'occurrenceId');
    select * into v_occ from public.teaching_occurrences where id = v_id and service_id = p_service_id;
    if not found then raise exception 'teaching_not_found'; end if;
    if (v_occ.presenter_id = p_actor_id or v_role = 'organiser') is not true then raise exception 'teaching_role_denied'; end if;
    select count(*) into v_count from public.teaching_feedback_answers where occurrence_id = v_occ.id;
    if now() < v_occ.ends_at + interval '7 days' or v_count < 5 then
      return jsonb_build_object('released', false);
    end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'feedback.totals', v_occ.id);
    return jsonb_build_object(
      'released', true,
      'replies', v_count,
      'useful', (select jsonb_build_object('1', count(*) filter (where useful = 1), '2', count(*) filter (where useful = 2),
          '3', count(*) filter (where useful = 3), '4', count(*) filter (where useful = 4), '5', count(*) filter (where useful = 5))
        from public.teaching_feedback_answers where occurrence_id = v_occ.id),
      'pace', (select jsonb_build_object('slow', count(*) filter (where pace = 'slow'), 'right', count(*) filter (where pace = 'right'),
          'fast', count(*) filter (where pace = 'fast'))
        from public.teaching_feedback_answers where occurrence_id = v_occ.id)
    );
  end if;

  raise exception 'teaching_invalid_request';
end $$;
alter function public.teaching_depth_command(uuid,uuid,text,jsonb) owner to postgres;
revoke all on function public.teaching_depth_command(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.teaching_depth_command(uuid,uuid,text,jsonb) to service_role;
