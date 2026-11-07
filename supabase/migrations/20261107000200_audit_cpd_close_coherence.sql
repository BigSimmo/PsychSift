-- Bind annual statuses to every evaluator input; retain immutable snapshots and reasoned amendments.
-- Older application instances lacking inputs fail closed rather than freezing an unchecked evaluation.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Requirement task updates and direct allocation writes must serialize with close too.
-- Lock both sides of a move in year-id order. Account/year cascades find no year and pass.
create or replace function public.cme_guard_requirement() returns trigger
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare v_year public.cme_years;
begin
  for v_year in
    select y.* from public.cme_years y
    where (tg_op <> 'INSERT' and y.id = old.year_id and y.owner_id = old.owner_id)
       or (tg_op <> 'DELETE' and y.id = new.year_id and y.owner_id = new.owner_id)
    order by y.id for update
  loop
    if v_year.closed_at is not null then raise exception 'cme_year_closed'; end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.cme_guard_allocation() returns trigger
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare v_entry public.cme_entries; v_closed_at timestamptz;
begin
  -- Lock the entry before reading its year in a separate statement. A join locking only
  -- the year can retain a stale association if an entry moves to another year while waiting.
  for v_entry in
    select e.* from public.cme_entries e
    where (tg_op <> 'INSERT' and e.id = old.entry_id and e.owner_id = old.owner_id)
       or (tg_op <> 'DELETE' and e.id = new.entry_id and e.owner_id = new.owner_id)
    order by e.id for share
  loop
    select y.closed_at into v_closed_at from public.cme_years y
      where y.id = v_entry.year_id and y.owner_id = v_entry.owner_id for update;
    if v_closed_at is not null
      and not public.cme_entry_amendment_in_progress(v_entry.id, v_entry.owner_id) then
      raise exception 'cme_year_closed';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.cme_close_year(p_owner_id uuid, p_year_id uuid, p_evaluation jsonb, p_shortfall_note text default null)
returns jsonb
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_year public.cme_years; v_snapshot public.cme_year_snapshots; v_record jsonb; v_inputs jsonb;
  v_total numeric; v_count integer; v_note text := nullif(btrim(coalesce(p_shortfall_note, '')), '');
begin
  if p_owner_id is null or p_year_id is null or jsonb_typeof(p_evaluation) is distinct from 'object' then
    raise exception 'cme_invalid_request';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then raise exception 'cme_invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 23092026));
  select * into v_year from public.cme_years where owner_id=p_owner_id and id=p_year_id for update;
  if not found then raise exception 'cme_year_not_confirmed'; end if;
  if v_year.closed_at is not null then raise exception 'cme_year_closed'; end if;

  select count(*), coalesce(sum(a.hours), 0) into v_count, v_total
  from public.cme_entries e
  left join lateral (
    select sum(hours) as hours from public.cme_allocations where owner_id=p_owner_id and entry_id=e.id
  ) a on true
  where e.owner_id=p_owner_id and e.year_id=p_year_id and e.archived_at is null;
  if round(v_total, 2) is distinct from round((p_evaluation->>'totalHours')::numeric, 2)
    or v_count is distinct from (p_evaluation->>'entryCount')::integer then
    raise exception 'cme_close_conflict';
  end if;

  v_record := jsonb_build_object(
    'year', v_year.year,
    'totalHours', v_year.total_hours,
    'confirmedOn', v_year.confirmed_on,
    'confirmedSource', v_year.confirmed_source,
    'requirements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'label', r.label, 'source', r.source, 'spec', r.spec, 'completedOn', r.completed_on
      ) order by r.sort_order, r.id), '[]'::jsonb)
      from public.cme_requirements r where r.owner_id=p_owner_id and r.year_id=p_year_id
    ),
    'entries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'date', e.activity_date, 'title', e.title, 'reflection', e.reflection,
        'costCents', e.cost_cents, 'routineId', e.routine_id, 'documentId', e.document_id,
        'sourceUrl', e.source_url, 'buckets', to_jsonb(e.buckets),
        'formalPeerReviewHours', e.formal_peer_review_hours,
        'allocations', (
          select coalesce(jsonb_agg(jsonb_build_object('category', a.category, 'hours', a.hours) order by a.category), '[]'::jsonb)
          from public.cme_allocations a where a.owner_id=p_owner_id and a.entry_id=e.id
        )
      ) order by e.activity_date, e.id), '[]'::jsonb)
      from public.cme_entries e where e.owner_id=p_owner_id and e.year_id=p_year_id and e.archived_at is null
    )
  );

  -- Compare the complete inputs used by evaluateYear(), not only the lossy total/count.
  -- The same year lock is taken by every requirement, activity and allocation writer.
  v_inputs := jsonb_build_object(
    'year', v_record->'year', 'totalHours', v_record->'totalHours',
    'confirmedOn', v_record->'confirmedOn', 'confirmedSource', v_record->'confirmedSource',
    'requirements', (select coalesce(jsonb_agg(r order by r->>'id'), '[]'::jsonb)
      from jsonb_array_elements(v_record->'requirements') r),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e->'id', 'buckets', e->'buckets',
      'formalPeerReviewHours', e->'formalPeerReviewHours', 'allocations', e->'allocations'
    ) order by e->>'id'), '[]'::jsonb) from jsonb_array_elements(v_record->'entries') e)
  );
  if p_evaluation->'inputs' is distinct from v_inputs then
    raise exception 'cme_close_conflict';
  end if;

  insert into public.cme_year_snapshots(owner_id, year_id, shortfall_note, record, evaluation, total_hours, target_hours)
  values (p_owner_id, p_year_id, v_note, v_record, p_evaluation, round(v_total, 2), v_year.total_hours)
  returning * into v_snapshot;
  update public.cme_years set closed_at = v_snapshot.closed_at, shortfall_note = v_note
  where owner_id=p_owner_id and id=p_year_id;
  return to_jsonb(v_snapshot);
end $$;

-- New app instances must refuse old schemas rather than letting the legacy RPC ignore inputs.
-- Old app instances on the new schema also fail closed in cme_close_year without inputs.
create function public.cme_close_year_v2(p_owner_id uuid, p_year_id uuid, p_evaluation jsonb, p_shortfall_note text default null)
returns jsonb language sql security invoker set search_path = public, pg_catalog, pg_temp as $$
  select public.cme_close_year(p_owner_id, p_year_id, p_evaluation, p_shortfall_note)
$$;
alter function public.cme_close_year_v2(uuid, uuid, jsonb, text) owner to postgres;
revoke all on function public.cme_close_year_v2(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.cme_close_year_v2(uuid, uuid, jsonb, text) to service_role;
