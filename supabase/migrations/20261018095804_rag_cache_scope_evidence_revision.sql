-- DRAFT. Merge only inside the owner's approved database-change window, and only after
-- 20261018082910_audit_durable_recovery_pairing_and_cache_fences.sql (it replaces that
-- migration's rag_cache_scope_revision_v1). Owner approval: 17:55 AWST 2026-10-18, relayed by Grok Bot.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Cached answers and searches were keyed by a revision that hashed only document rows, so an
-- edit to a table fact or image (threshold, action, caption, relevance, searchability, ...)
-- left the revision unchanged and stale evidence could be served from cache. Each document now
-- carries an evidence counter, bumped in the writing transaction by statement-level triggers
-- whenever a retrieval-relevant fact or image row is inserted, deleted or changed. The scope
-- revision stays a single pass over documents plus one keyed join: no per-request scan of
-- facts or images.
create table public.document_evidence_revisions (
  document_id uuid primary key references public.documents(id) on delete cascade,
  revision bigint not null default 0
);
alter table public.document_evidence_revisions owner to postgres;
alter table public.document_evidence_revisions enable row level security;
revoke all on table public.document_evidence_revisions from public, anon, authenticated;
grant all on table public.document_evidence_revisions to service_role;

-- Bumps once per touched document per statement. Documents removed in the same statement
-- (cascade from public.documents) are skipped; their rows leave the scope revision anyway.
create function public.bump_document_evidence_revisions(p_document_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  insert into public.document_evidence_revisions as r(document_id, revision)
  select d.id, 1
  from public.documents d
  where d.id = any(p_document_ids)
  order by d.id
  on conflict (document_id) do update set revision = r.revision + 1
$$;
alter function public.bump_document_evidence_revisions(uuid[]) owner to postgres;
revoke all on function public.bump_document_evidence_revisions(uuid[]) from public, anon, authenticated;

-- Retrieval-relevant means every stored column except created_at (and generated search_tsv,
-- which follows its sources). A no-op UPDATE does not bump the counter.
create function public.document_evidence_rows_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.bump_document_evidence_revisions(array(select distinct n.document_id from new_rows n));
  elsif tg_op = 'DELETE' then
    perform public.bump_document_evidence_revisions(array(select distinct o.document_id from old_rows o));
  else
    perform public.bump_document_evidence_revisions(array(
      select distinct x.document_id from (
        select o.document_id as old_document_id, n.document_id as new_document_id
        from old_rows o join new_rows n on n.id = o.id
        where (pg_catalog.to_jsonb(o) - array['created_at','search_tsv'])
          is distinct from (pg_catalog.to_jsonb(n) - array['created_at','search_tsv'])
      ) changed
      cross join lateral (values (changed.old_document_id), (changed.new_document_id)) x(document_id)
    ));
  end if;
  return null;
end $$;
alter function public.document_evidence_rows_changed() owner to postgres;
revoke all on function public.document_evidence_rows_changed() from public, anon, authenticated;

create trigger document_table_facts_evidence_insert after insert on public.document_table_facts
  referencing new table as new_rows for each statement execute function public.document_evidence_rows_changed();
create trigger document_table_facts_evidence_update after update on public.document_table_facts
  referencing old table as old_rows new table as new_rows for each statement execute function public.document_evidence_rows_changed();
create trigger document_table_facts_evidence_delete after delete on public.document_table_facts
  referencing old table as old_rows for each statement execute function public.document_evidence_rows_changed();
create trigger document_images_evidence_insert after insert on public.document_images
  referencing new table as new_rows for each statement execute function public.document_evidence_rows_changed();
create trigger document_images_evidence_update after update on public.document_images
  referencing old table as old_rows new table as new_rows for each statement execute function public.document_evidence_rows_changed();
create trigger document_images_evidence_delete after delete on public.document_images
  referencing old table as old_rows for each statement execute function public.document_evidence_rows_changed();

-- Same signature, digest shape and grants; each document's row hash now also carries its
-- evidence counter.
create or replace function public.rag_cache_scope_revision_v1(p_owner_id uuid, p_include_public boolean, p_document_ids uuid[] default null)
returns text language sql stable security invoker set search_path = '' as $$
  select 'rag-cache-scope-v1:' || pg_catalog.md5(coalesce(pg_catalog.string_agg(row_hash, '' order by id),''))
  from (
    select d.id, pg_catalog.md5(pg_catalog.jsonb_build_array(d.id,d.owner_id,d.status,d.updated_at,d.metadata,d.index_generation_id,
      coalesce(r.revision, 0))::text) as row_hash
    from public.documents d
    left join public.document_evidence_revisions r on r.document_id = d.id
    where (d.owner_id = p_owner_id or (coalesce(p_include_public,false) and d.owner_id is null))
      and (coalesce(cardinality(p_document_ids),0) = 0 or d.id = any(p_document_ids))
  ) revision
$$;
alter function public.rag_cache_scope_revision_v1(uuid,boolean,uuid[]) owner to postgres;
revoke all on function public.rag_cache_scope_revision_v1(uuid,boolean,uuid[]) from public, anon, authenticated;
grant execute on function public.rag_cache_scope_revision_v1(uuid,boolean,uuid[]) to service_role;
