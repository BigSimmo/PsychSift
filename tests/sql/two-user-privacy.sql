-- Two-user privacy behaviour test. Signs in as two different synthetic doctors (A and B) and
-- proves, by actually querying, that neither can see or change the other's rows.
--
-- Part 1  Browser roles fail closed. The signed-in role (`authenticated`) and the public role
--         (`anon`) hold no table, view or sequence privilege in `public`, so every read and
--         write a browser could attempt is refused. All Work mode data (roster, on call, CPD,
--         teaching, admin) is reachable only through server routes; this proves the database
--         itself gives a browser nothing to read around them.
-- Part 2  The only functions a browser role may call are the known allowlist, and the
--         administrator-only ones refuse an ordinary signed-in doctor.
-- Part 3  Defence in depth. Every owner policy written for the browser roles is exercised as
--         if a future change granted access: each doctor sees only their own rows, cannot
--         change or delete the other's, and cannot plant a row in the other's name.
--
-- Run with psql ON_ERROR_STOP against a disposable database replayed from schema.sql or the
-- migration chain (`npm run test:sql`, or the Migration replay CI job). Never against a live
-- database. Synthetic fixtures and every grant roll back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '120s';

create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
select pg_temp.assert_true(not exists (select 1 from public.documents), 'requires an empty disposable database');

-- The administrator functions read auth.jwt(). The emulator and hosted platform ship it; the
-- bare-image runner (scripts/test-sql-behaviour.ts) adds the platform definition first.
select pg_temp.assert_true(to_regprocedure('auth.jwt()') is not null,
  'auth.jwt() is missing: run through npm run test:sql, which installs the platform definition');

create temp table people (k text primary key, id uuid not null) on commit drop;
insert into people values
  ('a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into auth.users(id, email) select id, 'doctor-' || k || '@example.org' from people;
grant select on people to anon, authenticated;

-- Act as a signed-in doctor (or as the public role when p_user is null), the way PostgREST
-- does: role plus JWT claims. Both claim spellings are set because the bare image's auth.uid()
-- reads request.jwt.claim.sub and the platform's reads request.jwt.claims.
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_user is null then '{"role":"anon"}'
         else pg_catalog.json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text end, true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
end $$;
create function pg_temp.uid(p_k text) returns uuid language sql stable as $$ select id from people where k = p_k $$;
grant execute on function pg_temp.assert_true(boolean, text), pg_temp.uid(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Part 1: browser roles fail closed on every public relation and sequence.
-- ---------------------------------------------------------------------------------------------
select pg_temp.assert_true(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace, (values ('anon'), ('authenticated')) r(role)
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_table_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
), 'a browser role holds a privilege on a public table or view: ' || coalesce((
  select string_agg(r.role || ' on ' || c.oid::regclass::text, ', ')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace, (values ('anon'), ('authenticated')) r(role)
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_table_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')), ''));
select pg_temp.assert_true(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace, (values ('anon'), ('authenticated')) r(role)
  where n.nspname = 'public' and c.relkind = 'S' and has_sequence_privilege(r.role, c.oid, 'USAGE,SELECT,UPDATE')
), 'a browser role holds a privilege on a public sequence');

-- The catalogue says no; now prove it by trying every read and write as each doctor and as
-- the public role. Permission is checked before any row or constraint, so empty statements
-- are enough to provoke the refusal.
create function pg_temp.expect_refused_everywhere(p_who text) returns integer language plpgsql as $$
declare r record; v_checked integer := 0;
begin
  for r in
    select c.oid::regclass::text as rel, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and not c.relispartition
    order by 1
  loop
    begin
      execute format('select 1 from %s limit 1', r.rel);
      raise exception 'PRIVACY LEAK: % can read %', p_who, r.rel;
    exception when insufficient_privilege then null;
    end;
    if r.relkind in ('r', 'p') then
      begin
        execute format('insert into %s default values', r.rel);
        raise exception 'PRIVACY LEAK: % can insert into %', p_who, r.rel;
      exception when insufficient_privilege then null;
      end;
      begin
        execute format('delete from %s where false', r.rel);
        raise exception 'PRIVACY LEAK: % can delete from %', p_who, r.rel;
      exception when insufficient_privilege then null;
      end;
    end if;
    v_checked := v_checked + 1;
  end loop;
  return v_checked;
end $$;
grant execute on function pg_temp.expect_refused_everywhere(text) to anon, authenticated;

select pg_temp.act_as(pg_temp.uid('a'));
select pg_temp.assert_true(pg_temp.expect_refused_everywhere('doctor A') > 100,
  'expected to probe every public table as doctor A');
reset role;
select pg_temp.act_as(pg_temp.uid('b'));
select pg_temp.assert_true(pg_temp.expect_refused_everywhere('doctor B') > 100,
  'expected to probe every public table as doctor B');
reset role;
select pg_temp.act_as(null);
select pg_temp.assert_true(pg_temp.expect_refused_everywhere('the public role') > 100,
  'expected to probe every public table as the public role');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Part 2: callable functions are an explicit allowlist, and admin-only ones refuse a doctor.
-- ---------------------------------------------------------------------------------------------
select pg_temp.assert_true(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
), 'the public role can call a public function: ' || coalesce((
  select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')), ''));
-- Exact signatures, so a new overload that reuses an allowed name is still caught.
create temp table allowed_browser_functions(signature text primary key, reason text not null);
insert into allowed_browser_functions values
  ('admit_administrator_document(jsonb,jsonb,boolean)', 'administrator plus recent sign-in, checked inside'),
  ('publish_site_content_record(text,uuid,text,bigint,text,text,text)', 'administrator, checked inside'),
  ('record_site_content_reconciliation_plan(jsonb)', 'administrator, checked inside'),
  ('retire_site_content_record(text,uuid,text,bigint,text,text,text)', 'administrator, checked inside'),
  ('is_visible_document_page(uuid,uuid,text)', 'pure helper for the page policy, reads nothing');
create temp view browser_callable_functions as
  select replace(p.oid::regprocedure::text, ' ', '') as signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE');
select pg_temp.assert_true(not exists (
  select 1 from browser_callable_functions c
  where c.signature not in (select replace('public.' || signature, ' ', '') from allowed_browser_functions)
    and c.signature not in (select replace(signature, ' ', '') from allowed_browser_functions)
), 'a signed-in doctor can call a function outside the reviewed allowlist: ' || coalesce((
  select string_agg(c.signature, ', ') from browser_callable_functions c
  where c.signature not in (select replace('public.' || signature, ' ', '') from allowed_browser_functions)
    and c.signature not in (select replace(signature, ' ', '') from allowed_browser_functions)), ''));
select pg_temp.assert_true(not (select prosecdef from pg_proc where oid = 'public.is_visible_document_page(uuid, uuid, text)'::regprocedure),
  'is_visible_document_page must stay an ordinary (not SECURITY DEFINER) helper');

create function pg_temp.expect_admin_refusal(p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like '%administrator%' then
      raise exception 'expected an administrator refusal, got "%" from %', sqlerrm, p_sql;
    end if;
    return;
  end;
  raise exception 'PRIVACY LEAK: an ordinary doctor ran an administrator function: %', p_sql;
end $$;
grant execute on function pg_temp.expect_admin_refusal(text) to authenticated;

select pg_temp.act_as(pg_temp.uid('b'));
select pg_temp.expect_admin_refusal($q$select public.admit_administrator_document('{}'::jsonb, '{}'::jsonb, false)$q$);
select pg_temp.expect_admin_refusal($q$select * from public.publish_site_content_record('service', gen_random_uuid(), 'v', 0, null, null, null)$q$);
select pg_temp.expect_admin_refusal($q$select * from public.retire_site_content_record('service', gen_random_uuid(), 'v', 0, null, null, null)$q$);
select pg_temp.expect_admin_refusal($q$select public.record_site_content_reconciliation_plan('{}'::jsonb)$q$);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Part 3: owner policies, exercised as if a browser grant existed. Each doctor gets a full set
-- of synthetic rows, written as the database owner so no policy helps or hinders the fixture.
-- ---------------------------------------------------------------------------------------------
insert into public.documents(id, owner_id, title, file_name, file_type, storage_path, status)
select id, id, 'Synthetic privacy fixture', 'fixture.txt', 'text/plain', id || '/fixture.txt', 'indexed' from people;
insert into public.document_pages(document_id, page_number) select id, 1 from public.documents;
insert into public.document_images(document_id, storage_path) select id, owner_id || '/image.png' from public.documents;
insert into public.document_labels(document_id, owner_id, label, label_type, source)
select id, owner_id, 'fixture', 'custom', 'manual' from public.documents;
insert into public.document_summaries(document_id, owner_id, summary) select id, owner_id, 'Synthetic summary' from public.documents;
insert into public.document_sections(document_id, owner_id, section_index, heading)
select id, owner_id, 0, 'Synthetic section' from public.documents;
insert into public.document_memory_cards(document_id, owner_id, card_type, title, content, embedding)
select id, owner_id, 'definition', 'Synthetic card', 'Fixture', array_fill(0.1::real, array[1536])::extensions.vector
from public.documents;
insert into public.document_chunks(document_id, chunk_index, content, embedding)
select id, 0, 'Synthetic chunk', array_fill(0.1::real, array[1536])::extensions.vector from public.documents;
insert into public.document_table_facts(document_id, owner_id, row_label) select id, owner_id, 'Synthetic fact' from public.documents;
insert into public.document_embedding_fields(document_id, owner_id, field_type, content, content_hash, embedding)
select id, owner_id, 'document_title', 'Synthetic title', md5(id::text), array_fill(0.1::real, array[1536])::extensions.vector
from public.documents;
insert into public.document_index_quality(document_id, owner_id) select id, owner_id from public.documents;
insert into public.document_index_units(document_id, owner_id, unit_type, title, content, embedding)
select id, owner_id, 'document_profile', 'Synthetic unit', 'Fixture', array_fill(0.1::real, array[1536])::extensions.vector
from public.documents;
insert into public.ingestion_jobs(document_id) select id from public.documents;
insert into public.import_batches(owner_id, name) select id, 'Synthetic batch' from people;
insert into public.image_caption_cache(owner_id, image_hash, model, caption) select id, md5(id::text), 'fixture', 'Synthetic' from people;
insert into public.rag_queries(owner_id, query) select id, 'synthetic query' from people;
insert into public.rag_query_misses(owner_id, query, normalized_query) select id, 'synthetic miss', 'synthetic miss' from people;
insert into public.rag_aliases(owner_id, alias, canonical, alias_type) select id, 'fx' || k, 'fixture', 'custom' from people;
insert into public.rag_aliases(owner_id, alias, canonical, alias_type) values (null, 'fxshared', 'fixture', 'custom');
insert into public.rag_retrieval_logs(owner_id, query) select id, 'synthetic log' from people;
insert into public.storage_cleanup_jobs(owner_id, document_paths)
select id, array[id || '/orphan.txt'] from people;
insert into public.user_favourite_sets(user_id, name) select id, 'Synthetic set' from people;
insert into public.user_favourites(user_id, content_type, content_key) select id, 'form', 'fixture-form' from people;
insert into public.user_preferences(user_id) select id from people;
insert into storage.objects(bucket_id, name, owner)
select b, id || '/fixture.' || b, id from people, (values ('clinical-documents'), ('clinical-images')) v(b);

-- How to tell whose row it is, per table. `$me` is the acting doctor; shared rows (an alias with
-- no owner) count as the actor's own. Every table carrying a browser-role policy must be listed
-- here, so a new owner policy cannot ship without two-user coverage.
create temp table owner_rule (
  rel regclass primary key,
  owner_expr text not null,
  owner_col text,
  update_col text default null
) on commit drop;
insert into owner_rule values
  ('public.documents', 'owner_id', 'owner_id', null),
  ('public.document_pages', '(select d.owner_id from public.documents d where d.id = document_id)', null, null),
  ('public.document_images', '(select d.owner_id from public.documents d where d.id = document_id)', null, null),
  ('public.document_chunks', '(select d.owner_id from public.documents d where d.id = document_id)', null, null),
  ('public.document_table_facts', '(select d.owner_id from public.documents d where d.id = document_id)', null, null),
  ('public.document_embedding_fields', '(select d.owner_id from public.documents d where d.id = document_id)', null, null),
  ('public.document_index_units', '(select d.owner_id from public.documents d where d.id = document_id)', null, null),
  ('public.ingestion_jobs', '(select d.owner_id from public.documents d where d.id = document_id)', null, null),
  ('public.document_labels', 'owner_id', 'owner_id', null),
  ('public.document_summaries', 'owner_id', 'owner_id', null),
  ('public.document_sections', 'owner_id', 'owner_id', null),
  ('public.document_memory_cards', 'owner_id', 'owner_id', null),
  ('public.document_index_quality', 'owner_id', 'owner_id', null),
  ('public.import_batches', 'owner_id', 'owner_id', null),
  ('public.image_caption_cache', 'owner_id', 'owner_id', null),
  ('public.rag_queries', 'owner_id', 'owner_id', null),
  ('public.rag_query_misses', 'owner_id', 'owner_id', null),
  ('public.rag_aliases', 'coalesce(owner_id, $me)', 'owner_id', null),
  ('public.rag_retrieval_logs', 'owner_id', 'owner_id', null),
  ('public.storage_cleanup_jobs', 'owner_id', 'owner_id', null),
  ('public.user_favourite_sets', 'user_id', 'user_id', null),
  ('public.user_favourites', 'user_id', 'user_id', null),
  ('public.user_preferences', 'user_id', 'user_id', null),
  ('storage.objects', '(storage.foldername(name))[1]::uuid', null, 'metadata');
grant select on owner_rule to authenticated;

-- A policy with no TO clause is stored as PUBLIC (role oid 0) and applies to both browser roles.
-- Extension schemas (pg_cron's own cron.job policies) are outside the app's data and not checked.
select pg_temp.assert_true(not exists (
  select distinct p.polrelid from pg_policy p
  where exists (select 1 from unnest(p.polroles) r where r = 0 or r in ('anon'::regrole, 'authenticated'::regrole))
    and (select c.relnamespace from pg_class c where c.oid = p.polrelid) in ('public'::regnamespace, 'storage'::regnamespace)
    and p.polrelid not in (select rel from owner_rule)
    -- A blanket deny is not an owner policy: it is proved by the refusal check further down.
    and p.polname <> 'cme_evidence_no_direct_access'
), 'a browser-role policy has no two-user coverage here; add its table to owner_rule: ' || coalesce((
  select string_agg(distinct p.polrelid::regclass::text, ', ') from pg_policy p
  where exists (select 1 from unnest(p.polroles) r where r = 0 or r in ('anon'::regrole, 'authenticated'::regrole))
    and (select c.relnamespace from pg_class c where c.oid = p.polrelid) in ('public'::regnamespace, 'storage'::regnamespace)
    and p.polrelid not in (select rel from owner_rule) and p.polname <> 'cme_evidence_no_direct_access'), ''));

-- Simulate the broadest browser grant a future change could add. Rolled back with everything else.
do $$ declare r record; begin
  for r in select rel from owner_rule loop
    execute format('grant select, insert, update, delete on %s to authenticated', r.rel);
  end loop;
end $$;

-- Totals as the owner, before either doctor acts.
-- Known gap, recorded rather than hidden: these owner policies check only owner_id, not that the
-- parent document is yours. Browser roles have no grant on these tables (part 1), so nothing can
-- reach this today. The test fails if this list stops matching what the probe finds.
create temp table known_parent_document_gap(rel regclass primary key);
insert into known_parent_document_gap values
  ('public.document_labels'), ('public.document_memory_cards'), ('public.document_sections');
create temp table parent_document_gap_seen(rel regclass primary key);
grant select on known_parent_document_gap to authenticated;
grant select, insert on parent_document_gap_seen to authenticated;
create temp table owner_totals on commit drop as select rel, 0::bigint as total from owner_rule;
do $$ declare r record; v bigint; begin
  for r in select rel from owner_rule loop
    execute format('select count(*) from %s', r.rel) into v;
    update owner_totals set total = v where rel = r.rel;
  end loop;
end $$;

create function pg_temp.check_isolation(p_me text, p_other text) returns void language plpgsql as $$
declare r record; v_me uuid := pg_temp.uid(p_me); v_other uuid := pg_temp.uid(p_other);
  v_own bigint; v_foreign bigint; v_rows bigint; v_expr text;
  v_base jsonb; v_row jsonb; v_cols text; v_refused boolean; v_variant int; v_detail text;
begin
  for r in select rel, owner_expr, owner_col, update_col from owner_rule order by rel::text loop
    v_expr := replace(r.owner_expr, '$me', quote_literal(v_me) || '::uuid');
    execute format('select count(*) filter (where %1$s = %2$L::uuid), count(*) filter (where %1$s is distinct from %2$L::uuid) from %3$s',
      v_expr, v_me, r.rel) into v_own, v_foreign;
    if v_own = 0 then raise exception 'doctor % cannot see their own rows in % (fixture or policy is broken)', p_me, r.rel; end if;
    if v_foreign > 0 then raise exception 'PRIVACY LEAK: doctor % can see % of doctor %''s rows in %', p_me, v_foreign, p_other, r.rel; end if;

    -- Changing or deleting the other doctor's rows must touch nothing.
    begin
      execute format('update %s set %I = %I where %s = %L::uuid',
        r.rel, coalesce(r.update_col, r.owner_col, 'document_id'),
        coalesce(r.update_col, r.owner_col, 'document_id'), v_expr, v_other);
      get diagnostics v_rows = row_count;
      if v_rows > 0 then raise exception 'PRIVACY LEAK: doctor % changed % of doctor %''s rows in %', p_me, v_rows, p_other, r.rel; end if;
    exception when insufficient_privilege then null;
    end;
    -- An INSERT policy must not let a doctor plant a new row in the other doctor's name, or hang
    -- their own row off the other doctor's document. Clone one of your own rows and insert it twice:
    -- first with everything (owner column, parent document, storage folder) pointed at the other
    -- doctor, then, where the row has both an owner column and a parent document, with only the
    -- parent document moved. Only a row-level security refusal counts: Postgres checks the policy
    -- before constraints, so any other error or a success means the policy let the row through.
    -- A successful insert is undone straight away so row totals stay exact.
    -- Fixture documents share their owner's id, so the other doctor's document id is v_other.
    -- Storage objects are probed once per bucket, so a policy scoped to one bucket can't hide.
    for v_base in execute format(
      'select distinct on (%3$s) to_jsonb(t) from %1$s t where %2$s = %4$L::uuid order by %3$s',
      r.rel, v_expr, case when r.rel = 'storage.objects'::regclass then 't.bucket_id' else '1' end, v_me) loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
    where a.attrelid = r.rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and a.attidentity = '' and a.attname <> 'id';
    for v_variant in 1..(case when r.owner_col is not null and v_base ? 'document_id' then 2 else 1 end) loop
      v_row := v_base;
      if r.owner_col is not null and v_variant = 1 then v_row := v_row || jsonb_build_object(r.owner_col, v_other); end if;
      if v_row ? 'document_id' then v_row := v_row || jsonb_build_object('document_id', v_other); end if;
      if r.rel = 'storage.objects'::regclass then
        v_row := v_row || jsonb_build_object('name', v_other || '/planted-' || (v_base->>'bucket_id') || '.txt', 'owner', v_other);
      end if;
      v_refused := false; v_detail := null;
      begin
        execute format('insert into %1$s (%2$s) select %2$s from jsonb_populate_record(null::%1$s, %3$L::jsonb)',
          r.rel, v_cols, v_row);
        raise exception using errcode = 'PX001', message = 'probe row inserted';
      exception
        when insufficient_privilege then v_refused := true;
        when sqlstate 'PX001' then null;
        when others then
          -- A non-policy error means the policy already let the row through.
          if v_variant = 2 then
            v_detail := sqlerrm;
          else
            raise exception 'PRIVACY LEAK: doctor %''s row for doctor % got past the % insert policy (then: %)',
              p_me, p_other, r.rel, sqlerrm;
          end if;
      end;
      if not v_refused and v_variant = 2 and r.rel in (select rel from known_parent_document_gap) then
        insert into parent_document_gap_seen values (r.rel) on conflict do nothing;
      elsif not v_refused and v_variant = 2 then
        raise exception 'PRIVACY LEAK: doctor % attached their own row to doctor %''s document in % (then: %)',
          p_me, p_other, r.rel, coalesce(v_detail, 'inserted');
      elsif not v_refused then
        raise exception 'PRIVACY LEAK: doctor % inserted a row for doctor % in %', p_me, p_other, r.rel;
      end if;
    end loop;
    end loop;

    begin
      execute format('delete from %s where %s is distinct from %L::uuid', r.rel, v_expr, v_me);
      get diagnostics v_rows = row_count;
      if v_rows > 0 then raise exception 'PRIVACY LEAK: doctor % deleted % of doctor %''s rows in %', p_me, v_rows, p_other, r.rel; end if;
    exception when insufficient_privilege then null;
    end;

    -- Handing your own row to the other doctor (planting data in their name) must be refused.
    if r.owner_col is not null and r.rel <> 'public.rag_aliases'::regclass then
      begin
        execute format('update %s set %I = %L::uuid where %I = %L::uuid', r.rel, r.owner_col, v_other, r.owner_col, v_me);
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          raise exception 'PRIVACY LEAK: doctor % moved % row(s) into doctor %''s name in %', p_me, v_rows, p_other, r.rel;
        end if;
      exception when insufficient_privilege then null;
      end;
    end if;
  end loop;
end $$;
grant execute on function pg_temp.check_isolation(text, text) to authenticated;

select pg_temp.act_as(pg_temp.uid('a'));
select pg_temp.check_isolation('a', 'b');
reset role;
select pg_temp.act_as(pg_temp.uid('b'));
select pg_temp.check_isolation('b', 'a');
reset role;

-- Nothing either doctor did above added, removed or reassigned anyone's rows.
do $$ declare r record; v bigint; begin
  for r in select t.rel, t.total from owner_totals t loop
    execute format('select count(*) from %s', r.rel) into v;
    if v is distinct from r.total then
      raise exception 'PRIVACY LEAK: row count in % changed from % to % while the doctors probed it', r.rel, r.total, v;
    end if;
  end loop;
end $$;
select pg_temp.assert_true((select count(*) from public.documents where owner_id = pg_temp.uid('a')) = 1
  and (select count(*) from public.documents where owner_id = pg_temp.uid('b')) = 1,
  'each doctor must still own exactly their own document');

-- The parent-document gap list must match what the probe found, both ways: a new gap fails, and a
-- fixed policy fails until its table comes off the list.
select pg_temp.assert_true(not exists (
  (select rel from known_parent_document_gap except select rel from parent_document_gap_seen)
  union all
  (select rel from parent_document_gap_seen except select rel from known_parent_document_gap)
), 'known_parent_document_gap no longer matches the probe; found: ' || coalesce((
  select string_agg(rel::text, ', ' order by rel::text) from parent_document_gap_seen), 'none'));

select 'TWO_USER_PRIVACY_SQL_PASS: browser roles fail closed on every table, function allowlist, '
  || 'admin functions refuse doctors, owner policies isolate two doctors (3 known parent-document gaps)' as result;
rollback;
