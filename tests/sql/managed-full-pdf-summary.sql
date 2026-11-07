-- Synthetic helper contract only. Run on an explicitly authorized scratch replay,
-- never against a hosted database. Lifecycle/transaction cases are emitted by
-- managed-full-pdf-sql-fixture.ts --stage --summary (also use --reclaim).
begin;
do $$
declare doc uuid:='79000000-0000-4000-8000-000000000001';g uuid:='79000000-0000-4000-8000-000000000002';
 chunk uuid:='79000000-0000-4000-8000-000000000003';foreign_id uuid:='79000000-0000-4000-8000-000000000004';
 item jsonb;profile jsonb;specifics jsonb;payload jsonb;summary_row jsonb;label jsonb;p jsonb;bad jsonb;patch jsonb;definition text;
begin
 item:=jsonb_build_object('text','Synthetic source action.','source_chunk_ids',jsonb_build_array(chunk),'source_image_ids','[]'::jsonb,'pages','[1]'::jsonb,'evidence_type','text','support','direct');
 profile:=jsonb_build_object('overview','- Synthetic source action.','applies_to','[]'::jsonb,'key_clinical_actions',jsonb_build_array(item),'medication_dose_monitoring','[]'::jsonb,'thresholds_timing','[]'::jsonb,'escalation_risk_warnings','[]'::jsonb,'required_forms_documentation','[]'::jsonb,'not_covered','[]'::jsonb,'important_tables_images','[]'::jsonb,'best_questions','[]'::jsonb,'source_quality_notes','[]'::jsonb);
 specifics:=jsonb_build_object('profile',profile,'actions','["Synthetic source action."]'::jsonb,'thresholds_timing','[]'::jsonb,'medication_monitoring','[]'::jsonb,'risk_escalation','[]'::jsonb,'documentation_forms','[]'::jsonb,'exceptions_gaps','[]'::jsonb);
 payload:=jsonb_build_object('summary_kind','structured','summary_version','source-anchored-summary-v1','document_id',doc,'index_generation_id',g,'model','synthetic-model','model_version','rag-deep-memory-v2','generated_at','2026-11-04T00:00:00.000Z','source_chunk_ids',jsonb_build_array(chunk),'source_image_ids','[]'::jsonb,'summary','- Synthetic source action.','clinical_specifics',specifics,'labels','[{"label":"synthetic","label_type":"topic","confidence":0.9}]'::jsonb,'heuristic_fallback',false);
 summary_row:=jsonb_build_object('document_id',doc,'owner_id',null,'summary',payload->'summary','clinical_specifics',specifics,'source_chunk_ids',payload->'source_chunk_ids','source_image_ids',payload->'source_image_ids','model',payload->'model','generated_at',payload->'generated_at','metadata',jsonb_build_object('index_generation_id',g,'source_anchored_summary_v1',payload,'source_anchored_summary_projection_complete_v1',true,'managed_summary_request_sha256','sha256:'||repeat('a',64),'managed_summary_provider_evidence',jsonb_build_object('requestedModel','synthetic-model','providerModel','synthetic-provider-model','requestId','synthetic-request')));
 label:=jsonb_build_object('document_id',doc,'owner_id',null,'label','synthetic','label_type','topic','confidence',0.9,'source','generated','metadata',jsonb_build_object('index_generation_id',g,'summary_version','source-anchored-summary-v1','source_chunk_ids',jsonb_build_array(chunk),'source_image_ids','[]'::jsonb,'pages','[1]'::jsonb));
 p:=jsonb_build_object('version','managed-full-pdf-packet-v2','identity',jsonb_build_object('documentOwnerId',null),'rows',jsonb_build_object('chunks',jsonb_build_array(jsonb_build_object('id',chunk,'page_number',1)),'images','[]'::jsonb),'summaryProjection',jsonb_build_object('version','managed-pdf-summary-projection-v1','summary',summary_row,'labels',jsonb_build_array(label)));
 perform ingestion_generation_evidence.assert_full_pdf_summary(doc,g,p);
 -- Missing/null owner differ, as do a valid UUID in another document and a
 -- valid UUID in another generation. None is rescued by JSON coercion.
 for patch in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('path',array['summaryProjection','summary','owner_id'],'value',foreign_id),
  jsonb_build_object('path',array['summaryProjection','summary','document_id'],'value',foreign_id),
  jsonb_build_object('path',array['summaryProjection','summary','metadata','index_generation_id'],'value',foreign_id),
  jsonb_build_object('path',array['summaryProjection','summary','metadata','source_anchored_summary_projection_complete_v1'],'value',false),
  jsonb_build_object('path',array['summaryProjection','summary','metadata','managed_summary_provider_evidence','requestId'],'value',null),
  jsonb_build_object('path',array['summaryProjection','summary','metadata','managed_summary_request_sha256'],'value','sha256:bad'),
  jsonb_build_object('path',array['summaryProjection','labels','0','metadata','source_chunk_ids'],'value',jsonb_build_array(foreign_id))
 )) loop
  bad:=jsonb_set(p,array(select jsonb_array_elements_text(patch->'path')),patch->'value');
  begin perform ingestion_generation_evidence.assert_full_pdf_summary(doc,g,bad);raise exception 'TEST_INVALID_SUMMARY_ACCEPTED';
  exception when raise_exception then if sqlerrm not like 'managed_full_pdf_summary_%' then raise;end if;end;
 end loop;
 bad:=p#-'{summaryProjection,summary,owner_id}';
 begin perform ingestion_generation_evidence.assert_full_pdf_summary(doc,g,bad);raise exception 'TEST_MISSING_OWNER_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'managed_full_pdf_summary_identity' then raise;end if;end;
 -- Keep duplicated clinical projections equal so recursion, rather than the
 -- outer equality check, must reject the forged nested source ID and page.
 foreach definition in array array['source_chunk_ids','pages'] loop
  bad:=jsonb_set(p,array['summaryProjection','summary','clinical_specifics','profile','key_clinical_actions','0',definition],case when definition='pages' then '[2]'::jsonb else jsonb_build_array(foreign_id) end);
  bad:=jsonb_set(bad,array['summaryProjection','summary','metadata','source_anchored_summary_v1','clinical_specifics'],bad#>'{summaryProjection,summary,clinical_specifics}');
  begin perform ingestion_generation_evidence.assert_full_pdf_summary(doc,g,bad);raise exception 'TEST_NESTED_SUMMARY_FORGERY_ACCEPTED';
  exception when raise_exception then if sqlerrm not in ('managed_full_pdf_summary_claim_anchor','managed_full_pdf_summary_claim_pages') then raise;end if;end;
 end loop;
 if has_function_privilege('anon','ingestion_generation_evidence.assert_full_pdf_summary(uuid,uuid,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','ingestion_generation_evidence.assert_full_pdf_summary(uuid,uuid,jsonb)','EXECUTE')
  or has_function_privilege('service_role','ingestion_generation_evidence.publish_full_pdf_summary(uuid,uuid,jsonb)','EXECUTE') then raise exception 'TEST_SUMMARY_HELPER_EXPOSED';end if;
 definition:=pg_get_functiondef('public.complete_managed_full_pdf(jsonb,uuid,text,boolean)'::regprocedure);
 if strpos(definition,'result:=public.commit_document_index_generation')=0
  or strpos(definition,'perform ingestion_generation_evidence.publish_full_pdf_summary')<=strpos(definition,'result:=public.commit_document_index_generation')
  or strpos(definition,'perform ingestion_generation_evidence.publish_full_pdf_summary')>=strpos(definition,'result:=public.complete_ingestion_job') then raise exception 'TEST_SUMMARY_COMMIT_ORDER';end if;
end $$;
rollback;
