-- DRAFT: preserve declared WA jurisdiction through the existing admission and
-- provider-authority facts paths. No new provider or public-corpus authority.
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $$
declare definition text; original text; replacement text;
begin
 definition:=pg_get_functiondef('public.trusted_document_admission_core(jsonb,jsonb,boolean,text,uuid,text)'::regprocedure);
 original:='v_authority->>''jurisdiction'' is distinct from ''Australia''';
 replacement:='coalesce(v_authority->>''jurisdiction'','''') not in (''Australia'',''Australia/WA'')';
 if length(definition)-length(replace(definition,original,''))<>length(original)
  or length(definition)-length(replace(definition,'''jurisdiction'', ''Australia'',',''))<>length('''jurisdiction'', ''Australia'',')
  or not exists(select 1 from pg_proc where oid='public.trusted_document_admission_core(jsonb,jsonb,boolean,text,uuid,text)'::regprocedure and prosecdef and proowner='postgres'::regrole)
  then raise exception 'wa_admission_core_preimage_mismatch';end if;
 definition:=replace(definition,original,replacement);
 definition:=replace(definition,'''jurisdiction'', ''Australia'',','''jurisdiction'', v_authority->>''jurisdiction'',');
 execute definition;
 definition:=pg_get_functiondef('public.read_ingestion_generation_inventory(jsonb,uuid)'::regprocedure);
 original:='pa_authority->>''jurisdiction'' is distinct from ''Australia''';
 replacement:='coalesce(pa_authority->>''jurisdiction'','''') not in (''Australia'',''Australia/WA'')';
 if length(definition)-length(replace(definition,original,''))<>length(original)
  or not exists(select 1 from pg_proc where oid='public.read_ingestion_generation_inventory(jsonb,uuid)'::regprocedure and prosecdef and proowner='postgres'::regrole)
  then raise exception 'wa_provider_authority_preimage_mismatch';end if;
 execute replace(definition,original,replacement);
end $$;
