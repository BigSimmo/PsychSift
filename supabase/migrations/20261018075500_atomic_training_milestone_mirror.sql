-- PS-047: commit the CME milestone and registrar mirror in one transaction.
-- Merge only after the owner explicitly approves this database change/window.
-- Service-role-only: application authentication supplies the owner identity.
create or replace function public.mutate_owner_training_milestone(
  p_owner_id uuid,
  p_id uuid,
  p_operation text,
  p_milestone jsonb,
  p_registrar jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.cme_training_milestones%rowtype;
  v_count integer;
  v_deleted integer;
  v_registrar_id uuid;
begin
  if p_owner_id is null or p_id is null or p_operation not in ('create', 'update', 'delete') or p_operation is null then
    raise exception 'invalid training milestone mutation' using errcode = '22023';
  end if;
  -- Serialize this owner's writes, including the maximum-row check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('training-milestone:' || p_owner_id::text, 0));
  if p_operation = 'delete' then
    delete from public.cme_training_milestones where id = p_id and owner_id = p_owner_id;
    get diagnostics v_count = row_count;
    delete from public.registrar_training_milestones where id = p_id and registrar_id = p_owner_id;
    get diagnostics v_deleted = row_count;
    if v_count + v_deleted = 0 then
      raise exception 'milestone not found' using errcode = 'P0002';
    end if;
    return pg_catalog.jsonb_build_object('deleted', true);
  end if;

  if p_operation = 'create' then
    select count(*) into v_count from public.cme_training_milestones where owner_id = p_owner_id;
    if v_count >= 200 then raise exception 'training milestone limit reached' using errcode = '54000'; end if;
    insert into public.cme_training_milestones (id, owner_id, label, due_kind, due_fte_months, due_on, completed_on)
    values (p_id, p_owner_id, p_milestone->>'label', p_milestone->>'due_kind',
      (p_milestone->>'due_fte_months')::numeric, (p_milestone->>'due_on')::date, (p_milestone->>'completed_on')::date)
    returning * into v_row;
  else
    update public.cme_training_milestones set
      label = p_milestone->>'label', due_kind = p_milestone->>'due_kind',
      due_fte_months = (p_milestone->>'due_fte_months')::numeric,
      due_on = (p_milestone->>'due_on')::date, completed_on = (p_milestone->>'completed_on')::date
    where id = p_id and owner_id = p_owner_id returning * into v_row;
    if not found then
      -- A registrar-only record retains its own code and training stage.
      update public.registrar_training_milestones set milestone_title = p_registrar->>'milestone_title',
        achieved_at = (p_registrar->>'achieved_at')::timestamptz, evidence_summary = p_registrar->>'evidence_summary'
      where id = p_id and registrar_id = p_owner_id returning id into v_registrar_id;
      if not found then raise exception 'milestone not found' using errcode = 'P0002'; end if;
      return p_milestone || pg_catalog.jsonb_build_object('id', p_id);
    end if;
  end if;

  insert into public.registrar_training_milestones (id, registrar_id, milestone_code, milestone_title, stage, achieved_at, evidence_summary)
  values (p_id, p_owner_id, p_registrar->>'milestone_code', p_registrar->>'milestone_title',
    p_registrar->>'stage', (p_registrar->>'achieved_at')::timestamptz, p_registrar->>'evidence_summary')
  on conflict (id) do update set milestone_code = excluded.milestone_code, milestone_title = excluded.milestone_title,
    stage = excluded.stage, achieved_at = excluded.achieved_at, evidence_summary = excluded.evidence_summary
  where public.registrar_training_milestones.registrar_id = p_owner_id
  returning id into v_registrar_id;
  if not found then raise exception 'milestone identity conflict' using errcode = '23505'; end if;
  return pg_catalog.to_jsonb(v_row);
end;
$$;
revoke all on function public.mutate_owner_training_milestone(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mutate_owner_training_milestone(uuid, uuid, text, jsonb, jsonb) to service_role;
