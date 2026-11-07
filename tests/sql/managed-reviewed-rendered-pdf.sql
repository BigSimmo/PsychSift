-- Synthetic helper/ACL regression. Scratch replay only; never a hosted DB.
-- Full staged lifecycle/rollback/replacement cases are emitted by
-- tests/helpers/managed-rendered-pdf-sql-fixture.ts.
begin;
do $$
declare v jsonb;definition text;signature text;doc uuid:='7b000000-0000-4000-8000-000000000001';g uuid:='7b000000-0000-4000-8000-000000000002';
 bounds jsonb:='[0,0,100,100]';
begin
 if not ingestion_generation_evidence.rendered_pdf_rect(bounds,'[1,1,99,99]')
  or ingestion_generation_evidence.rendered_pdf_rect(bounds,'[1,1,101,99]')
  or ingestion_generation_evidence.rendered_pdf_rect(bounds,'[1,1,1,2]')
  or ingestion_generation_evidence.rendered_pdf_rect(bounds,'[1,1,"2",2]') then raise exception 'TEST_RENDERED_REGION';end if;
 if ingestion_generation_evidence.rendered_pdf_utf16_slice('A😀B',1,3)<>'😀'
  or ingestion_generation_evidence.rendered_pdf_utf16_slice('A😀B',3,4)<>'B' then raise exception 'TEST_UTF16_SLICE';end if;
 begin perform ingestion_generation_evidence.rendered_pdf_utf16_slice('A😀B',2,3);raise exception 'TEST_SPLIT_SURROGATE_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'managed_rendered_pdf_ocr_mapping' then raise;end if;end;
 v:='{"origin":"render_ocr","region":[1,1,9,9],"start":1,"end":3,"text":"😀"}';
 perform ingestion_generation_evidence.assert_rendered_pdf_text(v,'A😀B',bounds);
 begin perform ingestion_generation_evidence.assert_rendered_pdf_text(jsonb_set(v,'{text}','"forged"'),'A😀B',bounds);raise exception 'TEST_UNANCHORED_OCR_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'managed_rendered_pdf_ocr_mapping' then raise;end if;end;
 begin perform ingestion_generation_evidence.assert_rendered_pdf_text(v||'{"nativeText":"hidden"}','A😀B',bounds);raise exception 'TEST_EXTRA_NATIVE_TEXT_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'managed_rendered_pdf_ocr_mapping' then raise;end if;end;
 perform ingestion_generation_evidence.assert_rendered_pdf_text('{"origin":"manual_render_transcription","region":[1,1,9,9],"text":""}','',bounds,true);
 begin perform ingestion_generation_evidence.assert_rendered_pdf_text('{"origin":"manual_render_transcription","region":[1,1,9,9],"text":""}','',bounds);raise exception 'TEST_EMPTY_NONCELL_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'managed_rendered_pdf_text_record' then raise;end if;end;
 v:='{"id":{"family":"private_objects","key":"rendered-review-record"},"groupKey":"private_objects","required":true,"dependencies":[{"family":"private_objects","key":"original-source"}],"sourceEvidenceIds":[],"qualification":"whole_logical_unit_unverified","representation":"provenance_json"}';
 if not ingestion_generation_evidence.rendered_pdf_extra_unit(v) or ingestion_generation_evidence.rendered_pdf_extra_unit(v||'{"unapprovedExtra":true}')
  or ingestion_generation_evidence.rendered_pdf_extra_unit(jsonb_set(v,'{representation}','"original_binary"'))
  or ingestion_generation_evidence.rendered_pdf_extra_unit(jsonb_set(v,'{dependencies}','[]')) then raise exception 'TEST_RENDERED_PRIVATE_EXTRA_ALLOWLIST';end if;
 begin perform ingestion_generation_evidence.assert_rendered_pdf_private_plan('{"sourceExpectation":{"witness":{"reference":"independent-original-rendered-pdf-reviewed-inventory-v1"}},"declarations":{"units":[]}}');raise exception 'TEST_INCOMPLETE_RENDERED_PRIVATE_PLAN_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'managed_rendered_pdf_private_plan' then raise;end if;end;
 foreach signature in array array[
  'ingestion_generation_evidence.rendered_pdf_hash(jsonb)',
  'ingestion_generation_evidence.rendered_pdf_rect(jsonb,jsonb)',
  'ingestion_generation_evidence.rendered_pdf_utf16_slice(text,integer,integer)',
  'ingestion_generation_evidence.assert_rendered_pdf_text(jsonb,text,jsonb,boolean)',
  'ingestion_generation_evidence.assert_rendered_pdf_review(uuid,uuid,jsonb)',
  'ingestion_generation_evidence.assert_rendered_pdf_packet(jsonb,uuid,jsonb)',
  'ingestion_generation_evidence.rendered_pdf_extra_unit(jsonb)',
  'ingestion_generation_evidence.assert_rendered_pdf_private_plan(jsonb)',
  'ingestion_generation_evidence.assert_full_pdf_native_packet(jsonb,uuid,jsonb)'] loop
  if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE') or has_function_privilege('service_role',signature,'EXECUTE') then raise exception 'TEST_RENDERED_HELPER_EXPOSED:%',signature;end if;
  if (select pg_get_userbyid(proowner) from pg_proc where oid=signature::regprocedure)<>'postgres' then raise exception 'TEST_RENDERED_HELPER_OWNER:%',signature;end if;
 end loop;
 if not has_function_privilege('service_role','public.stage_managed_full_pdf(jsonb,uuid,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.stage_managed_full_pdf(jsonb,uuid,jsonb)','EXECUTE')
  or has_function_privilege('anon','public.complete_managed_full_pdf(jsonb,uuid,text,boolean)','EXECUTE') then raise exception 'TEST_RENDERED_RPC_ACL';end if;
 definition:=pg_get_functiondef('ingestion_generation_evidence.assert_full_pdf_packet(jsonb,uuid,jsonb)'::regprocedure);
 if strpos(definition,'assert_rendered_pdf_packet')=0 or strpos(definition,'assert_full_pdf_native_packet')=0 or strpos(definition,'jsonb_build_object')>0 then raise exception 'TEST_RENDERED_NATIVE_DISPATCH';end if;
 definition:=pg_get_functiondef('ingestion_generation_evidence.assert_full_pdf_native_packet(jsonb,uuid,jsonb)'::regprocedure);
 if strpos(definition,'assert_full_pdf_packet_v1')=0 or strpos(definition,'managed-full-pdf-packet-v2')=0 then raise exception 'TEST_RENDERED_NATIVE_PRESERVATION';end if;
 definition:=pg_get_functiondef('public.complete_managed_full_pdf(jsonb,uuid,text,boolean)'::regprocedure);
 if strpos(definition,'managed-rendered-pdf-seal-v1')=0 or strpos(definition,'reviewSha256')=0 or strpos(definition,'excluded_from_admitted_evidence')=0
  or strpos(definition,'perform ingestion_generation_evidence.publish_full_pdf_summary')<=strpos(definition,'result:=public.commit_document_index_generation')
  or strpos(definition,'perform ingestion_generation_evidence.publish_full_pdf_summary')>=strpos(definition,'result:=public.complete_ingestion_job') then raise exception 'TEST_RENDERED_SEAL_AND_ATOMIC_ORDER';end if;
 -- Incomplete and held inputs fail before any retained-row read or mutation.
 begin perform ingestion_generation_evidence.assert_rendered_pdf_review(doc,g,'{}');raise exception 'TEST_MISSING_RENDER_REVIEW_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'managed_rendered_pdf_review_binding' then raise;end if;end;
end $$;
rollback;
