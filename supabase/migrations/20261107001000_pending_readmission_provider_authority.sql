-- DRAFT: provider facts observe a readmission's declared pending authority while
-- retrieval continues to use the old flat ranking metadata until completion.
-- Validate the pending admission binding and unchanged live snapshot first.
-- Existing event/source/lease/permission checks and ACLs remain unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $$
declare signature regprocedure:='public.read_ingestion_generation_inventory(jsonb,uuid)'::regprocedure;
 definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef(signature);
 needle:=$old$    for pa_pair in select * from (values
      ('source_role','sourceRole'),('authority_basis','authorityBasis'),('licence_policy','licencePolicy'),$old$;
 replacement:=$new$    -- The immutable event above binds the declaration to this document/source.
    -- A changed live snapshot (including withdrawn rights) must never be hidden
    -- by overlaying pending values. Missing/foreign/malformed blocks fail closed.
    if pa_metadata ? 'pending_reindex_authority' then
      if not ingestion_generation_evidence.pending_reindex_authority_valid(pa_metadata)
        or exists(select 1 from jsonb_each(pa_metadata#>'{pending_reindex_authority,prior}') prior
          where coalesce(pa_metadata->prior.key,'null'::jsonb) is distinct from prior.value)
        then raise exception 'provider_authority_admission_mismatch';end if;
      pa_metadata:=pa_metadata||(pa_metadata#>'{pending_reindex_authority,values}');
    end if;
    for pa_pair in select * from (values
      ('source_role','sourceRole'),('authority_basis','authorityBasis'),('licence_policy','licencePolicy'),$new$;
 if length(definition)-length(replace(definition,needle,''))<>length(needle)
   or strpos(definition,'pending_reindex_authority')<>0
   or not exists(select 1 from pg_proc where oid=signature and proowner='postgres'::regrole)
   then raise exception 'pending_provider_authority_preimage';end if;
 execute replace(definition,needle,replacement);
end $$;
commit;
