-- DRAFT: the full-PDF and rendered-PDF packet validators checked every row's
-- parent references by rescanning rows->'chunks' (whose elements carry
-- 1536-value embeddings), rows->'images' and rows->'sections' once per row, so
-- validation cost grew with rows x parents. Each validator now collects the
-- parent IDs (and chunk ID/page pairs for table facts) once, before the row
-- loop, and tests membership against those arrays.
-- Behaviour is unchanged: coalesce(x=any(ids),false) is false exactly when no
-- parent has an equal id, which is when the old not-exists test raised. A
-- family that is not an array yields a null list, and every such family has
-- already raised before any lookup reads it. Same exception codes; ownership
-- and ACLs are kept by create or replace. No grants widen.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $$
declare signature text;definition text;needles text[];replacements text[];expected integer[];i integer;
begin
 needles:=array[
  $q$chunk_ordinal integer:=0;$q$,
  $q$ foreach row_family in array array['chunks','images','table_facts','embedding_fields','index_units','sections','memory_cards'] loop$q$,
  $q$not exists(select 1 from jsonb_array_elements(rows->'chunks') parent where parent->'id'=r->'source_chunk_id')$q$,
  $q$not exists(select 1 from jsonb_array_elements(rows->'images') parent where parent->'id'=r->'source_image_id')$q$,
  $q$not exists(select 1 from jsonb_array_elements(rows->'chunks') parent where parent->'id'=link)$q$,
  $q$not exists(select 1 from jsonb_array_elements(rows->'images') parent where parent->'id'=link)$q$,
  $q$not exists(select 1 from jsonb_array_elements(rows->'sections') parent where parent->'id'=r->'section_id')$q$,
  $q$not exists(select 1 from jsonb_array_elements(rows->'chunks') ch where ch->'id'=r->'source_chunk_id' and ch->'page_number'=r->'page_number')$q$];
 replacements:=array[
  $q$chunk_ordinal integer:=0;parent_chunk_ids jsonb[];parent_image_ids jsonb[];parent_section_ids jsonb[];chunk_page_keys jsonb[];$q$,
  $q$ parent_chunk_ids:=case when jsonb_typeof(rows->'chunks')='array' then array(select x->'id' from jsonb_array_elements(rows->'chunks') x) end;
 parent_image_ids:=case when jsonb_typeof(rows->'images')='array' then array(select x->'id' from jsonb_array_elements(rows->'images') x) end;
 parent_section_ids:=case when jsonb_typeof(rows->'sections')='array' then array(select x->'id' from jsonb_array_elements(rows->'sections') x) end;
 chunk_page_keys:=case when jsonb_typeof(rows->'chunks')='array' then array(select jsonb_build_array(x->'id',x->'page_number') from jsonb_array_elements(rows->'chunks') x where x->'id' is not null and x->'page_number' is not null) end;
 foreach row_family in array array['chunks','images','table_facts','embedding_fields','index_units','sections','memory_cards'] loop$q$,
  $q$not coalesce(r->'source_chunk_id'=any(parent_chunk_ids),false)$q$,
  $q$not coalesce(r->'source_image_id'=any(parent_image_ids),false)$q$,
  $q$not coalesce(link=any(parent_chunk_ids),false)$q$,
  $q$not coalesce(link=any(parent_image_ids),false)$q$,
  $q$not coalesce(r->'section_id'=any(parent_section_ids),false)$q$,
  $q$(r->'source_chunk_id' is null or r->'page_number' is null or not coalesce(jsonb_build_array(r->'source_chunk_id',r->'page_number')=any(chunk_page_keys),false))$q$];
 expected:=array[1,1,1,1,2,1,1,1];
 foreach signature in array array['ingestion_generation_evidence.assert_full_pdf_packet_v1(jsonb,uuid,jsonb)',
  'ingestion_generation_evidence.assert_rendered_pdf_packet(jsonb,uuid,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if strpos(definition,'parent_chunk_ids')<>0
   or not exists(select 1 from pg_proc where oid=signature::regprocedure and proowner='postgres'::regrole)
   then raise exception 'full_pdf_parent_lookup_preimage';end if;
  for i in 1..array_length(needles,1) loop
   if (length(definition)-length(replace(definition,needles[i],'')))/length(needles[i])<>expected[i] then raise exception 'full_pdf_parent_lookup_preimage';end if;
   definition:=replace(definition,needles[i],replacements[i]);
  end loop;
  if strpos(definition,$q$jsonb_array_elements(rows->'chunks') parent$q$)<>0 or strpos(definition,$q$jsonb_array_elements(rows->'images') parent$q$)<>0
   or strpos(definition,$q$jsonb_array_elements(rows->'sections') parent$q$)<>0 or strpos(definition,$q$jsonb_array_elements(rows->'chunks') ch where$q$)<>0
   then raise exception 'full_pdf_parent_lookup_postimage';end if;
  execute definition;
 end loop;
end $$;

-- Patched validators retain their postgres ownership and existing ACLs.
commit;
