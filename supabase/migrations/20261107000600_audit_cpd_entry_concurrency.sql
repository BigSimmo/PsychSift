-- Full manual CPD edits and amendments replace exactly the stored content their editor read.
-- Strengthen the legacy RPCs too: old clients without expectedVersion fail closed on edits.
-- Creates retain request-id idempotency; intentional Teaching create/restore remains separate.
-- Apply before the app release: new clients use versioned RPCs and never fall back.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Called only after the writer has locked the owner-scoped entry FOR UPDATE. Allocation
-- guards take FOR SHARE on that entry, so allocations cannot change across this comparison.
-- VOLATILE gives this lookup a fresh snapshot after a lock wait. Include copied/archive
-- state so narrow alternate mutations also invalidate a stale full-record editor.
create function public.cme_entry_edit_version(p_owner_id uuid, p_entry_id uuid)
returns jsonb
language sql volatile security invoker set search_path = public, pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'id',e.id,'date',e.activity_date,'title',e.title,'reflection',e.reflection,
    'costCents',e.cost_cents,'routineId',e.routine_id,'documentId',e.document_id,
    'sourceUrl',e.source_url,'buckets',to_jsonb(e.buckets),
    'formalPeerReviewHours',coalesce(e.formal_peer_review_hours,0),
    'transcribed',e.transcribed_at is not null,'archived',e.archived_at is not null,
    'allocations',(
      select coalesce(jsonb_agg(jsonb_build_object('category',a.category,'hours',a.hours) order by a.category),'[]'::jsonb)
      from public.cme_allocations a where a.owner_id=p_owner_id and a.entry_id=e.id
    )
  ) from public.cme_entries e where e.owner_id=p_owner_id and e.id=p_entry_id
$$;

create or replace function public.cme_save_entry(p_owner_id uuid,p_year_id uuid,p_entry_id uuid,p_entry jsonb,p_create boolean,p_request_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_year public.cme_years; v_existing public.cme_entries; v_saved public.cme_entries;
  v_routine public.cme_routines; v_alloc jsonb; v_review numeric; v_total numeric; v_count integer;
begin
  if p_owner_id is null or p_year_id is null or p_entry_id is null or p_create is null
    or jsonb_typeof(p_entry) is distinct from 'object' then raise exception 'cme_invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 23092026));
  if p_create and p_request_id is not null then
    select * into v_existing from public.cme_entries where owner_id=p_owner_id and request_id=p_request_id;
    if found then
      if v_existing.request_payload is distinct from p_entry then raise exception 'cme_retry_conflict'; end if;
      return to_jsonb(v_existing) || jsonb_build_object('cme_allocations',(select coalesce(jsonb_agg(jsonb_build_object('category',category,'hours',hours)),'[]') from public.cme_allocations where owner_id=p_owner_id and entry_id=v_existing.id));
    end if;
  end if;
  select * into v_year from public.cme_years where owner_id=p_owner_id and id=p_year_id for update;
  if not found then raise exception 'cme_year_not_confirmed'; end if;
  if v_year.closed_at is not null then raise exception 'cme_year_closed'; end if;
  if extract(year from (p_entry->>'date')::date) <> v_year.year then raise exception 'cme_invalid_request'; end if;
  if not p_create then
    select * into v_existing from public.cme_entries where owner_id=p_owner_id and id=p_entry_id for update;
    if not found then raise exception 'cme_entry_not_found'; end if;
    if v_existing.archived_at is not null then raise exception 'cme_entry_archived'; end if;
    if p_entry->'expectedVersion' is distinct from public.cme_entry_edit_version(p_owner_id,p_entry_id) then raise exception 'cme_entry_conflict'; end if;
    if exists(select 1 from public.cme_years where owner_id=p_owner_id and id=v_existing.year_id and closed_at is not null) then raise exception 'cme_year_closed'; end if;
  end if;
  if jsonb_typeof(p_entry->'allocations') is distinct from 'array' then raise exception 'cme_invalid_request'; end if;
  select count(*),coalesce(sum((a->>'hours')::numeric),0),coalesce(sum((a->>'hours')::numeric) filter(where a->>'category'='reviewing'),0)
    into v_count,v_total,v_review from jsonb_array_elements(p_entry->'allocations') a;
  if v_count not between 1 and 3 or v_total > 24 or coalesce((p_entry->>'formalPeerReviewHours')::numeric,0) not between 0 and v_review then raise exception 'cme_invalid_request'; end if;
  if p_entry->>'documentId' is not null and not exists(select 1 from public.documents where owner_id=p_owner_id and id=(p_entry->>'documentId')::uuid) then raise exception 'cme_invalid_link'; end if;
  if p_entry->>'routineId' is not null then
    select * into v_routine from public.cme_routines where owner_id=p_owner_id and id=(p_entry->>'routineId')::uuid for update;
    if not found or (p_create and v_routine.archived_at is not null) then raise exception 'cme_invalid_link'; end if;
  end if;
  if p_create then
    insert into public.cme_entries(id,owner_id,year_id,activity_date,title,reflection,cost_cents,routine_id,document_id,buckets,formal_peer_review_hours,request_id,request_payload,source_url)
    values(p_entry_id,p_owner_id,p_year_id,(p_entry->>'date')::date,p_entry->>'title',p_entry->>'reflection',(p_entry->>'costCents')::integer,(p_entry->>'routineId')::uuid,(p_entry->>'documentId')::uuid,array(select jsonb_array_elements_text(p_entry->'buckets')),coalesce((p_entry->>'formalPeerReviewHours')::numeric,0),p_request_id,p_entry,p_entry->>'sourceUrl')
    returning * into v_saved;
  else
    update public.cme_entries set year_id=p_year_id,activity_date=(p_entry->>'date')::date,title=p_entry->>'title',reflection=p_entry->>'reflection',cost_cents=(p_entry->>'costCents')::integer,routine_id=(p_entry->>'routineId')::uuid,document_id=(p_entry->>'documentId')::uuid,buckets=array(select jsonb_array_elements_text(p_entry->'buckets')),formal_peer_review_hours=coalesce((p_entry->>'formalPeerReviewHours')::numeric,0),source_url=p_entry->>'sourceUrl'
    where owner_id=p_owner_id and id=p_entry_id returning * into v_saved;
    delete from public.cme_allocations where owner_id=p_owner_id and entry_id=p_entry_id;
  end if;
  for v_alloc in select value from jsonb_array_elements(p_entry->'allocations') loop
    insert into public.cme_allocations(owner_id,entry_id,category,hours) values(p_owner_id,p_entry_id,v_alloc->>'category',(v_alloc->>'hours')::numeric);
  end loop;
  -- A routine advances only after the complete entry is saved, in this same
  -- transaction. An idempotent retry returns above and never advances twice.
  if p_create and v_routine.id is not null and v_routine.next_due is not null and v_routine.next_due <= (p_entry->>'date')::date then
    update public.cme_routines set next_due=((p_entry->>'date')::date + case v_routine.cadence when 'weekly' then interval '7 days' when 'monthly' then interval '1 month' else interval '3 months' end)::date where owner_id=p_owner_id and id=v_routine.id;
  end if;
  return to_jsonb(v_saved)||jsonb_build_object('cme_allocations',p_entry->'allocations');
end $$;

create or replace function public.cme_amend_closed_entry(p_owner_id uuid, p_entry_id uuid, p_entry jsonb, p_reason text)
returns jsonb
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_year public.cme_years; v_existing public.cme_entries; v_saved public.cme_entries; v_routine public.cme_routines;
  v_alloc jsonb; v_review numeric; v_total numeric; v_count integer; v_before jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_owner_id is null or p_entry_id is null or jsonb_typeof(p_entry) is distinct from 'object' then
    raise exception 'cme_invalid_request';
  end if;
  if char_length(v_reason) not between 3 and 1000 then raise exception 'cme_amendment_reason_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 23092026));
  select * into v_existing from public.cme_entries where owner_id=p_owner_id and id=p_entry_id for update;
  if not found then raise exception 'cme_entry_not_found'; end if;
  if v_existing.archived_at is not null then raise exception 'cme_entry_archived'; end if;
  if p_entry->'expectedVersion' is distinct from public.cme_entry_edit_version(p_owner_id,p_entry_id) then raise exception 'cme_entry_conflict'; end if;
  select * into v_year from public.cme_years where owner_id=p_owner_id and id=v_existing.year_id for update;
  if not found then raise exception 'cme_year_not_confirmed'; end if;
  if v_year.closed_at is null then raise exception 'cme_year_open'; end if;
  if extract(year from (p_entry->>'date')::date) <> v_year.year then raise exception 'cme_invalid_request'; end if;
  if jsonb_typeof(p_entry->'allocations') is distinct from 'array' then raise exception 'cme_invalid_request'; end if;
  select count(*),coalesce(sum((a->>'hours')::numeric),0),coalesce(sum((a->>'hours')::numeric) filter(where a->>'category'='reviewing'),0)
    into v_count,v_total,v_review from jsonb_array_elements(p_entry->'allocations') a;
  if v_count not between 1 and 3 or v_total > 24 or coalesce((p_entry->>'formalPeerReviewHours')::numeric,0) not between 0 and v_review then raise exception 'cme_invalid_request'; end if;
  if p_entry->>'documentId' is not null and not exists(select 1 from public.documents where owner_id=p_owner_id and id=(p_entry->>'documentId')::uuid) then raise exception 'cme_invalid_link'; end if;
  if p_entry->>'routineId' is not null then
    select * into v_routine from public.cme_routines where owner_id=p_owner_id and id=(p_entry->>'routineId')::uuid;
    if not found then raise exception 'cme_invalid_link'; end if;
  end if;

  v_before := jsonb_build_object(
    'date', v_existing.activity_date, 'title', v_existing.title, 'reflection', v_existing.reflection,
    'costCents', v_existing.cost_cents, 'routineId', v_existing.routine_id, 'documentId', v_existing.document_id,
    'sourceUrl', v_existing.source_url, 'buckets', to_jsonb(v_existing.buckets),
    'formalPeerReviewHours', v_existing.formal_peer_review_hours,
    'allocations', (
      select coalesce(jsonb_agg(jsonb_build_object('category', category, 'hours', hours) order by category), '[]'::jsonb)
      from public.cme_allocations where owner_id=p_owner_id and entry_id=p_entry_id
    )
  );
  insert into public.cme_year_amendments(owner_id, year_id, entry_id, reason, before, after)
  values (
    p_owner_id, v_year.id, p_entry_id, v_reason, v_before,
    jsonb_build_object(
      'date', p_entry->'date', 'title', p_entry->'title', 'reflection', p_entry->'reflection',
      'costCents', p_entry->'costCents', 'routineId', p_entry->'routineId', 'documentId', p_entry->'documentId',
      'sourceUrl', p_entry->'sourceUrl', 'buckets', p_entry->'buckets',
      'formalPeerReviewHours', coalesce(p_entry->'formalPeerReviewHours', '0'::jsonb),
      'allocations', p_entry->'allocations'
    )
  );

  update public.cme_entries set activity_date=(p_entry->>'date')::date,title=p_entry->>'title',reflection=p_entry->>'reflection',cost_cents=(p_entry->>'costCents')::integer,routine_id=(p_entry->>'routineId')::uuid,document_id=(p_entry->>'documentId')::uuid,buckets=array(select jsonb_array_elements_text(p_entry->'buckets')),formal_peer_review_hours=coalesce((p_entry->>'formalPeerReviewHours')::numeric,0),source_url=p_entry->>'sourceUrl'
  where owner_id=p_owner_id and id=p_entry_id returning * into v_saved;
  delete from public.cme_allocations where owner_id=p_owner_id and entry_id=p_entry_id;
  for v_alloc in select value from jsonb_array_elements(p_entry->'allocations') loop
    insert into public.cme_allocations(owner_id,entry_id,category,hours) values(p_owner_id,p_entry_id,v_alloc->>'category',(v_alloc->>'hours')::numeric);
  end loop;
  return to_jsonb(v_saved)||jsonb_build_object('cme_allocations',p_entry->'allocations');
end $$;

-- Versioned names prevent new app/old database overlap from silently ignoring the guard.
create function public.cme_save_entry_v2(p_owner_id uuid,p_year_id uuid,p_entry_id uuid,p_entry jsonb,p_create boolean,p_request_id uuid default null)
returns jsonb language sql volatile security invoker set search_path = public, pg_catalog, pg_temp as $$
  select public.cme_save_entry(p_owner_id,p_year_id,p_entry_id,p_entry,p_create,p_request_id)
$$;
create function public.cme_amend_closed_entry_v2(p_owner_id uuid,p_entry_id uuid,p_entry jsonb,p_reason text)
returns jsonb language sql volatile security invoker set search_path = public, pg_catalog, pg_temp as $$
  select public.cme_amend_closed_entry(p_owner_id,p_entry_id,p_entry,p_reason)
$$;

revoke all on function
  public.cme_entry_edit_version(uuid,uuid),
  public.cme_save_entry(uuid,uuid,uuid,jsonb,boolean,uuid),
  public.cme_amend_closed_entry(uuid,uuid,jsonb,text),
  public.cme_save_entry_v2(uuid,uuid,uuid,jsonb,boolean,uuid),
  public.cme_amend_closed_entry_v2(uuid,uuid,jsonb,text)
from public, anon, authenticated;
grant execute on function
  public.cme_entry_edit_version(uuid,uuid),
  public.cme_save_entry(uuid,uuid,uuid,jsonb,boolean,uuid),
  public.cme_amend_closed_entry(uuid,uuid,jsonb,text),
  public.cme_save_entry_v2(uuid,uuid,uuid,jsonb,boolean,uuid),
  public.cme_amend_closed_entry_v2(uuid,uuid,jsonb,text)
to service_role;
alter function public.cme_entry_edit_version(uuid,uuid) owner to postgres;
alter function public.cme_save_entry_v2(uuid,uuid,uuid,jsonb,boolean,uuid) owner to postgres;
alter function public.cme_amend_closed_entry_v2(uuid,uuid,jsonb,text) owner to postgres;
