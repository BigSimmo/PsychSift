-- schema_drift_snapshot(): stop the function def_hash hiding literal text after a '--'.
--
-- Ledger #81A3YJ. The v2 snapshot (20260818090000) hashed each function after deleting
-- every '--' to the end of the line, to ignore comments. It cannot tell a comment from a
-- '--' inside a string literal. public.site_content_registry_baseline() holds the whole
-- services catalogue seed as one single-line dollar-quoted JSON value, and its first '--'
-- is inside a service URL, so about 91% of that function was deleted before hashing. A
-- change to the seed after that point was invisible to check:drift and the post-merge
-- live-drift run.
--
-- What changed vs v2: only the line-comment pattern in 'functions'.def_hash. A '--' now
-- starts a comment only at a line start or after whitespace, which is how every comment in
-- this repository's functions is written. The seed holds six '--' sequences, all glued to
-- other text, and no whitespace-preceded '--', so it is now hashed in full. Block comments
-- and whitespace are normalised exactly as before. snapshot_version stays 2: the shape is
-- unchanged, and only some def_hash values move.
--
-- Every function whose definition has a '--' glued to other text gets a new def_hash, on
-- live and in the replayed manifest alike, so supabase/drift-manifest.json is regenerated in
-- the same change. Until this migration is applied, check:drift reports those functions
-- and schema_drift_snapshot itself as def_hash mismatches.
--
-- Read-only, security definer, service_role execute only, exactly like v2. It changes no
-- table, row, policy or grant.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
        -- A line comment starts at a line start or after whitespace. A '--' glued to other
        -- text (a URL such as Next-Step---Drug-..., a '---' separator) is literal content.
        'def_hash', md5(regexp_replace(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'), '(^|[[:space:]])--[^\n]*', '\1', 'g'), '\s+', '', 'g')),
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
