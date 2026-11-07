-- Permanent document removal also removes reconstructable ingestion evidence.
-- Active/rollback evidence remains immutable while its parent document exists.
-- This drafts no age-based retention, legal hold, historical orphan sweep or backup purge.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function ingestion_generation_evidence.immutable() returns trigger
language plpgsql set search_path='' as $$ declare worker text; attempt jsonb; begin
  -- A real parent deletion is the only lifecycle exception. No caller-controlled bypass.
  if tg_op='DELETE' then
    if tg_table_schema='ingestion_generation_evidence' and tg_level='ROW'
      and pg_catalog.pg_trigger_depth() > 1 and current_user='postgres'
      and not exists (select 1 from public.documents d where d.id=old.document_id) then
      return old;
    end if;
  end if;
  if tg_table_name='candidates' and tg_op='UPDATE' then
    if old.expected_inventory_digest is null
      and new.expected_inventory_digest ~ '^sha256:[0-9a-f]{64}$'
      and to_jsonb(old)-'expected_inventory_digest'=to_jsonb(new)-'expected_inventory_digest'
      and current_user='postgres' then return new; end if;
    if current_user='postgres' and old.source_section_layout is null and old.source_section_layout_bytes is null
      and old.source_section_layout_digest is null and new.source_section_layout is not null
      and new.source_section_layout_bytes is not null and new.source_section_layout_digest is not null
      and to_jsonb(old)-array['source_section_layout','source_section_layout_bytes','source_section_layout_digest']
        =to_jsonb(new)-array['source_section_layout','source_section_layout_bytes','source_section_layout_digest'] then
      select locked_by into worker from public.ingestion_jobs where id=old.job_id and document_id=old.document_id;
      attempt:=public.assert_current_ingestion_attempt(jsonb_build_object('job_kind','node','job_id',old.job_id,
        'document_id',old.document_id,'worker_id',worker,'lease_token',old.first_lease_token,
        'expected_generation_id',old.predecessor_generation_id,'authority_digest',old.authority_digest),old.generation_id);
      if attempt is not null then
        perform ingestion_generation_evidence.assert_admin_text_source_section_layout(new::ingestion_generation_evidence.candidates);
        return new;
      end if;
    end if;
  end if;
  raise exception 'immutable_ingestion_generation_evidence' using errcode='23514';
end $$;

alter function ingestion_generation_evidence.immutable() owner to postgres;
revoke all on function ingestion_generation_evidence.immutable() from public, anon, authenticated, service_role;

create or replace function ingestion_generation_evidence.purge_deleted_document()
returns trigger
language plpgsql security definer
set search_path = ''
as $purge$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'documents' or tg_op <> 'DELETE'
    or tg_when <> 'AFTER' or tg_level <> 'ROW'
    or exists (select 1 from public.documents d where d.id = old.id) then
    raise exception 'permanent_document_delete_required' using errcode = '23514';
  end if;
  -- Child-first order preserves all existing FK and immutability constraints.
  delete from ingestion_generation_evidence.managed_vector_final_receipts where document_id = old.id;
  delete from ingestion_generation_evidence.managed_vector_chunk_rows where document_id = old.id;
  delete from ingestion_generation_evidence.managed_vector_field_rows where document_id = old.id;
  delete from ingestion_generation_evidence.managed_vector_index_rows where document_id = old.id;
  delete from ingestion_generation_evidence.scoped_projection_artifacts where document_id = old.id;
  delete from ingestion_generation_evidence.visual_unit_rows where document_id = old.id;
  delete from ingestion_generation_evidence.visual_unit_expectations where document_id = old.id;
  delete from ingestion_generation_evidence.scoped_projection_rows where document_id = old.id;
  delete from ingestion_generation_evidence.scoped_projection_expectations where document_id = old.id;
  delete from ingestion_generation_evidence.retained_artifacts where document_id = old.id;
  delete from ingestion_generation_evidence.outcomes where document_id = old.id;
  delete from ingestion_generation_evidence.unit_declarations where document_id = old.id;
  delete from ingestion_generation_evidence.producer_declarations where document_id = old.id;
  delete from ingestion_generation_evidence.prerequisite_accounting where document_id = old.id;
  delete from ingestion_generation_evidence.candidate_chunk_rows where document_id = old.id;
  delete from ingestion_generation_evidence.managed_vector_packets where document_id = old.id;
  delete from ingestion_generation_evidence.candidates where document_id = old.id;
  return old;
end;
$purge$;
alter function ingestion_generation_evidence.purge_deleted_document() owner to postgres;
revoke all on function ingestion_generation_evidence.purge_deleted_document() from public, anon, authenticated, service_role;
create trigger purge_private_ingestion_evidence_after_document_delete
  after delete on public.documents for each row
  execute function ingestion_generation_evidence.purge_deleted_document();

-- Serialize permanent document deletion with ingestion job creation. The
-- parent row lock conflicts with the FK key-share lock taken by a concurrent
-- ingestion_jobs insert: either the job commits first and deletion returns an
-- active_job outcome, or deletion commits first and the insert receives 23503.
create or replace function public.delete_document_if_idle(
  p_document_id uuid,
  p_owner_id uuid,
  p_document_bucket text,
  p_image_bucket text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_active_job public.ingestion_jobs%rowtype;
  v_active_agent_job public.indexing_v3_agent_jobs%rowtype;
  v_cleanup_job_id uuid;
  v_image_paths text[] := '{}'::text[];
  v_chunk_ids uuid[] := '{}'::uuid[];
begin
  if p_document_id is null or p_owner_id is null then
    raise exception 'Document and owner identifiers are required.' using errcode = '22023';
  end if;
  if nullif(btrim(p_document_bucket), '') is null or nullif(btrim(p_image_bucket), '') is null then
    raise exception 'Storage bucket names are required.' using errcode = '22023';
  end if;

  select d.*
    into v_document
    from public.documents d
   where d.id = p_document_id
     and d.owner_id = p_owner_id
   for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select j.*
    into v_active_job
    from public.ingestion_jobs j
   where j.document_id = p_document_id
     and j.status in ('pending', 'processing')
   order by j.created_at asc, j.id asc
   limit 1;

  if found then
    return jsonb_build_object(
      'outcome', 'active_job',
      'job_id', v_active_job.id,
      'job_status', v_active_job.status
    );
  end if;

  -- Agent-only work also owns the document. Its FK insert takes the same parent
  -- key-share lock, so this check is serialized with admission just like node work.
  select j.* into v_active_agent_job
    from public.indexing_v3_agent_jobs j
   where j.document_id = p_document_id and j.status in ('pending', 'processing')
   order by j.created_at asc, j.id asc limit 1;
  if found then
    return jsonb_build_object('outcome', 'active_job', 'job_id', v_active_agent_job.id,
      'job_status', v_active_agent_job.status);
  end if;

  select coalesce(array_agg(distinct i.storage_path order by i.storage_path)
                          filter (where i.storage_path is not null and btrim(i.storage_path) <> ''), '{}'::text[])
    into v_image_paths
    from public.document_images i
   where i.document_id = p_document_id;

  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[])
    into v_chunk_ids
    from public.document_chunks c
   where c.document_id = p_document_id;

  insert into public.storage_cleanup_jobs (
    owner_id,
    document_id,
    document_title,
    document_bucket,
    document_paths,
    image_bucket,
    image_paths,
    status,
    metadata
  ) values (
    p_owner_id,
    p_document_id,
    v_document.title,
    p_document_bucket,
    case
      when v_document.storage_path is null or btrim(v_document.storage_path) = '' then '{}'::text[]
      else array[v_document.storage_path]
    end,
    p_image_bucket,
    v_image_paths,
    'pending',
    jsonb_build_object(
      'operation', 'permanent_document_delete',
      'created_by', 'delete_document_if_idle'
    )
  )
  returning id into v_cleanup_job_id;

  if cardinality(v_chunk_ids) > 0 then
    delete from public.rag_queries
     where source_chunk_ids && v_chunk_ids;
    delete from public.rag_query_misses
     where top_chunk_ids && v_chunk_ids
        or cited_chunk_ids && v_chunk_ids;
  end if;

  delete from public.rag_query_misses
   where clicked_document_id = p_document_id
      or expected_document_id = p_document_id;

  delete from public.rag_response_cache
   where owner_id = p_owner_id
     and cache_kind in ('search', 'answer');

  delete from public.documents where id = p_document_id;

  return jsonb_build_object(
    'outcome', 'deleted',
    'cleanup_job_id', v_cleanup_job_id,
    'document_title', v_document.title,
    'source_path', v_document.storage_path,
    'image_paths', to_jsonb(v_image_paths)
  );
end;
$$;

revoke all on function public.delete_document_if_idle(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.delete_document_if_idle(uuid, uuid, text, text)
  to service_role;

-- Explicit application-owned private schema only. Platform schemas remain excluded.
create or replace function ingestion_generation_evidence.schema_drift_inventory()
returns jsonb
language sql stable
set search_path = ''
as $inventory$
  with owned_schema as (
    select n.* from pg_catalog.pg_namespace n
    where n.nspname = 'ingestion_generation_evidence'
      and not exists (select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_namespace'::regclass and d.objid = n.oid and d.deptype = 'e')
  ), objects as (
    select 'schema:' || n.nspname as identity, jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(n.nspowner),
      'acl', (select jsonb_agg(a.item::text order by a.item::text)
        from unnest(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a(item))
    ) as state from owned_schema n
    union all
    select 'relation:' || n.nspname || '.' || c.relname, jsonb_build_object(
      'kind', c.relkind, 'owner', pg_catalog.pg_get_userbyid(c.relowner),
      'acl', (select jsonb_agg(a.item::text order by a.item::text)
        from unnest(coalesce(c.relacl, pg_catalog.acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end, c.relowner))) a(item)),
      'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity,
      'reloptions', (select jsonb_agg(o.opt order by o.opt) from unnest(c.reloptions) o(opt)),
      'view_definition', case when c.relkind in ('v','m') then pg_catalog.pg_get_viewdef(c.oid) end,
      'sequence', (select to_jsonb(s) - 'seqrelid' from pg_catalog.pg_sequence s where s.seqrelid = c.oid),
      'columns', (select jsonb_agg(jsonb_build_object(
        'name', a.attname, 'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
        'not_null', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated,
        'default', pg_catalog.pg_get_expr(ad.adbin, ad.adrelid),
        'acl', (select jsonb_agg(x.item::text order by x.item::text) from unnest(a.attacl) x(item))
      ) order by a.attname) from pg_catalog.pg_attribute a
        left join pg_catalog.pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
      'constraints', (select jsonb_agg(jsonb_build_object(
        'name', x.conname, 'definition', pg_catalog.pg_get_constraintdef(x.oid),
        'validated', x.convalidated, 'deferrable', x.condeferrable, 'deferred', x.condeferred
      ) order by x.conname) from pg_catalog.pg_constraint x where x.conrelid = c.oid),
      'indexes', (select jsonb_agg(jsonb_build_object(
        'identity', ni.nspname || '.' || ci.relname, 'definition', pg_catalog.pg_get_indexdef(i.indexrelid),
        'valid', i.indisvalid, 'ready', i.indisready, 'live', i.indislive
      ) order by ci.relname) from pg_catalog.pg_index i
        join pg_catalog.pg_class ci on ci.oid = i.indexrelid
        join pg_catalog.pg_namespace ni on ni.oid = ci.relnamespace where i.indrelid = c.oid),
      'triggers', (select jsonb_agg(jsonb_build_object(
        'name', t.tgname, 'enabled', t.tgenabled, 'definition', pg_catalog.pg_get_triggerdef(t.oid)
      ) order by t.tgname) from pg_catalog.pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal),
      'policies', (select jsonb_agg(jsonb_build_object(
        'name', p.polname, 'permissive', p.polpermissive, 'command', p.polcmd,
        'roles', (select jsonb_agg(case when r.role = 0 then 'public' else pg_catalog.pg_get_userbyid(r.role) end
          order by case when r.role = 0 then 'public' else pg_catalog.pg_get_userbyid(r.role) end) from unnest(p.polroles) r(role)),
        'qual', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
        'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
      ) order by p.polname) from pg_catalog.pg_policy p where p.polrelid = c.oid)
    ) from pg_catalog.pg_class c join owned_schema n on n.oid = c.relnamespace
    where c.relkind in ('r','p','v','m','f','S') and not exists (
      select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_class'::regclass
        and d.objid = c.oid and d.deptype = 'e')
    union all
    select 'function:' || p.oid::regprocedure::text, jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(p.proowner),
      -- Hash complete SQL, including quoted literals. Only normalize platform line endings.
      'def_hash', md5(replace(pg_catalog.pg_get_functiondef(p.oid), E'\r\n', E'\n')),
      'config', (select jsonb_agg(v.item order by v.item) from unnest(p.proconfig) v(item)),
      'security_definer', p.prosecdef,
      'acl', (select jsonb_agg(a.item::text order by a.item::text)
        from unnest(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a(item))
    ) from pg_catalog.pg_proc p join owned_schema n on n.oid = p.pronamespace
    where p.prokind in ('f','p') and not exists (
      select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::regclass
        and d.objid = p.oid and d.deptype = 'e')
    union all
    select 'default_acl:' || pg_catalog.pg_get_userbyid(d.defaclrole) || ':' ||
      coalesce(n.nspname, '*') || ':' || d.defaclobjtype::text, jsonb_build_object(
      'acl', (select jsonb_agg(a.item::text order by a.item::text) from unnest(d.defaclacl) a(item))
    ) from pg_catalog.pg_default_acl d
      left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclnamespace in (select oid from owned_schema)
      or (d.defaclnamespace = 0 and d.defaclrole = 'postgres'::regrole)
  )
  select coalesce(jsonb_agg(jsonb_build_object('identity', identity, 'state', state) order by identity), '[]'::jsonb)
  from objects;
$inventory$;
alter function ingestion_generation_evidence.schema_drift_inventory() owner to postgres;
revoke all on function ingestion_generation_evidence.schema_drift_inventory() from public, anon, authenticated, service_role;

create or replace function public.schema_drift_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  snapshot jsonb;
  buckets jsonb := '[]'::jsonb;
  history jsonb := '[]'::jsonb;
  history_probe text := 'no_history_table';
begin
  select jsonb_build_object(
    'snapshot_version', 2,
    'captured_at', now(),
    'private_objects', ingestion_generation_evidence.schema_drift_inventory(),
    'extensions', coalesce((
      select jsonb_agg(jsonb_build_object('name', e.extname, 'schema', n.nspname) order by e.extname)
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
      where e.extname <> 'plpgsql'
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', c.relname,
        'rls_enabled', c.relrowsecurity,
        'rls_forced', c.relforcerowsecurity,
        'reloptions', (select array_agg(o.opt order by o.opt) from unnest(c.reloptions) o(opt)),
        'acl', (select array_agg(a.item::text order by a.item::text) from unnest(coalesce(c.relacl, acldefault('r', c.relowner))) a(item)),
        'columns', (
          select jsonb_agg(jsonb_build_object(
            'name', att.attname,
            'type', format_type(att.atttypid, att.atttypmod),
            'not_null', att.attnotnull,
            'identity', att.attidentity,
            'generated', att.attgenerated,
            'default', pg_get_expr(ad.adbin, ad.adrelid)
          ) order by att.attname)
          from pg_attribute att
          left join pg_attrdef ad on ad.adrelid = att.attrelid and ad.adnum = att.attnum
          where att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
        )
      ) order by c.relname)
      from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    ), '[]'::jsonb),
    'views', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', c.relname,
        'def_hash', md5(regexp_replace(pg_get_viewdef(c.oid), '\s+', '', 'g'))
      ) order by c.relname)
      from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
    ), '[]'::jsonb),
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'signature', p.oid::regprocedure::text,
        -- A '--' starts a line comment only where the text before it on that line holds no
        -- open quote, so a '--' inside a '...' or "..." value (a URL such as
        -- Next-Step---Drug-..., a Markdown '| --- |' row) is hashed as content.
        'def_hash', md5(regexp_replace(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'), '(^|\n)((?:[^''"\n-]|-(?!-)|''[^''\n]*''|"[^"\n]*")*)--[^\n]*', '\1\2', 'g'), '\s+', '', 'g')),
        'acl', (select array_agg(a.item::text order by a.item::text) from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a(item))
      ) order by p.oid::regprocedure::text)
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.prokind = 'f'
        and not exists (
          select 1 from pg_depend dep
          where dep.classid = 'pg_proc'::regclass and dep.objid = p.oid and dep.deptype = 'e'
        )
    ), '[]'::jsonb),
    'indexes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', ci.relname,
        'table', ct.relname,
        'def', pg_get_indexdef(ci.oid),
        'def_hash', md5(regexp_replace(pg_get_indexdef(ci.oid), '\s+', '', 'g'))
      ) order by ci.relname)
      from pg_index i
      join pg_class ci on ci.oid = i.indexrelid
      join pg_class ct on ct.oid = i.indrelid
      where ct.relnamespace = 'public'::regnamespace
        and ci.relnamespace = 'public'::regnamespace
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'schema', pol.schemaname,
        'table', pol.tablename,
        'name', pol.policyname,
        'permissive', pol.permissive,
        'roles', (select array_agg(r.role::text order by r.role::text) from unnest(pol.roles) r(role)),
        'cmd', pol.cmd,
        'qual', pol.qual,
        'with_check', pol.with_check
      ) order by pol.schemaname, pol.tablename, pol.policyname)
      from pg_policies pol
      where pol.schemaname in ('public', 'storage')
    ), '[]'::jsonb),
    'constraints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table', ct.relname,
        'name', con.conname,
        'def', pg_get_constraintdef(con.oid)
      ) order by ct.relname, con.conname)
      from pg_constraint con
      join pg_class ct on ct.oid = con.conrelid
      where con.connamespace = 'public'::regnamespace and ct.relkind = 'r'
    ), '[]'::jsonb),
    'triggers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table', ct.relname,
        'name', t.tgname,
        'def', pg_get_triggerdef(t.oid)
      ) order by ct.relname, t.tgname)
      from pg_trigger t
      join pg_class ct on ct.oid = t.tgrelid
      where ct.relnamespace = 'public'::regnamespace and not t.tgisinternal
    ), '[]'::jsonb)
  ) into snapshot;

  if to_regclass('storage.buckets') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object('
      || '''id'', b.id, ''public'', b.public, ''file_size_limit'', b.file_size_limit, '
      || '''allowed_mime_types'', b.allowed_mime_types) order by b.id), ''[]''::jsonb) '
      || 'from storage.buckets b'
      into buckets;
  end if;

  -- Migration-history integrity probe. A version recorded without executed
  -- statements is the fingerprint of a history repair / mark-applied row and
  -- must be covered by a fail-fast guard migration + a reviewed allowlist entry
  -- (docs/database-drift-detection.md, "Guard-migration contract").
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists (
      select 1
      from pg_attribute att
      where att.attrelid = 'supabase_migrations.schema_migrations'::regclass
        and att.attname = 'statements'
        and att.attnum > 0
        and not att.attisdropped
    ) then
      execute 'select coalesce(jsonb_agg(jsonb_build_object('
        || '''version'', m.version, ''name'', m.name, '
        || '''signal'', case when m.statements is null then ''null'' else ''empty'' end'
        || ') order by m.version), ''[]''::jsonb) '
        || 'from supabase_migrations.schema_migrations m '
        || 'where m.statements is null or cardinality(m.statements) = 0'
        into history;
      history_probe := 'ok';
    else
      history_probe := 'no_statements_column';
    end if;
  end if;

  return snapshot || jsonb_build_object(
    'storage_buckets', buckets,
    'migration_history', history,
    'migration_history_probe', history_probe
  );
end;
$$;

revoke execute on function public.schema_drift_snapshot() from public, anon, authenticated;
grant execute on function public.schema_drift_snapshot() to service_role;
