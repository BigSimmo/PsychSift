-- Preserve SQL string and dollar-quoted function bodies while removing comments
-- from schema_drift_snapshot() function hashes. This is a forward migration:
-- the original migration has already been applied in deployed databases.
do $migration$
declare
  definition text;
  old_normalizer text := $old$md5(regexp_replace(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'), '--[^\n]*', '', 'g'), '\s+', '', 'g'))$old$;
  new_normalizer text := $new$md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '(\$[A-Za-z_][A-Za-z_0-9]*\$[\s\S]*?\$[A-Za-z_][A-Za-z_0-9]*\$)|(''(''''|[^''])*'')|--[^\n]*', '\1\2', 'g'), '\s+', '', 'g'))$new$;
begin
  select pg_get_functiondef('public.schema_drift_snapshot()'::regprocedure)
    into definition;

  if position(old_normalizer in definition) = 0 then
    raise exception 'schema_drift_snapshot() does not contain the expected legacy normalizer';
  end if;

  execute replace(definition, old_normalizer, new_normalizer);
end
$migration$;
