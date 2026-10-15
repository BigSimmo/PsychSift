-- Replay wrapper, added 2026-10-15 when this already-applied migration was recorded on main.
-- Live applied this body inside one external transaction on 2026-10-13 and never re-runs it.
-- A fresh chain (CI Migration replay, Supabase Preview) runs each file outside a transaction,
-- where LOCK TABLE fails (SQLSTATE 25P01) and SET LOCAL is ignored, so the body is wrapped in
-- begin/commit here. The one grant below gives service_role on a fresh chain the same privileges
-- live already had on document_strict_gate_status, which the preimage checks pin; on live it is a no-op.
begin;
grant all on table public.document_strict_gate_status to service_role;
-- CANDIDATE ONLY. External transaction body; reviewed operator cutover required.
-- No production application, provider action, deployment or migration history authority.
-- bounded transaction settings
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=public,extensions;

-- actual target function/column/publication preimages
do $main_txt_preimage$ begin
if current_user <> 'postgres' then raise exception 'main_txt_postgres_required'; end if;
if to_regnamespace('ingestion_generation_evidence') is not null then raise exception 'main_txt_retention_preimage_not_empty'; end if;
if to_regclass('public.document_admission_events') is not null then raise exception 'main_txt_admission_preimage_not_empty'; end if;
if (select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'identityArguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,'bodyMd5',md5(p.prosrc)) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admit_administrator_document','assert_current_ingestion_attempt','assert_ingestion_artifact_sources','begin_ingestion_generation_evidence','claim_indexing_v3_agent_jobs','claim_ingestion_jobs','commit_document_index_generation','complete_ingestion_job','complete_managed_admin_text','complete_strict_enrichment_job','declare_ingestion_generation_evidence','document_publication_state_digest','fail_or_retry_ingestion_job','finish_ingestion_job_stage','heartbeat_indexing_v3_agent_job','heartbeat_ingestion_job','is_visible_document_page','lock_ingestion_document_authority','patch_ingestion_document_state','persist_ingestion_index_quality','persist_ingestion_summary_projection','prepare_completed_admin_text_reference','read_completed_admin_text_source_layout','read_ingestion_generation_inventory','read_ingestion_prepared_supplier_artifacts','read_published_admin_text_source_layout','record_ingestion_generation_accounting','record_ingestion_generation_outcomes','register_admin_text_source_section_layout','reject_document_admission_event_mutation','replace_indexing_v3_core_embeddings','replace_indexing_v3_memory_cards','replace_indexing_v3_sections','replace_indexing_v3_visual_artifacts','resolve_registered_published_admin_source_plan','retain_ingestion_generation_artifacts','start_ingestion_job_stage','trusted_document_admission_core','update_indexing_v3_agent_job_status','update_ingestion_job_progress','write_ingestion_base_artifacts')) is distinct from '[{"name": "claim_indexing_v3_agent_jobs", "identityArguments": "p_worker_id text, p_claim_limit integer, p_stale_after_minutes integer", "result": "TABLE(id uuid, document_id uuid, batch_id uuid, status text, stage text, progress integer, error_message text, attempt_count integer, max_attempts integer, locked_at timestamp with time zone, locked_by text, documents jsonb)", "owner": "postgres", "securityDefiner": false, "config": ["search_path=public, extensions, pg_temp"], "acl": "{postgres=X/postgres,service_role=X/postgres}", "bodyMd5": "ebca115ab0498d80d9b28093b9437b3e"}, {"name": "claim_ingestion_jobs", "identityArguments": "p_worker_id text, p_claim_limit integer, p_stale_after_minutes integer", "result": "TABLE(id uuid, document_id uuid, batch_id uuid, status text, stage text, progress integer, error_message text, attempt_count integer, max_attempts integer, locked_at timestamp with time zone, locked_by text, documents jsonb)", "owner": "postgres", "securityDefiner": false, "config": ["search_path=\"\""], "acl": "{postgres=X/postgres,service_role=X/postgres}", "bodyMd5": "f6037a83bd43442ee863f940ca85f6c3"}, {"name": "commit_document_index_generation", "identityArguments": "p_document_id uuid, p_index_generation_id uuid, p_status text, p_page_count integer, p_chunk_count integer, p_image_count integer, p_metadata jsonb, p_pages jsonb, p_quality jsonb", "result": "jsonb", "owner": "postgres", "securityDefiner": false, "config": ["search_path=public, extensions, pg_temp"], "acl": "{postgres=X/postgres}", "bodyMd5": "a2a803abc573c32751d4a84bf3363df3"}, {"name": "commit_document_index_generation", "identityArguments": "p_job_id uuid, p_worker_id text, p_document_id uuid, p_index_generation_id uuid, p_status text, p_page_count integer, p_chunk_count integer, p_image_count integer, p_metadata jsonb, p_pages jsonb, p_quality jsonb", "result": "jsonb", "owner": "postgres", "securityDefiner": true, "config": ["search_path=\"\""], "acl": "{postgres=X/postgres,service_role=X/postgres}", "bodyMd5": "7e7c4f830bf003df997d730298e7c2d5"}, {"name": "complete_ingestion_job", "identityArguments": "p_job_id uuid, p_document_id uuid, p_batch_id uuid, p_stage text, p_worker_id text", "result": "jsonb", "owner": "postgres", "securityDefiner": false, "config": ["search_path=public, extensions, pg_temp"], "acl": "{postgres=X/postgres,service_role=X/postgres}", "bodyMd5": "b476b12b6e2924d09dc1f2a06794c4a3"}, {"name": "complete_strict_enrichment_job", "identityArguments": "p_document_id uuid, p_job_id uuid, p_stage text, p_agent_version text, p_visual_indexing_version text", "result": "TABLE(ok boolean, document_id uuid, gate_passed boolean, missing text[], status text, counts jsonb, presence jsonb, completed_job_ids uuid[])", "owner": "postgres", "securityDefiner": false, "config": ["search_path=public, extensions, pg_temp"], "acl": "{postgres=X/postgres,service_role=X/postgres}", "bodyMd5": "d6ab2c07e1b9cd3045169199d69b935b"}, {"name": "document_publication_state_digest", "identityArguments": "p_document_id uuid, p_expected_owner_id uuid", "result": "text", "owner": "postgres", "securityDefiner": true, "config": ["search_path=\"\""], "acl": "{postgres=X/postgres,service_role=X/postgres}", "bodyMd5": "4b9e61305fb888202623f056ae18f7e0"}, {"name": "fail_or_retry_ingestion_job", "identityArguments": "p_job_id uuid, p_document_id uuid, p_batch_id uuid, p_retry boolean, p_document_status text, p_stage text, p_error_message text, p_next_run_at timestamp with time zone, p_worker_id text", "result": "jsonb", "owner": "postgres", "securityDefiner": false, "config": ["search_path=public, extensions, pg_temp"], "acl": "{postgres=X/postgres,service_role=X/postgres}", "bodyMd5": "9a576b5fa1a7fde37f8efcca129098e9"}, {"name": "update_indexing_v3_agent_job_status", "identityArguments": "p_document_id uuid, p_status text, p_error text, p_next_run_at timestamp with time zone", "result": "jsonb", "owner": "postgres", "securityDefiner": false, "config": ["search_path=public, extensions, pg_temp"], "acl": "{postgres=X/postgres,service_role=X/postgres}", "bodyMd5": "99d11f50bdbcbc3064473665b4b2018c"}]'::jsonb then raise exception 'main_txt_complete_selected_function_preimage_mismatch'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='activate_approved_public_documents' and pg_get_function_identity_arguments(p.oid)='p_manifest jsonb, p_expected_state_digest text, p_expected_generation_ids uuid[]' and md5(p.prosrc)='3bce2dd94f96ccbd535f380181c73e17' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=true and to_jsonb(p.proconfig) is not distinct from '["search_path=\"\""]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: activate_approved_public_documents'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='assert_public_source_document_governance' and pg_get_function_identity_arguments(p.oid)='p_document_id uuid' and md5(p.prosrc)='777301278dfefb2126b0a00f8b025acc' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=true and to_jsonb(p.proconfig) is not distinct from '["search_path=\"\""]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: assert_public_source_document_governance'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='claim_ingestion_jobs' and pg_get_function_identity_arguments(p.oid)='p_worker_id text, p_claim_limit integer, p_stale_after_minutes integer' and md5(p.prosrc)='f6037a83bd43442ee863f940ca85f6c3' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=\"\""]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: claim_ingestion_jobs'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='commit_document_index_generation' and pg_get_function_identity_arguments(p.oid)='p_document_id uuid, p_index_generation_id uuid, p_status text, p_page_count integer, p_chunk_count integer, p_image_count integer, p_metadata jsonb, p_pages jsonb, p_quality jsonb' and md5(p.prosrc)='a2a803abc573c32751d4a84bf3363df3' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=public, extensions, pg_temp"]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: commit_document_index_generation'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='commit_document_index_generation' and pg_get_function_identity_arguments(p.oid)='p_job_id uuid, p_worker_id text, p_document_id uuid, p_index_generation_id uuid, p_status text, p_page_count integer, p_chunk_count integer, p_image_count integer, p_metadata jsonb, p_pages jsonb, p_quality jsonb' and md5(p.prosrc)='7e7c4f830bf003df997d730298e7c2d5' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=true and to_jsonb(p.proconfig) is not distinct from '["search_path=\"\""]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: commit_document_index_generation'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_ingestion_job' and pg_get_function_identity_arguments(p.oid)='p_job_id uuid, p_document_id uuid, p_batch_id uuid, p_stage text, p_worker_id text' and md5(p.prosrc)='b476b12b6e2924d09dc1f2a06794c4a3' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=public, extensions, pg_temp"]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: complete_ingestion_job'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='document_publication_state_digest' and pg_get_function_identity_arguments(p.oid)='p_document_id uuid, p_expected_owner_id uuid' and md5(p.prosrc)='4b9e61305fb888202623f056ae18f7e0' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=true and to_jsonb(p.proconfig) is not distinct from '["search_path=\"\""]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: document_publication_state_digest'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='guard_document_publication_transition' and pg_get_function_identity_arguments(p.oid)='' and md5(p.prosrc)='83e9adb59ccbfbb729ab6e9ddaf49089' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=\"\""]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: guard_document_publication_transition'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='publish_approved_documents' and pg_get_function_identity_arguments(p.oid)='p_documents jsonb, p_manifest_digest text, p_expected_count integer' and md5(p.prosrc)='34d784b2b73e2e340966e66995c6d505' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=true and to_jsonb(p.proconfig) is not distinct from '["search_path=\"\""]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: publish_approved_documents'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='require_document_publication_approval_state_digest' and pg_get_function_identity_arguments(p.oid)='' and md5(p.prosrc)='ea4c575b8e4b4f27fde6069ca3cfa1f4' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=\"\""]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: require_document_publication_approval_state_digest'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='withdraw_public_source_version' and pg_get_function_identity_arguments(p.oid)='p_version_id uuid, p_operator_id uuid, p_reason text' and md5(p.prosrc)='d65b019b3ec365dc9c1b1b68d25ea922' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=true and to_jsonb(p.proconfig) is not distinct from '["search_path=\"\""]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: withdraw_public_source_version'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='apply_document_metadata_patch' and pg_get_function_identity_arguments(p.oid)='p_document_id uuid, p_metadata_patch jsonb' and md5(p.prosrc)='6211587f989f91693e154fbf9d96e8b0' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=public, extensions, pg_temp"]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: apply_document_metadata_patch'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='is_committed_artifact_generation' and pg_get_function_identity_arguments(p.oid)='artifact_metadata jsonb, document_metadata jsonb' and md5(p.prosrc)='ac3212eae93d440305ddaa800d332aec' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=public, extensions, pg_temp"]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: is_committed_artifact_generation'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='is_committed_artifact_generation' and pg_get_function_identity_arguments(p.oid)='artifact_generation_id uuid, document_metadata jsonb' and md5(p.prosrc)='5de5422b0011574236b57678c6e19752' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=public, extensions, pg_temp"]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: is_committed_artifact_generation'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='is_committed_document_generation' and pg_get_function_identity_arguments(p.oid)='row_generation uuid, document_metadata jsonb' and md5(p.prosrc)='cd95f2f4565ef5664b83938759e15e89' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=public, extensions, pg_temp"]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: is_committed_document_generation'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='is_committed_document_generation' and pg_get_function_identity_arguments(p.oid)='row_generation uuid, document_generation uuid' and md5(p.prosrc)='258649b74e0daeb61335eca10650370c' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=public, extensions, pg_temp"]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: is_committed_document_generation'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='jsonb_merge_deep' and pg_get_function_identity_arguments(p.oid)='target_obj jsonb, patch_obj jsonb' and md5(p.prosrc)='8b233df81eb6e1b2d973104fdc1d5fc6' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=public, extensions, pg_temp"]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: jsonb_merge_deep'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='refresh_import_batch_status' and pg_get_function_identity_arguments(p.oid)='p_batch_id uuid' and md5(p.prosrc)='049110f53f20abaccf5cbcc23f089a70' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=false and to_jsonb(p.proconfig) is not distinct from '["search_path=public, extensions, pg_temp"]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: refresh_import_batch_status'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='claim_indexing_v3_agent_jobs' and pg_get_function_identity_arguments(p.oid)='p_worker_id text, p_claim_limit integer, p_stale_after_minutes integer' and md5(p.prosrc)='ebca115ab0498d80d9b28093b9437b3e') then raise exception 'main_txt_function_preimage_mismatch: claim_indexing_v3_agent_jobs'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_strict_enrichment_job' and pg_get_function_identity_arguments(p.oid)='p_document_id uuid, p_job_id uuid, p_stage text, p_agent_version text, p_visual_indexing_version text' and md5(p.prosrc)='d6ab2c07e1b9cd3045169199d69b935b') then raise exception 'main_txt_function_preimage_mismatch: complete_strict_enrichment_job'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='fail_or_retry_ingestion_job' and pg_get_function_identity_arguments(p.oid)='p_job_id uuid, p_document_id uuid, p_batch_id uuid, p_retry boolean, p_document_status text, p_stage text, p_error_message text, p_next_run_at timestamp with time zone, p_worker_id text' and md5(p.prosrc)='9a576b5fa1a7fde37f8efcca129098e9') then raise exception 'main_txt_function_preimage_mismatch: fail_or_retry_ingestion_job'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_indexing_v3_agent_job_status' and pg_get_function_identity_arguments(p.oid)='p_document_id uuid, p_status text, p_error text, p_next_run_at timestamp with time zone' and md5(p.prosrc)='99d11f50bdbcbc3064473665b4b2018c') then raise exception 'main_txt_function_preimage_mismatch: update_indexing_v3_agent_job_status'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_uploaded_document_with_ingestion_job' and pg_get_function_identity_arguments(p.oid)='p_document jsonb, p_max_attempts integer' and md5(p.prosrc)='2d73723a0ec2a65baaaaadd79a6039b6' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef=true and to_jsonb(p.proconfig) is not distinct from '["search_path=public, pg_temp"]'::jsonb) then raise exception 'main_txt_function_preimage_mismatch: create_uploaded_document_with_ingestion_job'; end if;
if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='document_strict_gate_status' and pg_get_viewdef(c.oid,true)=' WITH artifact_counts AS (
         SELECT d.id AS document_id,
            d.owner_id,
            d.status AS document_status,
            d.updated_at AS document_updated_at,
            COALESCE(d.metadata ->> ''enrichment_status''::text, ''pending''::text) AS enrichment_status,
            COALESCE(d.metadata ->> ''indexing_v3_agent_status''::text, ''pending''::text) AS indexing_v3_agent_status,
            COALESCE(q.extraction_quality, ''unknown''::text) AS quality_extraction_quality,
            COALESCE(q.quality_score, 0::real) AS quality_score,
            ( SELECT count(*)::integer AS count
                   FROM document_sections s
                  WHERE s.document_id = d.id) AS sections,
            ( SELECT count(*)::integer AS count
                   FROM document_memory_cards m
                  WHERE m.document_id = d.id) AS memory_cards,
            ( SELECT count(*)::integer AS count
                   FROM document_labels l
                  WHERE l.document_id = d.id AND (lower(l.source) = ''generated''::text OR (l.metadata ->> ''source''::text) = ''generated''::text OR (l.metadata ->> ''generated_by''::text) = ''indexing-v3-agent''::text OR lower(COALESCE(l.metadata ->> ''generation_source''::text, ''''::text)) = ''indexing_v3_agent_parsed_artifacts''::text)) AS generated_labels,
            ( SELECT count(*)::integer AS count
                   FROM document_index_units u
                  WHERE u.document_id = d.id) AS index_units,
            (EXISTS ( SELECT 1
                   FROM document_embedding_fields f
                  WHERE f.document_id = d.id AND f.field_type = ''document_title''::text
                 LIMIT 1)) AS title_embedding,
            (EXISTS ( SELECT 1
                   FROM document_embedding_fields f
                  WHERE f.document_id = d.id AND f.field_type = ''document_summary''::text
                 LIMIT 1)) AS summary_embedding
           FROM documents d
             LEFT JOIN document_index_quality q ON q.document_id = d.id
        ), gate AS (
         SELECT artifact_counts.document_id,
            artifact_counts.owner_id,
            artifact_counts.document_status,
            artifact_counts.document_updated_at,
            artifact_counts.enrichment_status,
            artifact_counts.indexing_v3_agent_status,
            artifact_counts.quality_extraction_quality,
            artifact_counts.quality_score,
            artifact_counts.sections,
            artifact_counts.memory_cards,
            artifact_counts.generated_labels,
            artifact_counts.index_units,
            artifact_counts.title_embedding,
            artifact_counts.summary_embedding,
            array_remove(ARRAY[
                CASE
                    WHEN artifact_counts.sections > 0 THEN NULL::text
                    ELSE ''sections''::text
                END,
                CASE
                    WHEN artifact_counts.memory_cards > 0 THEN NULL::text
                    ELSE ''memory_cards''::text
                END,
                CASE
                    WHEN artifact_counts.generated_labels > 0 THEN NULL::text
                    ELSE ''generated_labels''::text
                END,
                CASE
                    WHEN artifact_counts.index_units > 0 THEN NULL::text
                    ELSE ''index_units''::text
                END,
                CASE
                    WHEN artifact_counts.title_embedding THEN NULL::text
                    ELSE ''title_embedding''::text
                END,
                CASE
                    WHEN artifact_counts.summary_embedding THEN NULL::text
                    ELSE ''summary_embedding''::text
                END], NULL::text) AS missing
           FROM artifact_counts
        )
 SELECT document_id,
    owner_id,
    document_status,
    document_updated_at,
    enrichment_status,
    indexing_v3_agent_status,
    quality_extraction_quality,
    quality_score,
    sections,
    memory_cards,
    generated_labels,
    index_units,
    title_embedding,
    summary_embedding,
    missing,
    cardinality(missing) = 0 AS gate_passed,
    jsonb_build_object(''sections'', sections, ''memory_cards'', memory_cards, ''generated_labels'', generated_labels, ''index_units'', index_units) AS counts,
    jsonb_build_object(''title_embedding'', title_embedding, ''summary_embedding'', summary_embedding) AS presence
   FROM gate;') then raise exception 'main_txt_strict_view_preimage_mismatch'; end if;
if not exists(select 1 from pg_class c where c.oid='public.document_strict_gate_status'::regclass and pg_get_userbyid(c.relowner)='postgres' and c.relacl::text='{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}' and to_jsonb(c.reloptions)='["security_invoker=true"]'::jsonb) then raise exception 'main_txt_strict_view_authority_preimage_mismatch'; end if;
if not exists(select 1 from pg_trigger t where t.tgrelid='public.document_publication_approvals'::regclass and t.tgname='document_publication_approvals_immutable' and t.tgenabled='O' and pg_get_triggerdef(t.oid)='CREATE TRIGGER document_publication_approvals_immutable BEFORE DELETE OR UPDATE ON public.document_publication_approvals FOR EACH ROW EXECUTE FUNCTION prevent_document_publication_approval_mutation()') then raise exception 'main_txt_trigger_preimage_mismatch: document_publication_approvals_immutable'; end if;
if not exists(select 1 from pg_trigger t where t.tgrelid='public.document_publication_approvals'::regclass and t.tgname='document_publication_approvals_require_state_digest' and t.tgenabled='O' and pg_get_triggerdef(t.oid)='CREATE TRIGGER document_publication_approvals_require_state_digest BEFORE INSERT ON public.document_publication_approvals FOR EACH ROW EXECUTE FUNCTION require_document_publication_approval_state_digest()') then raise exception 'main_txt_trigger_preimage_mismatch: document_publication_approvals_require_state_digest'; end if;
if not exists(select 1 from pg_trigger t where t.tgrelid='public.documents'::regclass and t.tgname='documents_guard_public_source_identity' and t.tgenabled='O' and pg_get_triggerdef(t.oid)='CREATE TRIGGER documents_guard_public_source_identity BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION guard_public_source_document_identity()') then raise exception 'main_txt_trigger_preimage_mismatch: documents_guard_public_source_identity'; end if;
if not exists(select 1 from pg_trigger t where t.tgrelid='public.documents'::regclass and t.tgname='documents_ingestion_webhook' and t.tgenabled='O' and pg_get_triggerdef(t.oid)='CREATE TRIGGER documents_ingestion_webhook AFTER UPDATE OF metadata ON public.documents FOR EACH ROW EXECUTE FUNCTION notify_document_change_ingestion_webhook()') then raise exception 'main_txt_trigger_preimage_mismatch: documents_ingestion_webhook'; end if;
if not exists(select 1 from pg_trigger t where t.tgrelid='public.documents'::regclass and t.tgname='documents_require_australian_source_activation' and t.tgenabled='O' and pg_get_triggerdef(t.oid)='CREATE TRIGGER documents_require_australian_source_activation AFTER UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION guard_australian_source_activation()') then raise exception 'main_txt_trigger_preimage_mismatch: documents_require_australian_source_activation'; end if;
if not exists(select 1 from pg_trigger t where t.tgrelid='public.documents'::regclass and t.tgname='documents_require_publication_approval' and t.tgenabled='O' and pg_get_triggerdef(t.oid)='CREATE TRIGGER documents_require_publication_approval BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION guard_document_publication_transition()') then raise exception 'main_txt_trigger_preimage_mismatch: documents_require_publication_approval'; end if;
if not exists(select 1 from pg_trigger t where t.tgrelid='public.documents'::regclass and t.tgname='documents_sync_title_words' and t.tgenabled='O' and pg_get_triggerdef(t.oid)='CREATE TRIGGER documents_sync_title_words AFTER INSERT OR DELETE OR UPDATE OF title, status, owner_id ON public.documents FOR EACH ROW EXECUTE FUNCTION sync_document_title_words()') then raise exception 'main_txt_trigger_preimage_mismatch: documents_sync_title_words'; end if;
if not exists(select 1 from pg_trigger t where t.tgrelid='public.documents'::regclass and t.tgname='documents_updated_at' and t.tgenabled='O' and pg_get_triggerdef(t.oid)='CREATE TRIGGER documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION set_updated_at()') then raise exception 'main_txt_trigger_preimage_mismatch: documents_updated_at'; end if;
if (select jsonb_agg(a.attname order by a.attname) from pg_attribute a where a.attrelid='public.documents'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '["chunk_count", "content_hash", "created_at", "description", "error_message", "file_name", "file_size", "file_type", "id", "image_count", "import_batch_id", "index_generation_id", "metadata", "owner_id", "page_count", "search_tsv", "source_path", "status", "storage_path", "title", "title_search_tsv", "updated_at"]'::jsonb then raise exception 'main_txt_columns_preimage_mismatch: documents'; end if;
if (select jsonb_agg(a.attname order by a.attname) from pg_attribute a where a.attrelid='public.document_pages'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '["created_at", "document_id", "id", "metadata", "ocr_used", "page_number", "text"]'::jsonb then raise exception 'main_txt_columns_preimage_mismatch: document_pages'; end if;
if (select jsonb_agg(a.attname order by a.attname) from pg_attribute a where a.attrelid='public.ingestion_jobs'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '["attempt_count", "batch_id", "completed_at", "created_at", "document_id", "error_message", "id", "locked_at", "locked_by", "max_attempts", "next_run_at", "progress", "stage", "started_at", "status", "updated_at"]'::jsonb then raise exception 'main_txt_columns_preimage_mismatch: ingestion_jobs'; end if;
if (select jsonb_agg(a.attname order by a.attname) from pg_attribute a where a.attrelid='public.indexing_v3_agent_jobs'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '["attempt_count", "created_at", "document_id", "enrichment_status", "id", "last_error", "locked_at", "locked_by", "max_attempts", "metadata", "next_run_at", "status", "updated_at", "version"]'::jsonb then raise exception 'main_txt_columns_preimage_mismatch: indexing_v3_agent_jobs'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_chunks'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "anchor_id", "type": "text", "notNull": false, "default": null}, {"name": "chunk_index", "type": "integer", "notNull": true, "default": null}, {"name": "content", "type": "text", "notNull": true, "default": null}, {"name": "content_hash", "type": "text", "notNull": false, "default": null}, {"name": "created_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "document_id", "type": "uuid", "notNull": true, "default": null}, {"name": "embedding", "type": "vector(1536)", "notNull": true, "default": null}, {"name": "heading_level", "type": "integer", "notNull": false, "default": null}, {"name": "id", "type": "uuid", "notNull": true, "default": "gen_random_uuid()"}, {"name": "image_ids", "type": "uuid[]", "notNull": true, "default": "''{}''::uuid[]"}, {"name": "index_generation_id", "type": "uuid", "notNull": false, "default": null}, {"name": "metadata", "type": "jsonb", "notNull": true, "default": "''{}''::jsonb"}, {"name": "page_number", "type": "integer", "notNull": false, "default": null}, {"name": "parent_heading", "type": "text", "notNull": false, "default": null}, {"name": "retrieval_synopsis", "type": "text", "notNull": false, "default": null}, {"name": "search_tsv", "type": "tsvector", "notNull": false, "default": "to_tsvector(''english''::regconfig, ((((COALESCE(section_heading, ''''::text) || '' ''::text) || COALESCE(retrieval_synopsis, ''''::text)) || '' ''::text) || content))"}, {"name": "section_heading", "type": "text", "notNull": false, "default": null}, {"name": "section_path", "type": "text[]", "notNull": true, "default": "''{}''::text[]"}, {"name": "token_estimate", "type": "integer", "notNull": true, "default": "0"}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_chunks'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_embedding_fields'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "content", "type": "text", "default": null, "notNull": true}, {"name": "content_hash", "type": "text", "default": null, "notNull": true}, {"name": "created_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}, {"name": "document_id", "type": "uuid", "default": null, "notNull": true}, {"name": "embedding", "type": "vector(1536)", "default": null, "notNull": true}, {"name": "field_type", "type": "text", "default": null, "notNull": true}, {"name": "id", "type": "uuid", "default": "gen_random_uuid()", "notNull": true}, {"name": "index_generation_id", "type": "uuid", "default": null, "notNull": false}, {"name": "metadata", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "owner_id", "type": "uuid", "default": null, "notNull": false}, {"name": "search_tsv", "type": "tsvector", "default": "to_tsvector(''english''::regconfig, content)", "notNull": false}, {"name": "source_chunk_id", "type": "uuid", "default": null, "notNull": false}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_embedding_fields'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_images'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "bbox", "type": "jsonb", "default": null, "notNull": false}, {"name": "caption", "type": "text", "default": "''''::text", "notNull": true}, {"name": "caption_confidence", "type": "real", "default": null, "notNull": false}, {"name": "clinical_priority_score", "type": "real", "default": null, "notNull": false}, {"name": "clinical_relevance_score", "type": "real", "default": "0", "notNull": true}, {"name": "created_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}, {"name": "crop_completeness", "type": "real", "default": null, "notNull": false}, {"name": "document_id", "type": "uuid", "default": null, "notNull": true}, {"name": "height", "type": "integer", "default": null, "notNull": false}, {"name": "id", "type": "uuid", "default": "gen_random_uuid()", "notNull": true}, {"name": "image_hash", "type": "text", "default": null, "notNull": false}, {"name": "image_quality_score", "type": "real", "default": null, "notNull": false}, {"name": "image_type", "type": "text", "default": "''unclear''::text", "notNull": true}, {"name": "index_generation_id", "type": "uuid", "default": null, "notNull": false}, {"name": "labels", "type": "text[]", "default": "''{}''::text[]", "notNull": true}, {"name": "metadata", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "mime_type", "type": "text", "default": "''image/png''::text", "notNull": true}, {"name": "ocr_text_density", "type": "real", "default": null, "notNull": false}, {"name": "page_number", "type": "integer", "default": null, "notNull": false}, {"name": "perceptual_hash", "type": "text", "default": null, "notNull": false}, {"name": "searchable", "type": "boolean", "default": "true", "notNull": true}, {"name": "skip_reason", "type": "text", "default": null, "notNull": false}, {"name": "source_kind", "type": "text", "default": "''embedded''::text", "notNull": true}, {"name": "storage_path", "type": "text", "default": null, "notNull": true}, {"name": "structured_extraction_confidence", "type": "real", "default": null, "notNull": false}, {"name": "visual_duplicate_group", "type": "text", "default": null, "notNull": false}, {"name": "width", "type": "integer", "default": null, "notNull": false}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_images'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_index_quality'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "anchor_coverage", "type": "real", "default": null, "notNull": false}, {"name": "document_id", "type": "uuid", "default": null, "notNull": true}, {"name": "extraction_quality", "type": "text", "default": "''unknown''::text", "notNull": true}, {"name": "issues", "type": "text[]", "default": "''{}''::text[]", "notNull": true}, {"name": "metrics", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "model_fallback_rate", "type": "real", "default": null, "notNull": false}, {"name": "noisy_unit_rate", "type": "real", "default": null, "notNull": false}, {"name": "owner_id", "type": "uuid", "default": null, "notNull": false}, {"name": "quality_score", "type": "real", "default": "0", "notNull": true}, {"name": "retrievable_visual_hit", "type": "boolean", "default": null, "notNull": false}, {"name": "source_span_coverage", "type": "real", "default": null, "notNull": false}, {"name": "typed_unit_coverage", "type": "real", "default": null, "notNull": false}, {"name": "updated_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_index_quality'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_index_units'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "artifact_generation_id", "type": "uuid", "default": null, "notNull": false}, {"name": "content", "type": "text", "default": null, "notNull": true}, {"name": "created_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}, {"name": "document_id", "type": "uuid", "default": null, "notNull": true}, {"name": "embedding", "type": "vector(1536)", "default": null, "notNull": true}, {"name": "extraction_mode", "type": "text", "default": "''deterministic''::text", "notNull": true}, {"name": "heading_path", "type": "text[]", "default": "''{}''::text[]", "notNull": true}, {"name": "id", "type": "uuid", "default": "gen_random_uuid()", "notNull": true}, {"name": "index_generation_id", "type": "uuid", "default": null, "notNull": false}, {"name": "metadata", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "normalized_terms", "type": "text[]", "default": "''{}''::text[]", "notNull": true}, {"name": "owner_id", "type": "uuid", "default": null, "notNull": false}, {"name": "page_end", "type": "integer", "default": null, "notNull": false}, {"name": "page_start", "type": "integer", "default": null, "notNull": false}, {"name": "producer", "type": "text", "default": null, "notNull": false}, {"name": "quality_score", "type": "real", "default": "0.7", "notNull": true}, {"name": "search_tsv", "type": "tsvector", "default": "to_tsvector(''english''::regconfig, ((((COALESCE(unit_type, ''''::text) || '' ''::text) || COALESCE(title, ''''::text)) || '' ''::text) || COALESCE(content, ''''::text)))", "notNull": false}, {"name": "source_chunk_id", "type": "uuid", "default": null, "notNull": false}, {"name": "source_image_id", "type": "uuid", "default": null, "notNull": false}, {"name": "source_span", "type": "jsonb", "default": null, "notNull": false}, {"name": "title", "type": "text", "default": null, "notNull": true}, {"name": "unit_type", "type": "text", "default": null, "notNull": true}, {"name": "updated_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_index_units'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_labels'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "confidence", "type": "real", "default": "0.5", "notNull": true}, {"name": "created_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}, {"name": "document_id", "type": "uuid", "default": null, "notNull": true}, {"name": "id", "type": "uuid", "default": "gen_random_uuid()", "notNull": true}, {"name": "label", "type": "text", "default": null, "notNull": true}, {"name": "label_type", "type": "text", "default": null, "notNull": true}, {"name": "metadata", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "owner_id", "type": "uuid", "default": null, "notNull": false}, {"name": "source", "type": "text", "default": "''generated''::text", "notNull": true}, {"name": "updated_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_labels'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_memory_cards'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "artifact_generation_id", "type": "uuid", "default": null, "notNull": false}, {"name": "card_type", "type": "text", "default": null, "notNull": true}, {"name": "confidence", "type": "real", "default": "0.5", "notNull": true}, {"name": "content", "type": "text", "default": null, "notNull": true}, {"name": "created_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}, {"name": "document_id", "type": "uuid", "default": null, "notNull": true}, {"name": "embedding", "type": "vector(1536)", "default": null, "notNull": true}, {"name": "id", "type": "uuid", "default": "gen_random_uuid()", "notNull": true}, {"name": "index_generation_id", "type": "uuid", "default": null, "notNull": false}, {"name": "metadata", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "normalized_terms", "type": "text[]", "default": "''{}''::text[]", "notNull": true}, {"name": "owner_id", "type": "uuid", "default": null, "notNull": false}, {"name": "page_number", "type": "integer", "default": null, "notNull": false}, {"name": "producer", "type": "text", "default": null, "notNull": false}, {"name": "search_tsv", "type": "tsvector", "default": "to_tsvector(''english''::regconfig, ((COALESCE(title, ''''::text) || '' ''::text) || COALESCE(content, ''''::text)))", "notNull": false}, {"name": "section_id", "type": "uuid", "default": null, "notNull": false}, {"name": "source_chunk_ids", "type": "uuid[]", "default": "''{}''::uuid[]", "notNull": true}, {"name": "source_image_ids", "type": "uuid[]", "default": "''{}''::uuid[]", "notNull": true}, {"name": "title", "type": "text", "default": null, "notNull": true}, {"name": "updated_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_memory_cards'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_pages'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "created_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "document_id", "type": "uuid", "notNull": true, "default": null}, {"name": "id", "type": "uuid", "notNull": true, "default": "gen_random_uuid()"}, {"name": "metadata", "type": "jsonb", "notNull": true, "default": "''{}''::jsonb"}, {"name": "ocr_used", "type": "boolean", "notNull": true, "default": "false"}, {"name": "page_number", "type": "integer", "notNull": true, "default": null}, {"name": "text", "type": "text", "notNull": true, "default": "''''::text"}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_pages'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_publication_approvals'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "approved_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "approving_operator_id", "type": "uuid", "notNull": true, "default": null}, {"name": "decision", "type": "text", "notNull": true, "default": null}, {"name": "document_id", "type": "uuid", "notNull": true, "default": null}, {"name": "evidence_references", "type": "text[]", "notNull": true, "default": null}, {"name": "expected_prior_owner_id", "type": "uuid", "notNull": true, "default": null}, {"name": "id", "type": "uuid", "notNull": true, "default": "gen_random_uuid()"}, {"name": "manifest_digest", "type": "text", "notNull": true, "default": null}, {"name": "reason", "type": "text", "notNull": true, "default": null}, {"name": "reviewed_index_generation_id", "type": "uuid", "notNull": false, "default": null}, {"name": "reviewed_state_digest", "type": "text", "notNull": false, "default": null}, {"name": "source_catalogue_key", "type": "text", "notNull": false, "default": null}, {"name": "source_policy_version", "type": "text", "notNull": false, "default": null}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_publication_approvals'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_sections'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "artifact_generation_id", "type": "uuid", "notNull": false, "default": null}, {"name": "chunk_ids", "type": "uuid[]", "notNull": true, "default": "''{}''::uuid[]"}, {"name": "created_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "document_id", "type": "uuid", "notNull": true, "default": null}, {"name": "extraction_quality", "type": "text", "notNull": true, "default": "''unknown''::text"}, {"name": "heading", "type": "text", "notNull": true, "default": null}, {"name": "heading_path", "type": "text[]", "notNull": true, "default": "''{}''::text[]"}, {"name": "id", "type": "uuid", "notNull": true, "default": "gen_random_uuid()"}, {"name": "index_generation_id", "type": "uuid", "notNull": false, "default": null}, {"name": "metadata", "type": "jsonb", "notNull": true, "default": "''{}''::jsonb"}, {"name": "owner_id", "type": "uuid", "notNull": false, "default": null}, {"name": "page_end", "type": "integer", "notNull": false, "default": null}, {"name": "page_start", "type": "integer", "notNull": false, "default": null}, {"name": "producer", "type": "text", "notNull": false, "default": null}, {"name": "section_index", "type": "integer", "notNull": true, "default": null}, {"name": "summary", "type": "text", "notNull": true, "default": "''''::text"}, {"name": "tags", "type": "text[]", "notNull": true, "default": "''{}''::text[]"}, {"name": "updated_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_sections'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_summaries'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "clinical_specifics", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "created_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}, {"name": "document_id", "type": "uuid", "default": null, "notNull": true}, {"name": "generated_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}, {"name": "id", "type": "uuid", "default": "gen_random_uuid()", "notNull": true}, {"name": "metadata", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "model", "type": "text", "default": null, "notNull": false}, {"name": "owner_id", "type": "uuid", "default": null, "notNull": false}, {"name": "source_chunk_ids", "type": "uuid[]", "default": "''{}''::uuid[]", "notNull": true}, {"name": "source_image_ids", "type": "uuid[]", "default": "''{}''::uuid[]", "notNull": true}, {"name": "summary", "type": "text", "default": null, "notNull": true}, {"name": "updated_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_summaries'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.document_table_facts'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "action", "type": "text", "default": null, "notNull": false}, {"name": "clinical_parameter", "type": "text", "default": null, "notNull": false}, {"name": "created_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}, {"name": "document_id", "type": "uuid", "default": null, "notNull": true}, {"name": "id", "type": "uuid", "default": "gen_random_uuid()", "notNull": true}, {"name": "index_generation_id", "type": "uuid", "default": null, "notNull": false}, {"name": "metadata", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "normalized_terms", "type": "text[]", "default": "''{}''::text[]", "notNull": true}, {"name": "owner_id", "type": "uuid", "default": null, "notNull": false}, {"name": "page_number", "type": "integer", "default": null, "notNull": false}, {"name": "row_label", "type": "text", "default": null, "notNull": false}, {"name": "search_tsv", "type": "tsvector", "default": "to_tsvector(''english''::regconfig, ((((((((COALESCE(table_title, ''''::text) || '' ''::text) || COALESCE(row_label, ''''::text)) || '' ''::text) || COALESCE(clinical_parameter, ''''::text)) || '' ''::text) || COALESCE(threshold_value, ''''::text)) || '' ''::text) || COALESCE(action, ''''::text)))", "notNull": false}, {"name": "source_chunk_id", "type": "uuid", "default": null, "notNull": false}, {"name": "source_image_id", "type": "uuid", "default": null, "notNull": false}, {"name": "table_title", "type": "text", "default": null, "notNull": false}, {"name": "threshold_value", "type": "text", "default": null, "notNull": false}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: document_table_facts'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.documents'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "chunk_count", "type": "integer", "notNull": true, "default": "0"}, {"name": "content_hash", "type": "text", "notNull": false, "default": null}, {"name": "created_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "description", "type": "text", "notNull": false, "default": null}, {"name": "error_message", "type": "text", "notNull": false, "default": null}, {"name": "file_name", "type": "text", "notNull": true, "default": null}, {"name": "file_size", "type": "bigint", "notNull": true, "default": "0"}, {"name": "file_type", "type": "text", "notNull": true, "default": null}, {"name": "id", "type": "uuid", "notNull": true, "default": "gen_random_uuid()"}, {"name": "image_count", "type": "integer", "notNull": true, "default": "0"}, {"name": "import_batch_id", "type": "uuid", "notNull": false, "default": null}, {"name": "index_generation_id", "type": "uuid", "notNull": false, "default": "\nCASE\n    WHEN ((metadata ->> ''index_generation_id''::text) ~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$''::text) THEN ((metadata ->> ''index_generation_id''::text))::uuid\n    ELSE NULL::uuid\nEND"}, {"name": "metadata", "type": "jsonb", "notNull": true, "default": "''{}''::jsonb"}, {"name": "owner_id", "type": "uuid", "notNull": false, "default": null}, {"name": "page_count", "type": "integer", "notNull": true, "default": "0"}, {"name": "search_tsv", "type": "tsvector", "notNull": false, "default": "to_tsvector(''english''::regconfig, ((COALESCE(title, ''''::text) || '' ''::text) || COALESCE(file_name, ''''::text)))"}, {"name": "source_path", "type": "text", "notNull": false, "default": null}, {"name": "status", "type": "text", "notNull": true, "default": "''queued''::text"}, {"name": "storage_path", "type": "text", "notNull": true, "default": null}, {"name": "title", "type": "text", "notNull": true, "default": null}, {"name": "title_search_tsv", "type": "tsvector", "notNull": false, "default": "to_tsvector(''english''::regconfig, regexp_replace(regexp_replace(((COALESCE(title, ''''::text) || '' ''::text) || COALESCE(file_name, ''''::text)), ''([[:lower:]])([[:upper:]])''::text, ''\\1 \\2''::text, ''g''::text), ''[^[:alnum:]]+''::text, '' ''::text, ''g''::text))"}, {"name": "updated_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: documents'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.import_batches'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "completed_at", "type": "timestamp with time zone", "default": null, "notNull": false}, {"name": "created_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}, {"name": "failed_files", "type": "integer", "default": "0", "notNull": true}, {"name": "id", "type": "uuid", "default": "gen_random_uuid()", "notNull": true}, {"name": "include_glob", "type": "text", "default": "''**/*.pdf''::text", "notNull": true}, {"name": "metadata", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "name", "type": "text", "default": null, "notNull": true}, {"name": "owner_id", "type": "uuid", "default": null, "notNull": false}, {"name": "queued_files", "type": "integer", "default": "0", "notNull": true}, {"name": "skipped_files", "type": "integer", "default": "0", "notNull": true}, {"name": "source_root", "type": "text", "default": null, "notNull": false}, {"name": "status", "type": "text", "default": "''queued''::text", "notNull": true}, {"name": "total_bytes", "type": "bigint", "default": "0", "notNull": true}, {"name": "total_files", "type": "integer", "default": "0", "notNull": true}, {"name": "updated_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: import_batches'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.indexing_v3_agent_jobs'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "attempt_count", "type": "integer", "notNull": true, "default": "0"}, {"name": "created_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "document_id", "type": "uuid", "notNull": true, "default": null}, {"name": "enrichment_status", "type": "text", "notNull": true, "default": "''pending''::text"}, {"name": "id", "type": "uuid", "notNull": true, "default": "extensions.gen_random_uuid()"}, {"name": "last_error", "type": "text", "notNull": false, "default": null}, {"name": "locked_at", "type": "timestamp with time zone", "notNull": false, "default": null}, {"name": "locked_by", "type": "text", "notNull": false, "default": null}, {"name": "max_attempts", "type": "integer", "notNull": true, "default": "3"}, {"name": "metadata", "type": "jsonb", "notNull": true, "default": "''{}''::jsonb"}, {"name": "next_run_at", "type": "timestamp with time zone", "notNull": false, "default": null}, {"name": "status", "type": "text", "notNull": true, "default": "''pending''::text"}, {"name": "updated_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "version", "type": "text", "notNull": true, "default": "''visual-core-v3''::text"}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: indexing_v3_agent_jobs'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.ingestion_job_stages'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "artifact_counts", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "created_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}, {"name": "document_id", "type": "uuid", "default": null, "notNull": true}, {"name": "error_class", "type": "text", "default": null, "notNull": false}, {"name": "error_message", "type": "text", "default": null, "notNull": false}, {"name": "finished_at", "type": "timestamp with time zone", "default": null, "notNull": false}, {"name": "id", "type": "uuid", "default": "gen_random_uuid()", "notNull": true}, {"name": "job_id", "type": "uuid", "default": null, "notNull": true}, {"name": "metadata", "type": "jsonb", "default": "''{}''::jsonb", "notNull": true}, {"name": "retry_count", "type": "integer", "default": "0", "notNull": true}, {"name": "stage_name", "type": "text", "default": null, "notNull": true}, {"name": "stage_status", "type": "text", "default": "''started''::text", "notNull": true}, {"name": "started_at", "type": "timestamp with time zone", "default": "now()", "notNull": true}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: ingestion_job_stages'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.ingestion_jobs'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "attempt_count", "type": "integer", "notNull": true, "default": "0"}, {"name": "batch_id", "type": "uuid", "notNull": false, "default": null}, {"name": "completed_at", "type": "timestamp with time zone", "notNull": false, "default": null}, {"name": "created_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "document_id", "type": "uuid", "notNull": true, "default": null}, {"name": "error_message", "type": "text", "notNull": false, "default": null}, {"name": "id", "type": "uuid", "notNull": true, "default": "gen_random_uuid()"}, {"name": "locked_at", "type": "timestamp with time zone", "notNull": false, "default": null}, {"name": "locked_by", "type": "text", "notNull": false, "default": null}, {"name": "max_attempts", "type": "integer", "notNull": true, "default": "3"}, {"name": "next_run_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "progress", "type": "integer", "notNull": true, "default": "0"}, {"name": "stage", "type": "text", "notNull": true, "default": "''queued''::text"}, {"name": "started_at", "type": "timestamp with time zone", "notNull": false, "default": null}, {"name": "status", "type": "text", "notNull": true, "default": "''pending''::text"}, {"name": "updated_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: ingestion_jobs'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.public_source_activation_events'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "activation_sequence", "type": "bigint", "notNull": true, "default": null}, {"name": "created_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "decision", "type": "text", "notNull": true, "default": null}, {"name": "evidence_references", "type": "text[]", "notNull": true, "default": null}, {"name": "id", "type": "uuid", "notNull": true, "default": "gen_random_uuid()"}, {"name": "manifest_digest", "type": "text", "notNull": true, "default": null}, {"name": "operator_id", "type": "uuid", "notNull": true, "default": null}, {"name": "policy_digest", "type": "text", "notNull": true, "default": null}, {"name": "policy_version", "type": "text", "notNull": true, "default": null}, {"name": "reason", "type": "text", "notNull": true, "default": null}, {"name": "source_catalogue_key", "type": "text", "notNull": true, "default": null}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: public_source_activation_events'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.public_source_policy_entries'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "canonical_host", "type": "text", "notNull": true, "default": null}, {"name": "canonical_url", "type": "text", "notNull": true, "default": null}, {"name": "content_mode", "type": "text", "notNull": true, "default": null}, {"name": "created_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "exact_document_licence", "type": "text", "notNull": true, "default": null}, {"name": "lifecycle", "type": "text", "notNull": true, "default": null}, {"name": "policy_digest", "type": "text", "notNull": true, "default": null}, {"name": "policy_version", "type": "text", "notNull": true, "default": null}, {"name": "source_catalogue_key", "type": "text", "notNull": true, "default": null}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: public_source_policy_entries'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.public_source_upload_attempts'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "claim_expires_at", "type": "timestamp with time zone", "default": null, "notNull": true}, {"name": "claim_token", "type": "uuid", "default": null, "notNull": true}, {"name": "cleanup_not_before", "type": "timestamp with time zone", "default": null, "notNull": true}, {"name": "created_at", "type": "timestamp with time zone", "default": "clock_timestamp()", "notNull": true}, {"name": "id", "type": "uuid", "default": null, "notNull": true}, {"name": "signed_authority_digest", "type": "text", "default": null, "notNull": false}, {"name": "signed_authority_expires_at", "type": "timestamp with time zone", "default": null, "notNull": false}, {"name": "state", "type": "text", "default": null, "notNull": true}, {"name": "storage_bucket", "type": "text", "default": null, "notNull": true}, {"name": "storage_path", "type": "text", "default": null, "notNull": true}, {"name": "updated_at", "type": "timestamp with time zone", "default": "clock_timestamp()", "notNull": true}, {"name": "version_id", "type": "uuid", "default": null, "notNull": true}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: public_source_upload_attempts'; end if;
if (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.public_source_versions'::regclass and a.attnum>0 and not a.attisdropped) is distinct from '[{"name": "activation_event_id", "type": "uuid", "notNull": true, "default": null}, {"name": "activation_sequence", "type": "bigint", "notNull": true, "default": null}, {"name": "content_hash", "type": "text", "notNull": true, "default": null}, {"name": "created_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "current_upload_attempt_id", "type": "uuid", "notNull": false, "default": null}, {"name": "exact_canonical_url", "type": "text", "notNull": true, "default": null}, {"name": "exact_version", "type": "text", "notNull": true, "default": null}, {"name": "exact_version_url", "type": "text", "notNull": true, "default": null}, {"name": "extraction_index_generation_id", "type": "uuid", "notNull": false, "default": null}, {"name": "finalized_upload_attempt_id", "type": "uuid", "notNull": false, "default": null}, {"name": "id", "type": "uuid", "notNull": true, "default": null}, {"name": "intended_disposition", "type": "text", "notNull": true, "default": null}, {"name": "licence_evidence_digest", "type": "text", "notNull": true, "default": null}, {"name": "lifecycle", "type": "text", "notNull": true, "default": "''discovered''::text"}, {"name": "raw_response_byte_count", "type": "bigint", "notNull": true, "default": null}, {"name": "raw_response_hash", "type": "text", "notNull": true, "default": null}, {"name": "reservation_key", "type": "text", "notNull": true, "default": null}, {"name": "reserved_document_id", "type": "uuid", "notNull": true, "default": null}, {"name": "reserved_storage_path", "type": "text", "notNull": true, "default": null}, {"name": "retrieved_at", "type": "timestamp with time zone", "notNull": true, "default": null}, {"name": "review_queued_at", "type": "timestamp with time zone", "notNull": false, "default": null}, {"name": "review_reason", "type": "text", "notNull": false, "default": null}, {"name": "source_catalogue_key", "type": "text", "notNull": true, "default": null}, {"name": "source_policy_digest", "type": "text", "notNull": true, "default": null}, {"name": "source_policy_version", "type": "text", "notNull": true, "default": null}, {"name": "staging_document_id", "type": "uuid", "notNull": false, "default": null}, {"name": "steward_id", "type": "uuid", "notNull": true, "default": null}, {"name": "storage_bucket", "type": "text", "notNull": true, "default": null}, {"name": "supersedes_version_id", "type": "uuid", "notNull": false, "default": null}, {"name": "updated_at", "type": "timestamp with time zone", "notNull": true, "default": "now()"}, {"name": "upload_lease_expires_at", "type": "timestamp with time zone", "notNull": true, "default": null}, {"name": "upload_lease_token", "type": "uuid", "notNull": true, "default": null}, {"name": "upload_state", "type": "text", "notNull": true, "default": "''reserved''::text"}]'::jsonb then raise exception 'main_txt_table_shape_preimage_mismatch: public_source_versions'; end if;
if to_regprocedure('public.invoke_ingestion_worker(integer)') is not null then raise exception 'main_txt_legacy_invoker_unexpected'; end if;
end $main_txt_preimage$;

-- atomic cutover write exclusion; ingress must already be paused
lock table public.documents,public.ingestion_jobs,public.indexing_v3_agent_jobs in share row exclusive mode;

-- drained queues required
do $$ begin if exists(select 1 from public.ingestion_jobs where status='processing') or exists(select 1 from public.indexing_v3_agent_jobs where status='processing') then raise exception 'ingestion_lease_migration_drain_required'; end if; end $$;

-- new private retention schema
create schema ingestion_generation_evidence authorization postgres;
revoke all on schema ingestion_generation_evidence from public,anon,authenticated,service_role;

-- selected structural dependency
create table if not exists public.document_admission_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  ingestion_job_id uuid not null,
  staging_owner_id uuid not null references auth.users(id) on delete restrict,
  source_channel text not null,
  actor_kind text not null,
  administrator_id uuid,
  backend_principal text,
  correlation_id uuid not null,
  admission_policy_version text not null,
  content_sha256 text not null,
  file_name_sha256 text not null,
  storage_path_sha256 text not null,
  mime_type text not null,
  byte_count bigint not null,
  authority jsonb not null,
  admission_digest text not null,
  document_input_digest text not null,
  request_digest text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint document_admission_events_source_channel_check
    check (source_channel in ('admin_api', 'backend_import')),
  constraint document_admission_events_actor_kind_check
    check (actor_kind in ('administrator', 'trusted_backend')),
  constraint document_admission_events_actor_identity_check
    check (
      (actor_kind = 'administrator' and source_channel = 'admin_api'
        and administrator_id is not null and backend_principal is null)
      or
      (actor_kind = 'trusted_backend' and source_channel = 'backend_import'
        and administrator_id is null and backend_principal is not null)
    ),
  constraint document_admission_events_backend_principal_check
    check (backend_principal is null or (
      length(backend_principal) between 1 and 200
      and backend_principal = btrim(backend_principal)
      and backend_principal !~ '[[:cntrl:]]'
    )),
  constraint document_admission_events_policy_check
    check (admission_policy_version = 'trusted-document-admission-v1'),
  constraint document_admission_events_content_sha256_check
    check (content_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_file_name_sha256_check
    check (file_name_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_storage_path_sha256_check
    check (storage_path_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_admission_digest_check
    check (admission_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_document_input_digest_check
    check (document_input_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_request_digest_check
    check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint document_admission_events_byte_count_check
    check (byte_count between 1 and 157286400),
  constraint document_admission_events_authority_check
    check (jsonb_typeof(authority) = 'object')
);

-- selected structural dependency
create table ingestion_generation_evidence.candidates (
  document_id uuid not null, generation_id uuid not null, job_id uuid not null,
  first_lease_token uuid not null, authority_digest text not null, predecessor_generation_id uuid,
  source_sha256 text not null, source_byte_length bigint not null, source_expectation jsonb not null,
  source_expectation_bytes bytea not null, source_expectation_digest text not null,
  source_snapshot jsonb not null, profile_version text not null,
  registration jsonb not null, expected_inventory_digest text,
  created_at timestamptz not null default clock_timestamp(),
  primary key(document_id,generation_id),
  check(source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  check(source_byte_length between 1 and 157286400),
  check(profile_version='u10-u12-prerequisite-profile-v1')
);

-- selected structural dependency
create table ingestion_generation_evidence.producer_declarations (
  document_id uuid not null, generation_id uuid not null, family text not null, group_key text not null,
  declaration jsonb not null, first_lease_token uuid not null,
  primary key(document_id,generation_id,family,group_key),
  foreign key(document_id,generation_id) references ingestion_generation_evidence.candidates
);

-- selected structural dependency
create table ingestion_generation_evidence.unit_declarations (
  document_id uuid not null, generation_id uuid not null, family text not null, unit_key text not null,
  group_key text not null, declaration jsonb not null,
  primary key(document_id,generation_id,family,unit_key),
  foreign key(document_id,generation_id,family,group_key) references ingestion_generation_evidence.producer_declarations
);

-- selected structural dependency
create table ingestion_generation_evidence.retained_artifacts (
  document_id uuid not null, generation_id uuid not null, family text not null, unit_key text not null,
  group_key text not null, representation text not null, source_sha256 text not null,
  artifact_bytes bytea not null, sha256 text not null, byte_length bigint not null, locator text not null,
  primary key(document_id,generation_id,family,unit_key),
  foreign key(document_id,generation_id,family,unit_key) references ingestion_generation_evidence.unit_declarations,
  check(byte_length=octet_length(artifact_bytes)),
  check(sha256='sha256:'||encode(extensions.digest(artifact_bytes,'sha256'),'hex'))
);

-- selected structural dependency
create table ingestion_generation_evidence.outcomes (
  document_id uuid not null, generation_id uuid not null, family text not null, unit_key text not null,
  group_key text not null, outcome jsonb not null,
  primary key(document_id,generation_id,family,unit_key),
  foreign key(document_id,generation_id,family,unit_key) references ingestion_generation_evidence.unit_declarations
);

-- selected structural dependency
create table ingestion_generation_evidence.prerequisite_accounting (
  document_id uuid not null, generation_id uuid not null, snapshot_digest text not null,
  snapshot jsonb not null, created_at timestamptz not null default clock_timestamp(),
  primary key(document_id,generation_id,snapshot_digest),
  foreign key(document_id,generation_id) references ingestion_generation_evidence.candidates
);

-- selected structural dependency
create table ingestion_generation_evidence.scoped_projection_expectations (
 document_id uuid not null,generation_id uuid not null,projection_id uuid not null,
 manifest jsonb not null,manifest_bytes bytea not null,sha256 text not null,byte_length bigint not null,
 primary key(document_id,generation_id,projection_id),
 foreign key(document_id,generation_id) references ingestion_generation_evidence.candidates,
 check(byte_length=octet_length(manifest_bytes) and byte_length between 1 and 2097152),
 check(sha256='sha256:'||encode(extensions.digest(manifest_bytes,'sha256'),'hex'))
);

-- selected structural dependency
create table ingestion_generation_evidence.scoped_projection_rows (
 document_id uuid not null,generation_id uuid not null,projection_id uuid not null,
 family text not null check(family in ('images','chunks','table_facts')),row_id uuid not null,row_data jsonb not null,
 primary key(document_id,generation_id,projection_id,family,row_id),
 foreign key(document_id,generation_id,projection_id) references ingestion_generation_evidence.scoped_projection_expectations
);

-- selected structural dependency
create table ingestion_generation_evidence.visual_unit_expectations (
 document_id uuid not null,generation_id uuid not null,projection_id uuid not null,parent_projection_id uuid not null,
 seed_bytes bytea not null,parent_bytes bytea not null,manifest_bytes bytea not null,manifest jsonb not null,
 seed_sha256 text not null,parent_sha256 text not null,manifest_sha256 text not null,issued_rows jsonb not null,
 primary key(document_id,generation_id,projection_id),
 foreign key(document_id,generation_id) references ingestion_generation_evidence.candidates,
 foreign key(document_id,generation_id,parent_projection_id) references ingestion_generation_evidence.scoped_projection_expectations,
 check(octet_length(seed_bytes) between 1 and 2097152 and seed_sha256='sha256:'||encode(extensions.digest(seed_bytes,'sha256'),'hex')),
 check(octet_length(parent_bytes) between 1 and 2097152 and parent_sha256='sha256:'||encode(extensions.digest(parent_bytes,'sha256'),'hex')),
 check(octet_length(manifest_bytes) between 1 and 2097152 and manifest_sha256='sha256:'||encode(extensions.digest(manifest_bytes,'sha256'),'hex')),
 check(jsonb_typeof(issued_rows)='array' and jsonb_array_length(issued_rows)=4)
);

-- selected structural dependency
create table ingestion_generation_evidence.visual_unit_rows (
 document_id uuid not null,generation_id uuid not null,projection_id uuid not null,ordinal integer not null check(ordinal between 1 and 4),
 row_id uuid not null,row_data jsonb not null,
 primary key(document_id,generation_id,projection_id,ordinal),unique(document_id,generation_id,projection_id,row_id),
 foreign key(document_id,generation_id,projection_id) references ingestion_generation_evidence.visual_unit_expectations,
 check(jsonb_typeof(row_data)='object')
);

-- selected structural dependency
-- Copy column types (including vector dimensions), NOT NULL/check constraints and normalized
-- defaults/generated columns, but no public indexes, foreign keys, policies, grants or triggers.
create table ingestion_generation_evidence.candidate_chunk_rows (
  like public.document_chunks including defaults including constraints including generated,
  candidate_owner_id uuid,
  candidate_job_id uuid not null,
  candidate_lease_token uuid not null,
  candidate_authority_digest text not null check(candidate_authority_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_source_sha256 text not null check(candidate_source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  candidate_source_expectation_digest text not null check(candidate_source_expectation_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_prepared_sha256 text not null check(candidate_prepared_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  primary key(id),
  unique(document_id,index_generation_id,chunk_index),
  foreign key(document_id,index_generation_id) references ingestion_generation_evidence.candidates(document_id,generation_id)
);

-- selected structural dependency
create table ingestion_generation_evidence.managed_vector_packets (
  document_id uuid not null,generation_id uuid not null,
  identity jsonb not null,plan_digest text not null,request jsonb not null,
  population_bytes bytea not null,population_sha256 text not null,
  primary key(document_id,generation_id),
  foreign key(document_id,generation_id) references ingestion_generation_evidence.candidates,
  check(plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  check(population_sha256='sha256:'||encode(extensions.digest(population_bytes,'sha256'),'hex'))
);

-- selected queue/stage/page/layout schema alteration
alter table public.ingestion_jobs
  add column lease_token uuid,
  add column lease_expected_generation_id uuid,
  add column lease_write_generation_id uuid,
  add column lease_authority_digest text,
  add column lease_expires_at timestamptz,
  add column lease_duration_seconds integer,
  add constraint ingestion_jobs_lease_tuple check (
    (lease_authority_digest is null or lease_authority_digest ~ '^sha256:[0-9a-f]{64}$')
    and (lease_duration_seconds is null or lease_duration_seconds between 60 and 86400)
    and (status <> 'processing' or (lease_token is not null and locked_by is not null
      and btrim(locked_by) <> '' and lease_write_generation_id is not null
      and lease_authority_digest is not null and lease_expires_at is not null and lease_duration_seconds is not null))
  );

-- selected queue/stage/page/layout schema alteration
-- Fenced claims and terminal outcomes clear scheduling once the current attempt
-- owns the row. The inherited schema kept this column NOT NULL, which makes the
-- accepted lease transition fail before any fence can be established.
alter table public.ingestion_jobs alter column next_run_at drop not null;

-- selected queue/stage/page/layout schema alteration
alter table public.indexing_v3_agent_jobs
  add column lease_token uuid,
  add column lease_expected_generation_id uuid,
  add column lease_write_generation_id uuid,
  add column lease_authority_digest text,
  add column lease_expires_at timestamptz,
  add column lease_duration_seconds integer,
  add constraint indexing_v3_agent_jobs_lease_tuple check (
    (lease_authority_digest is null or lease_authority_digest ~ '^sha256:[0-9a-f]{64}$')
    and (lease_duration_seconds is null or lease_duration_seconds between 60 and 86400)
    and (status <> 'processing' or (lease_token is not null and locked_by is not null
      and btrim(locked_by) <> '' and lease_expected_generation_id is not null and lease_write_generation_id is not null
      and lease_authority_digest is not null and lease_expires_at is not null and lease_duration_seconds is not null))
  );

-- selected queue/stage/page/layout schema alteration
alter table public.ingestion_job_stages add column job_kind text check(job_kind in ('node','indexing_v3')),
  add column lease_token uuid, add column index_generation_id uuid;

-- selected queue/stage/page/layout schema alteration
-- Explicit legacy compatibility, with no invented historical generation lineage.
alter table public.documents add column page_storage_mode text not null default 'legacy_unqualified' check(page_storage_mode in ('legacy_unqualified','typed_exact'));

-- selected queue/stage/page/layout schema alteration
alter table public.document_pages add column index_generation_id uuid;

-- selected queue/stage/page/layout schema alteration
alter table public.document_pages drop constraint document_pages_document_id_page_number_key;

-- selected queue/stage/page/layout schema alteration
-- Retain the independently supplied heading plan before managed TXT completion.
-- Existing completed generations are deliberately not reconstructed from producer rows.
alter table ingestion_generation_evidence.candidates
 add column source_section_layout jsonb,
 add column source_section_layout_bytes bytea,
 add column source_section_layout_digest text,
 add constraint admin_text_source_section_layout_complete check (
   (source_section_layout is null and source_section_layout_bytes is null and source_section_layout_digest is null)
   or (source_section_layout is not null and source_section_layout_bytes is not null
     and source_section_layout_digest is not null and source_section_layout_digest ~ '^sha256:[0-9a-f]{64}$'
     and source_section_layout_digest='sha256:'||encode(extensions.digest(source_section_layout_bytes,'sha256'),'hex')));

-- selected function ingestion_generation_evidence.admin_text_utf16_length
-- JS UTF16 lengths and whitespace fingerprints are required for the unchanged scorer.
create function ingestion_generation_evidence.admin_text_utf16_length(p_text text)
returns bigint language sql immutable set search_path='' as $$
 select coalesce(sum(case when ascii(substr(p_text,n,1))>65535 then 2 else 1 end),0)::bigint
 from generate_series(1,length(p_text)) n
$$;

-- selected function ingestion_generation_evidence.admin_text_quality
create function ingestion_generation_evidence.admin_text_quality(c ingestion_generation_evidence.candidates,p_sections integer)
returns jsonb language plpgsql stable set search_path='' as $$
declare total integer; chars bigint; avg_len numeric; dup numeric; heading numeric; path numeric; score numeric; issues text[]:='{}'; metrics jsonb;
 ws text:=E'\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
begin
 select count(*),avg(ingestion_generation_evidence.admin_text_utf16_length(content)),
   1-count(distinct encode(extensions.digest(convert_to(btrim(regexp_replace(content,'['||ws||']+',' ','g')),'UTF8'),'sha256'),'hex'))::numeric/greatest(count(*),1),
   count(*) filter(where section_heading is not null and section_heading<>'')::numeric/greatest(count(*),1),
   count(*) filter(where cardinality(section_path)>0)::numeric/greatest(count(*),1)
 into total,avg_len,dup,heading,path from ingestion_generation_evidence.candidate_chunk_rows where document_id=c.document_id and index_generation_id=c.generation_id;
 select ingestion_generation_evidence.admin_text_utf16_length(convert_from(artifact_bytes,'UTF8')) into strict chars
 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source';
 if total=0 then issues:=array_append(issues,'no indexed chunks');end if;
 if total<1 then issues:=array_append(issues,'low chunk coverage for page count');end if;
 if avg_len<120 and total>0 then issues:=array_append(issues,'short average chunks');end if;
 if heading<0.08 and total>=8 then issues:=array_append(issues,'low heading density');end if;
 if path<0.3 and total>=8 then issues:=array_append(issues,'low section path coverage');end if;
 if dup>0.18 then issues:=array_append(issues,'high duplicate chunk ratio');end if;
 if chars<80 then issues:=array_append(issues,'low extracted text volume');end if;
 if p_sections=0 then issues:=array_append(issues,'no structured sections');end if;
 issues:=issues||array['no memory cards','missing document title embedding','missing document summary embedding'];
 score:=greatest(0,least(1,1-cardinality(issues)*0.055-least(0.22,dup*0.55)-greatest(0,0.12-heading)*0.45-greatest(0,0.55-path)*0.08));
 metrics:=jsonb_build_object('page_count',1,'ocr_page_count',0,'needs_ocr_page_count',0,'text_character_count',chars,
   'extracted_image_count',0,'searchable_image_count',0,'skipped_image_count',0,
   'avg_chunk_length',round(avg_len,1),'duplicate_chunk_ratio',round(dup,3),'heading_density',round(heading,3),'section_path_coverage',round(path,3),
   'table_extraction_coverage',null,'searchable_image_coverage',null,'visual_unit_coverage',null,'average_image_quality_score',null,
   'average_crop_completeness',null,'average_structured_visual_confidence',null,'ocr_coverage',0,'average_page_text_chars',chars,
   'section_count',p_sections,'memory_card_count',0,'document_embedding_field_types','[]'::jsonb);
 return jsonb_build_object('quality_score',round(score,3),'extraction_quality',case when score>=0.82 then 'good' when score>=0.52 then 'partial' else 'poor' end,
   'issues',to_jsonb(issues||array['optional_enrichment_deferred','clinical_approval_not_assessed']),'metrics',metrics);
end $$;

-- selected function ingestion_generation_evidence.keys
create function ingestion_generation_evidence.keys(p_value jsonb,p_keys text[]) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='object' and p_value ?& p_keys and p_value-p_keys='{}'::jsonb,false)
$$;

-- selected function ingestion_generation_evidence.admin_reference_context
-- One lock path, including the no-event NHMRC branch; old private authority helper stays unchanged.
create function ingestion_generation_evidence.admin_reference_context(p_document_id uuid,p_generation uuid,p_phase text,p_publication_metadata jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare d public.documents; c ingestion_generation_evidence.candidates; seal ingestion_generation_evidence.prerequisite_accounting;
 policy public.public_source_policy_entries; event public.public_source_activation_events; baseline jsonb; metadata jsonb; prepared jsonb; quality jsonb; expected jsonb; owner uuid;
begin
 if p_document_id is null or p_generation is null or p_phase is null or p_phase not in ('private','prepared','published') then raise exception 'admin_reference_scope';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nhmrc',0));
 select * into event from public.public_source_activation_events where source_catalogue_key='nhmrc' order by activation_sequence desc limit 1 for update;
 select * into policy from public.public_source_policy_entries where source_catalogue_key='nhmrc' for share;
 if not found or policy.policy_version is distinct from 'australian-source-policy-v1' or policy.lifecycle is distinct from 'active'
   or policy.content_mode is distinct from 'indexed_content' or policy.exact_document_licence is distinct from 'public_index_permitted'
   or (event.id is not null and (event.decision is distinct from 'activate' or event.policy_version is distinct from policy.policy_version or event.policy_digest is distinct from policy.policy_digest))
   then raise exception 'admin_reference_catalogue_refused';end if;
 select * into d from public.documents where id=p_document_id for update;
 if not found or d.index_generation_id is distinct from p_generation or d.status is distinct from 'indexed'
   or d.metadata ?| array['source_policy_digest','source_activation_event_id','source_canonical_url','source_exact_url','source_exact_version','source_content_hash','licence_evidence_digest','public_source_lifecycle','public_source_version_id','public_source_activation_event_id','public_source_activation_sequence','public_source_steward_id','public_source_storage_bucket','acquisition_disposition','public_source_retrieval_removed_at','public_source_withdrawal_operator_id','public_source_withdrawal_reason','public_source_withdrawn_at']
   or exists(select 1 from public.public_source_versions where staging_document_id=p_document_id or reserved_document_id=p_document_id)
   then raise exception 'admin_reference_document_refused';end if;
 perform 1 from public.ingestion_jobs where document_id=p_document_id order by id for update;
 perform 1 from public.indexing_v3_agent_jobs where document_id=p_document_id order by id for update;
 select * into c from ingestion_generation_evidence.candidates where document_id=p_document_id and generation_id=p_generation for update;
 if not found then raise exception 'admin_reference_candidate_missing';end if;
 -- Protect every current reviewed-state population, including moves from older generations.
 perform 1 from public.document_pages where document_id=p_document_id order by id for share;
 perform 1 from public.document_images where document_id=p_document_id order by id for share;
 perform 1 from public.document_labels where document_id=p_document_id order by id for share;
 perform 1 from public.document_summaries where document_id=p_document_id order by id for share;
 perform 1 from public.document_sections where document_id=p_document_id order by id for share;
 perform 1 from public.document_memory_cards where document_id=p_document_id order by id for share;
 perform 1 from public.document_chunks where document_id=p_document_id order by id for share;
 perform 1 from public.document_table_facts where document_id=p_document_id order by id for share;
 perform 1 from public.document_embedding_fields where document_id=p_document_id order by id for share;
 perform 1 from public.document_index_quality where document_id=p_document_id order by document_id for share;
 perform 1 from public.document_index_units where document_id=p_document_id order by id for share;
 -- The settled TXT seal has no retained bindings for these optional reviewed populations.
 -- Refuse only rows visible under the established reviewed-state predicates; keep older invisible rows.
 if exists(select 1 from public.document_memory_cards m where m.document_id=p_document_id
   and (nullif(coalesce(d.metadata,'{}'::jsonb)->>'index_generation_id','') is null
     or public.is_committed_artifact_generation(m.metadata,d.metadata)))
   then raise exception 'admin_reference_unbound_memory_cards';end if;
 if exists(select 1 from public.document_table_facts f where f.document_id=p_document_id
   and (nullif(coalesce(d.metadata,'{}'::jsonb)->>'index_generation_id','') is null
     or public.is_committed_artifact_generation(f.metadata,d.metadata)))
   then raise exception 'admin_reference_unbound_table_facts';end if;
 if exists(select 1 from public.document_embedding_fields f where f.document_id=p_document_id
   and public.is_committed_artifact_generation(f.metadata,d.metadata))
   then raise exception 'admin_reference_unbound_embedding_fields';end if;
 if exists(select 1 from public.document_index_units u where u.document_id=p_document_id
   and public.is_committed_artifact_generation(u.metadata,d.metadata))
   then raise exception 'admin_reference_unbound_index_units';end if;
 if exists(select 1 from public.document_labels l where l.document_id=p_document_id)
   then raise exception 'admin_reference_unbound_labels';end if;
 if exists(select 1 from public.document_summaries s where s.document_id=p_document_id)
   then raise exception 'admin_reference_unbound_summaries';end if;
 select * into strict seal from ingestion_generation_evidence.prerequisite_accounting where document_id=p_document_id and generation_id=p_generation and snapshot->>'version'='managed-admin-text-seal-v1';
 if seal.snapshot->'packet'->>'version' is distinct from 'managed-admin-text-complete-v2' then raise exception 'admin_reference_v2_completion_required';end if;
 quality:=ingestion_generation_evidence.admin_text_quality(c,jsonb_array_length(seal.snapshot->'packet'->'sections'));
 if quality->>'extraction_quality' is distinct from 'good' or quality is distinct from seal.snapshot->'packet'->'quality' then raise exception 'admin_reference_quality_refused';end if;
 quality:=quality||jsonb_build_object('metrics',quality->'metrics'||jsonb_build_object('source_byte_length',c.source_byte_length,'text_byte_equality',true,'chunk_byte_coverage',true,'chunk_count',jsonb_array_length(seal.snapshot->'packet'->'chunks'),'admin_text_seal_digest',seal.snapshot_digest));
 metadata:=(c.source_snapshot->'metadata')||jsonb_build_object('index_generation_id',c.generation_id,'extraction_quality',quality->'extraction_quality','index_quality_score',quality->'quality_score','index_quality_issues',quality->'issues','index_quality_metrics',quality->'metrics','section_count',jsonb_array_length(seal.snapshot->'packet'->'sections'),'memory_card_count',0);
 if metadata->>'corpus_scope' is distinct from 'uploaded_local' or metadata ?| array['source_catalogue_key','source_policy_version']
   or (metadata->'publisher_code' is not null and metadata->'publisher_code' not in ('null'::jsonb,'"NHMRC"'::jsonb))
   or metadata->>'publisher' is distinct from 'National Health and Medical Research Council' or metadata->>'jurisdiction' is distinct from 'Australia'
   or metadata->>'source_role' is distinct from 'clinical_guideline' or metadata->>'source_kind' is distinct from 'document'
   or metadata->>'content_mode' is distinct from 'indexed_content' or metadata->>'licence_policy' is distinct from 'public_index_permitted'
   or metadata->'authority'->>'rightsEvidenceRef' is null or coalesce(btrim(metadata->'authority'->>'rightsEvidenceRef'),'')=''
   then raise exception 'admin_reference_source_refused';end if;
 baseline:=c.source_snapshot||jsonb_build_object('page_storage_mode','typed_exact','status','indexed','page_count',1,'chunk_count',jsonb_array_length(seal.snapshot->'packet'->'chunks'),'image_count',0,'error_message',null,'index_generation_id',c.generation_id,'metadata',metadata);
 prepared:=metadata||jsonb_build_object('corpus_scope','australian_public','source_catalogue_key','nhmrc','source_policy_version',policy.policy_version,'publisher_code','NHMRC','change_state','unchanged');
 owner:=(c.source_snapshot->>'owner_id')::uuid;
 expected:=baseline;
 if p_phase='prepared' then expected:=expected||jsonb_build_object('metadata',prepared);end if;
 if p_phase='published' then
   if p_publication_metadata is null or not ingestion_generation_evidence.keys(p_publication_metadata,array['public_corpus','publication_approval_id','publication_manifest_digest','publication_reviewed_state_digest','published_at','publication_manifest_version','publication_source_policy_version','publication_reviewed_index_generation_id'])
     then raise exception 'admin_reference_publication_fields';end if;
   expected:=expected||jsonb_build_object('owner_id',null,'metadata',prepared||p_publication_metadata);
 end if;
 if (to_jsonb(d)-array['updated_at','search_tsv','title_search_tsv']) is distinct from (expected-array['updated_at','search_tsv','title_search_tsv'])
   then raise exception 'admin_reference_completed_baseline_mismatch';end if;
 return jsonb_build_object('baseline',baseline,'preparedMetadata',prepared,'provenanceOwnerId',owner,'currentOwnerId',d.owner_id,'authorityDigest',c.authority_digest,'sealDigest',seal.snapshot_digest,'policyVersion',policy.policy_version);
end $$;

-- selected function ingestion_generation_evidence.assert_admin_reference_sections
create or replace function ingestion_generation_evidence.assert_admin_reference_sections(c ingestion_generation_evidence.candidates,p_packet jsonb,p_committed boolean,p_current_owner uuid)
returns void language plpgsql set search_path='' as $$
declare s jsonb; body jsonb; unit_declaration jsonb; art ingestion_generation_evidence.retained_artifacts;
 cr ingestion_generation_evidence.candidate_chunk_rows; original ingestion_generation_evidence.retained_artifacts;
 ids jsonb; deps jsonb; sources jsonb; units jsonb; unit jsonb; refs uuid[]:='{}'; total integer; ordinal integer:=0; start_byte integer; end_byte integer;
begin
 if jsonb_typeof(p_packet->'sections') is distinct from 'array' then raise exception 'managed_admin_text_section_population_mismatch';end if;
 total:=jsonb_array_length(p_packet->'sections');
 if total>2000 or (select count(distinct value->>'id') from jsonb_array_elements(p_packet->'sections'))<>total
   or (select count(*) from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family='sections')<>total
   or (select count(*) from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='sections')<>total
   then raise exception 'managed_admin_text_section_population_mismatch';end if;
 select jsonb_agg(jsonb_build_object('family','sections','key',value->>'id') order by ord) into ids from jsonb_array_elements(p_packet->'sections') with ordinality x(value,ord);
 if not exists(select 1 from ingestion_generation_evidence.producer_declarations where document_id=c.document_id and generation_id=c.generation_id and family='sections' and group_key='deep_memory'
   and declaration->'artifactGenerationId'='null'::jsonb and declaration->'population'->>'tag'='known'
   and declaration->'population'->'expectedUnits'=coalesce(ids,'[]'::jsonb)) then raise exception 'managed_admin_text_section_population_mismatch';end if;
 select * into strict original from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source';
 for s in select value from jsonb_array_elements(p_packet->'sections') loop
   body:=s->'body'; deps:='[]';sources:='[]';units:='[]';
   if not ingestion_generation_evidence.keys(s,array['id','body','dependencies','sourceEvidenceIds'])
     or not ingestion_generation_evidence.keys(body,array['document_id','owner_id','section_index','heading','heading_path','page_start','page_end','chunk_ids','summary','tags','extraction_quality','metadata'])
     or body->>'document_id' is distinct from c.document_id::text or body->'owner_id' is distinct from c.source_snapshot->'owner_id'
     or body->'section_index' is distinct from to_jsonb(ordinal) or body->'page_start' is distinct from '1'::jsonb or body->'page_end' is distinct from '1'::jsonb
     or coalesce(body->>'heading','')='' or body->'heading_path' is distinct from jsonb_build_array(body->>'heading')
     or jsonb_typeof(body->'chunk_ids') is distinct from 'array' or jsonb_array_length(body->'chunk_ids')<1
     or jsonb_typeof(body->'summary') is distinct from 'string' or jsonb_typeof(body->'tags') is distinct from 'array'
     or body->>'extraction_quality' not in ('good','partial','poor')
     then raise exception 'managed_admin_text_section_body_mismatch';end if;
   for unit in select value from jsonb_array_elements(body->'chunk_ids') loop
     if (unit#>>'{}')::uuid=any(refs) then raise exception 'managed_admin_text_section_dependency_mismatch';end if;
     select * into cr from ingestion_generation_evidence.candidate_chunk_rows where id=(unit#>>'{}')::uuid and document_id=c.document_id and index_generation_id=c.generation_id;
     if not found or cr.section_heading is distinct from body->>'heading' or cr.section_path is distinct from array[cr.section_heading]
       or cr.metadata->>'extractor' is distinct from 'literal-admin-utf8-source-unit-v1' then raise exception 'managed_admin_text_section_dependency_mismatch';end if;
     refs:=array_append(refs,cr.id); start_byte:=(cr.metadata->>'heading_byte_start')::integer;end_byte:=(cr.metadata->>'heading_byte_end')::integer;
     if start_byte is null or end_byte is null or start_byte is distinct from (cr.metadata->>'source_byte_start')::integer or end_byte<=start_byte or end_byte>(cr.metadata->>'source_byte_end')::integer
       or convert_to(cr.section_heading,'UTF8') is distinct from substring(original.artifact_bytes from start_byte+1 for end_byte-start_byte)
       or not exists(select 1 from jsonb_array_elements(c.source_expectation->'units') x where x.value->>'id'=cr.metadata->>'source_unit_id'
         and x.value->>'locator'='utf8-bytes:'||(cr.metadata->>'source_byte_start')||':'||(cr.metadata->>'source_byte_end'))
       then raise exception 'managed_admin_text_section_heading_mismatch';end if;
     deps:=deps||jsonb_build_array(jsonb_build_object('family','chunks','key',cr.id::text||':final'));
     sources:=sources||jsonb_build_array(cr.metadata->>'source_unit_id');
     units:=units||jsonb_build_array(jsonb_build_object('id',cr.metadata->'source_unit_id','start',cr.metadata->'source_byte_start','end',cr.metadata->'source_byte_end','headingStart',start_byte,'headingEnd',end_byte));
   end loop;
   if s->'dependencies' is distinct from deps or s->'sourceEvidenceIds' is distinct from sources
     or body->'metadata' is distinct from jsonb_build_object('rag_indexing_version','rag-deep-memory-v1','index_generation_id',c.generation_id,'generated_by','local-worker',
       'artifact_generation_id',c.generation_id,'source_path',c.source_snapshot->'source_path','source_sha256',c.source_sha256,'source_expectation_digest',c.source_expectation_digest,'source_units',units)
     then raise exception 'managed_admin_text_section_dependency_mismatch';end if;
   select d.declaration into unit_declaration from ingestion_generation_evidence.unit_declarations d where d.document_id=c.document_id and d.generation_id=c.generation_id and d.family='sections' and d.unit_key=s->>'id';
   if unit_declaration is distinct from jsonb_build_object('id',jsonb_build_object('family','sections','key',s->>'id'),'groupKey','deep_memory','required',true,
     'dependencies',deps,'sourceEvidenceIds','[]'::jsonb,'qualification','derived_unverified','representation','provenance_json') then raise exception 'managed_admin_text_section_declaration_mismatch';end if;
   select * into art from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='sections' and unit_key=s->>'id';
   if not found or art.group_key<>'deep_memory' or art.representation<>'provenance_json' or art.source_sha256<>c.source_sha256
     or art.byte_length<>octet_length(art.artifact_bytes) or art.sha256<>'sha256:'||encode(extensions.digest(art.artifact_bytes,'sha256'),'hex')
     or convert_from(art.artifact_bytes,'UTF8')::jsonb is distinct from body
     or not exists(select 1 from ingestion_generation_evidence.outcomes where document_id=c.document_id and generation_id=c.generation_id and family='sections' and unit_key=s->>'id' and outcome->>'disposition'='retained' and outcome->>'artifactSha256'=art.sha256)
     then raise exception 'managed_admin_text_section_retained_mismatch';end if;
   if p_committed and not exists(select 1 from public.document_sections sr where sr.id=(s->>'id')::uuid and sr.document_id=c.document_id
     and (to_jsonb(sr)-array['created_at','updated_at'])=body||jsonb_build_object('owner_id',p_current_owner,'id',s->'id','producer','local-worker','artifact_generation_id',c.generation_id,'index_generation_id',c.generation_id))
     then raise exception 'managed_admin_text_section_committed_mismatch';end if;
   ordinal:=ordinal+1;
 end loop;
 if exists(select 1 from ingestion_generation_evidence.candidate_chunk_rows where document_id=c.document_id and index_generation_id=c.generation_id and section_heading is not null and not(id=any(refs)))
   or (p_committed and (select count(*) from public.document_sections where document_id=c.document_id and index_generation_id=c.generation_id)<>total)
   or (not p_committed and exists(select 1 from public.document_sections where document_id=c.document_id and index_generation_id=c.generation_id))
   then raise exception 'managed_admin_text_section_population_mismatch';end if;
end $$;

-- selected function ingestion_generation_evidence.assert_admin_text_quality_state
create function ingestion_generation_evidence.assert_admin_text_quality_state(c ingestion_generation_evidence.candidates,p_packet jsonb,p_digest text)
returns void language plpgsql set search_path='' as $$
declare expected jsonb; q public.document_index_quality; d public.documents;
begin
 expected:=ingestion_generation_evidence.admin_text_quality(c,jsonb_array_length(p_packet->'sections'));
 if p_packet->'quality' is distinct from expected then raise exception 'managed_admin_text_quality_mismatch';end if;
 expected:=expected||jsonb_build_object('metrics',expected->'metrics'||jsonb_build_object('source_byte_length',c.source_byte_length,'text_byte_equality',true,'chunk_byte_coverage',true,
   'chunk_count',jsonb_array_length(p_packet->'chunks'),'admin_text_seal_digest',p_digest));
 select * into q from public.document_index_quality where document_id=c.document_id;
 select * into strict d from public.documents where id=c.document_id;
 if q.document_id is null or q.owner_id is distinct from d.owner_id or q.quality_score is distinct from (expected->>'quality_score')::real
   or q.extraction_quality is distinct from expected->>'extraction_quality' or to_jsonb(q.issues) is distinct from expected->'issues' or q.metrics is distinct from expected->'metrics'
   or d.metadata->'extraction_quality' is distinct from expected->'extraction_quality' or d.metadata->'index_quality_score' is distinct from expected->'quality_score'
   or d.metadata->'index_quality_issues' is distinct from expected->'issues' or d.metadata->'index_quality_metrics' is distinct from expected->'metrics'
   or d.metadata->'section_count' is distinct from expected->'metrics'->'section_count' or d.metadata->'memory_card_count' is distinct from '0'::jsonb
   then raise exception 'managed_admin_text_quality_state_mismatch';end if;
end $$;

-- selected function ingestion_generation_evidence.slots
create function ingestion_generation_evidence.slots() returns jsonb
language sql immutable set search_path='' as $$ select
'[["pages","worker_core"],["native_structure","worker_native"],["chunks","worker_core"],["images","worker_core"],["table_facts","worker_core"],["embedding_fields","worker_core"],["index_units","worker_core"],["index_units","deep_memory"],["sections","deep_memory"],["memory_cards","deep_memory"],["summary","enrichment"],["generated_labels","enrichment"],["quality","worker_core"],["document_metadata","projection_aggregate"],["producer_aliases","deep_memory"],["private_objects","private_objects"],["attempt_control","control"],["cache_inputs","cache"],["repair_audit_inputs","repair"]]'::jsonb $$;

-- selected function ingestion_generation_evidence.inventory
create function ingestion_generation_evidence.inventory(c ingestion_generation_evidence.candidates) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object('version',1,'documentId',c.document_id,'generationId',c.generation_id,'jobId',c.job_id,
 'firstLeaseToken',c.first_lease_token,'authorityDigest',c.authority_digest,'predecessorGenerationId',c.predecessor_generation_id,
 'sourceSha256',c.source_sha256,'sourceByteLength',c.source_byte_length,'sourceExpectation',c.source_expectation,
 'sourceExpectationDigest',c.source_expectation_digest,'expectedInventoryDigest',c.expected_inventory_digest,'registration',c.registration,
 'groups',(select jsonb_agg(jsonb_build_object('family',slot->>0,'groupKey',slot->>1,'state',case when d.family is null then 'pending' else 'declared' end,'declaration',d.declaration) order by ord)
   from jsonb_array_elements(ingestion_generation_evidence.slots()) with ordinality s(slot,ord)
   left join ingestion_generation_evidence.producer_declarations d on d.document_id=c.document_id and d.generation_id=c.generation_id and d.family=slot->>0 and d.group_key=slot->>1),
 'units',coalesce((select jsonb_agg(declaration order by family,unit_key) from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id),'[]'::jsonb),
 'outcomes',coalesce((select jsonb_agg(outcome order by family,unit_key) from ingestion_generation_evidence.outcomes where document_id=c.document_id and generation_id=c.generation_id),'[]'::jsonb),
 'artifacts',coalesce((select jsonb_agg(jsonb_build_object('unitId',jsonb_build_object('family',family,'key',unit_key),'groupKey',group_key,'representation',representation,'sourceSha256',source_sha256,'sha256',sha256,'byteLength',byte_length,'locator',locator) order by family,unit_key) from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id),'[]'::jsonb))
$$;

-- selected function ingestion_generation_evidence.admin_reference_core
create or replace function ingestion_generation_evidence.admin_reference_core(p_document_id uuid,p_generation uuid,p_chunk_ids uuid[],p_phase text,p_publication_metadata jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 a jsonb; context jsonb; p_owner_id uuid; c ingestion_generation_evidence.candidates; j public.ingestion_jobs;
 ad public.document_admission_events; seal ingestion_generation_evidence.prerequisite_accounting;
 original ingestion_generation_evidence.retained_artifacts; witness ingestion_generation_evidence.retained_artifacts;
 prepared ingestion_generation_evidence.retained_artifacts; final ingestion_generation_evidence.retained_artifacts;
 cr ingestion_generation_evidence.candidate_chunk_rows; pr public.document_chunks;
 packet jsonb; identity jsonb; actual jsonb; body jsonb; prepared_body jsonb; commitment jsonb; inventory jsonb; result jsonb;
 rows jsonb:='[]'::jsonb; population_digest text; total integer; cursor_byte integer:=0; ordinal integer:=0;
begin
 if p_document_id is null or p_generation is null or p_chunk_ids is null
   or cardinality(p_chunk_ids) not between 1 and 6
   or array_ndims(p_chunk_ids) is distinct from 1
   or exists(select 1 from unnest(p_chunk_ids) id where id is null)
   or (select count(distinct id) from unnest(p_chunk_ids) id)<>cardinality(p_chunk_ids)
   then raise exception 'completed_admin_text_invalid_request';end if;
 -- Preserve governance -> document -> both sorted job sets -> candidate lock order.
 context:=ingestion_generation_evidence.admin_reference_context(p_document_id,p_generation,p_phase,p_publication_metadata);
 p_owner_id:=(context->>'provenanceOwnerId')::uuid;
 -- This is an immutable-derived completed baseline, never a normalized public authority digest.
 a:=jsonb_build_object('document',context->'baseline','authority_digest',context->>'authorityDigest');
 if a is null or a->'document'->>'owner_id' is distinct from p_owner_id::text
   or (a->'document'->>'index_generation_id')::uuid is distinct from p_generation
   or a->'document'->>'status' is distinct from 'indexed'
   then raise exception 'completed_admin_text_owner_generation_mismatch';end if;
 perform 1 from public.ingestion_jobs where document_id=p_document_id order by id for update;
 perform 1 from public.indexing_v3_agent_jobs where document_id=p_document_id order by id for update;
 select * into c from ingestion_generation_evidence.candidates
   where document_id=p_document_id and generation_id=p_generation for update;
 if not found then raise exception 'completed_admin_text_candidate_missing';end if;
 select * into j from public.ingestion_jobs where id=c.job_id;
 if not found or j.document_id is distinct from c.document_id or j.status is distinct from 'completed'
   or j.stage is distinct from 'admin_text_completed' or j.completed_at is null
   or j.locked_by is not null or j.locked_at is not null or j.lease_expires_at is not null or j.next_run_at is not null
   or j.lease_token is distinct from c.first_lease_token or j.lease_write_generation_id is distinct from c.generation_id
   or j.lease_expected_generation_id is distinct from c.generation_id or j.lease_authority_digest is distinct from c.authority_digest
   or c.authority_digest is distinct from a->>'authority_digest'
   or c.source_snapshot->>'owner_id' is distinct from p_owner_id::text
   or c.source_sha256 is distinct from 'sha256:'||(a->'document'->>'content_hash')
   or c.source_byte_length is distinct from (a->'document'->>'file_size')::bigint
   or c.source_byte_length not between 1 and 2097152
   or a->'document'->>'file_type' is distinct from 'text/plain'
   or a->'document'->'metadata'->>'corpus_scope' is distinct from 'uploaded_local'
   or a->'document'->'metadata'->>'content_mode' is distinct from 'indexed_content'
   or a->'document'->'metadata'->>'confidentiality_scope' is distinct from 'guidelines-only'
   or exists(select 1 from public.ingestion_jobs other where other.document_id=c.document_id and other.id<>j.id
     and (other.created_at>j.created_at or other.status in ('pending','processing')))
   or exists(select 1 from public.indexing_v3_agent_jobs other where other.document_id=c.document_id
     and other.status in ('pending','processing'))
   then raise exception 'completed_admin_text_identity_mismatch';end if;
 select * into ad from public.document_admission_events where id=(a->'document'->'metadata'->>'admission_event_id')::uuid;
 if not found or ad.actor_kind is distinct from 'administrator' or ad.source_channel is distinct from 'admin_api'
   or ad.document_id is distinct from c.document_id or ad.staging_owner_id is distinct from p_owner_id
   or ad.content_sha256 is distinct from c.source_sha256 or ad.byte_count is distinct from c.source_byte_length
   or ad.mime_type is distinct from 'text/plain' or ad.admission_policy_version is distinct from 'trusted-document-admission-v1'
   or a->'document'->'metadata'->>'admission_policy_version' is distinct from ad.admission_policy_version
   or ad.file_name_sha256 is distinct from 'sha256:'||encode(extensions.digest(convert_to(a->'document'->>'file_name','UTF8'),'sha256'),'hex')
   or ad.storage_path_sha256 is distinct from 'sha256:'||encode(extensions.digest(convert_to(a->'document'->>'storage_path','UTF8'),'sha256'),'hex')
   or ad.authority is distinct from a->'document'->'metadata'->'authority'
   or c.source_snapshot->'metadata'->'admission_event_id' is distinct from a->'document'->'metadata'->'admission_event_id'
   or ad.authority->>'authorityBasis' is distinct from 'administrator_template'
   or ad.authority->>'licencePolicy' is distinct from 'public_index_permitted'
   or ad.authority->>'providerProcessing' is distinct from 'permitted'
   or ad.authority->>'purpose' is distinct from 'clinical_retrieval'
   or ad.authority->>'currentness' is distinct from 'current' or ad.authority->'supportedFeatures' is distinct from '["text"]'::jsonb
   or (ad.authority->>'effectiveDate')::date>current_date or (ad.authority->>'expiryDate')::date<=current_date
   or (ad.authority->>'reviewDate')::date<=current_date
   then raise exception 'completed_admin_text_admission_mismatch';end if;
 select * into seal from ingestion_generation_evidence.prerequisite_accounting
   where document_id=c.document_id and generation_id=c.generation_id and snapshot->>'version'='managed-admin-text-seal-v1';
 if not found or seal.snapshot_digest is distinct from 'sha256:'||encode(extensions.digest(convert_to(seal.snapshot::text,'UTF8'),'sha256'),'hex')
   or seal.snapshot->>'scope' is distinct from 'whole_retained_utf8_txt' or seal.snapshot->'activated' is distinct from 'true'::jsonb
   or seal.snapshot->>'nativeFidelity' is distinct from 'whole_original_extracted_persisted_utf8_bytes_equal'
   or seal.snapshot->>'sourceCompleteness' is distinct from 'whole_original_byte_domain_covered'
   or seal.snapshot->>'clinicalApproval' is distinct from 'not_assessed' or seal.snapshot->>'publicationApproval' is distinct from 'not_granted'
   then raise exception 'completed_admin_text_seal_mismatch';end if;
 packet:=seal.snapshot->'packet';
 identity:=jsonb_build_object('documentId',c.document_id,'generationId',c.generation_id,'jobId',c.job_id,
   'workerId',packet->'identity'->>'workerId','firstLeaseToken',c.first_lease_token,'attemptNumber',j.attempt_count,
   'batchId',j.batch_id,'authorityDigest',c.authority_digest,'predecessorGenerationId',c.predecessor_generation_id,
   'ownerId',p_owner_id,'sourceSha256',c.source_sha256,'sourceByteLength',c.source_byte_length,'sourceExpectationDigest',c.source_expectation_digest);
 if not ((packet->>'version'='managed-admin-text-complete-v1' and ingestion_generation_evidence.keys(packet,array['version','identity','chunks','quality']))
     or (packet->>'version'='managed-admin-text-complete-v2' and ingestion_generation_evidence.keys(packet,array['version','identity','chunks','sections','quality']) and seal.snapshot->>'sectionsVersion'='managed-admin-text-sections-v2')) or packet->'identity' is distinct from identity
   or coalesce(btrim(packet->'identity'->>'workerId'),'')='' or jsonb_typeof(packet->'chunks') is distinct from 'array'
   then raise exception 'completed_admin_text_seal_mismatch';end if;
 total:=jsonb_array_length(packet->'chunks');
 if total not between 1 and 2000 or (select count(distinct value->>'id') from jsonb_array_elements(packet->'chunks'))<>total
   or c.registration->'version' is distinct from '1'::jsonb
   or c.registration->>'profileVersion' is distinct from c.profile_version
   or c.registration->>'sourceSha256' is distinct from c.source_sha256
   or c.registration->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
   or c.registration->'sourceExpectation' is distinct from c.source_expectation
   or c.registration->>'sourceExpectationHex' is distinct from encode(c.source_expectation_bytes,'hex')
   or c.registration->>'sourceExpectationSha256' is distinct from c.source_expectation_digest
   or c.source_expectation->>'tag' is distinct from 'known'
   or c.source_expectation->>'sourceSha256' is distinct from c.source_sha256
   or convert_from(c.source_expectation_bytes,'UTF8')::jsonb is distinct from c.source_expectation
   or c.source_expectation_digest is distinct from 'sha256:'||encode(extensions.digest(c.source_expectation_bytes,'sha256'),'hex')
   then raise exception 'completed_admin_text_registration_mismatch';end if;
 select * into original from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id
   and family='private_objects' and unit_key='original-source';
 if not found or original.group_key is distinct from 'private_objects' or original.representation is distinct from 'original_binary'
   or original.sha256 is distinct from c.source_sha256 or original.source_sha256 is distinct from c.source_sha256
   or original.byte_length is distinct from c.source_byte_length
   or convert_to(convert_from(original.artifact_bytes,'UTF8'),'UTF8') is distinct from original.artifact_bytes
   then raise exception 'completed_admin_text_original_mismatch';end if;
 if (select count(*) from public.document_pages where document_id=c.document_id and index_generation_id=c.generation_id)<>1
   or exists(select 1 from public.document_images where document_id=c.document_id and index_generation_id=c.generation_id)
   or not exists(select 1 from public.document_pages page_row join ingestion_generation_evidence.retained_artifacts page_artifact
       on page_artifact.document_id=page_row.document_id and page_artifact.generation_id=page_row.index_generation_id and page_artifact.family='pages' and page_artifact.unit_key='1'
     where page_row.document_id=c.document_id and page_row.index_generation_id=c.generation_id and page_row.page_number=1 and not page_row.ocr_used
       and convert_to(page_row.text,'UTF8')=original.artifact_bytes and page_artifact.representation='page_projection'
       and (convert_from(page_artifact.artifact_bytes,'UTF8')::jsonb)->'metadata'=page_row.metadata
       and (convert_from(page_artifact.artifact_bytes,'UTF8')::jsonb)->>'text'=page_row.text)
   then raise exception 'admin_reference_page_mismatch';end if;
 select * into witness from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id
   and family='private_objects' and unit_key='original-source-expectation-witness';
 if not found or witness.group_key is distinct from 'private_objects' or witness.representation is distinct from 'source_expectation_witness'
   or witness.source_sha256 is distinct from c.source_sha256 or witness.sha256 is distinct from c.source_expectation->'witness'->>'sha256'
   or seal.snapshot->>'sourceWitnessSha256' is distinct from witness.sha256
   or not exists(select 1 from jsonb_array_elements(c.registration->'declarations'->'units') u where
     u.value->'id'='{"family":"private_objects","key":"original-source-expectation-witness"}'::jsonb
     and u.value->>'groupKey'='private_objects' and u.value->>'representation'='source_expectation_witness')
   then raise exception 'completed_admin_text_witness_mismatch';end if;
 if exists(select 1 from ingestion_generation_evidence.retained_artifacts art where art.document_id=c.document_id and art.generation_id=c.generation_id
   and (art.source_sha256 is distinct from c.source_sha256 or art.byte_length is distinct from octet_length(art.artifact_bytes)::bigint
     or art.sha256 is distinct from 'sha256:'||encode(extensions.digest(art.artifact_bytes,'sha256'),'hex')))
   or exists(select 1 from ingestion_generation_evidence.unit_declarations declaration
     left join ingestion_generation_evidence.outcomes outcome using(document_id,generation_id,family,unit_key)
     left join ingestion_generation_evidence.retained_artifacts art using(document_id,generation_id,family,unit_key)
     where declaration.document_id=c.document_id and declaration.generation_id=c.generation_id and declaration.declaration->'required'='true'::jsonb
       and (outcome.outcome->>'disposition' is distinct from 'retained' or outcome.outcome->>'artifactSha256' is distinct from art.sha256 or art.sha256 is null))
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts art join ingestion_generation_evidence.outcomes o using(document_id,generation_id,family,unit_key)
     where art.document_id=c.document_id and art.generation_id=c.generation_id and art.family='attempt_control' and art.unit_key='preseal_checkpoint'
       and o.outcome->>'disposition'='retained' and o.outcome->>'artifactSha256'=art.sha256
       and (convert_from(art.artifact_bytes,'UTF8')::jsonb)->'terminalPacket'=packet)
   then raise exception 'completed_admin_text_artifact_mismatch';end if;
 if packet->>'version' is distinct from 'managed-admin-text-complete-v2' then raise exception 'admin_reference_v2_completion_required';end if;
 if packet->>'version'='managed-admin-text-complete-v2' then
   -- Retain row stability until transaction end, including old-generation sections.
   perform 1 from public.document_sections where document_id=c.document_id order by id for share;
   perform 1 from public.document_index_quality where document_id=c.document_id order by document_id for share;
   perform ingestion_generation_evidence.assert_admin_reference_sections(c,packet,true,(context->>'currentOwnerId')::uuid);
   perform ingestion_generation_evidence.assert_admin_text_quality_state(c,packet,seal.snapshot_digest);
 end if;
 -- Freeze the full committed population before checking or exposing selected rows.
 perform 1 from public.document_chunks where document_id=c.document_id and index_generation_id=c.generation_id order by id for share;
 if (select count(*) from public.document_chunks where document_id=c.document_id and index_generation_id=c.generation_id)<>total
   or (select count(*) from ingestion_generation_evidence.candidate_chunk_rows where document_id=c.document_id and index_generation_id=c.generation_id)<>total
   or (select count(*) from public.document_chunks where document_id=c.document_id and index_generation_id=c.generation_id and id=any(p_chunk_ids))<>cardinality(p_chunk_ids)
   or exists(select 1 from ingestion_generation_evidence.candidate_chunk_rows candidate left join public.document_chunks committed on committed.id=candidate.id
     where candidate.document_id=c.document_id and candidate.index_generation_id=c.generation_id
       and (committed.id is null or (to_jsonb(committed)-array['created_at','search_tsv']) is distinct from
         (to_jsonb(jsonb_populate_record(null::public.document_chunks,to_jsonb(candidate)))-array['created_at','search_tsv'])))
   then raise exception 'completed_admin_text_committed_population_mismatch';end if;
 select 'sha256:'||encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_object('key',unit_key,'sha256',sha256,'byteLength',byte_length) order by unit_key)::text,'UTF8'),'sha256'),'hex')
   into population_digest from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks';
 if seal.snapshot->>'chunkPopulationDigest' is distinct from population_digest then raise exception 'completed_admin_text_seal_mismatch';end if;
 -- Validate all final/prepared/source commitments, not just selected rows.
 for commitment in select value from jsonb_array_elements(packet->'chunks') loop
   select * into cr from ingestion_generation_evidence.candidate_chunk_rows where id=(commitment->>'id')::uuid and document_id=c.document_id and index_generation_id=c.generation_id;
   if not found then raise exception 'completed_admin_text_row_mismatch';end if;
   select * into pr from public.document_chunks where id=cr.id and document_id=c.document_id and index_generation_id=c.generation_id;
   select * into prepared from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=cr.id::text||':prepared';
   if not found then raise exception 'completed_admin_text_row_mismatch';end if;
   select * into final from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=cr.id::text||':final';
   if not found then raise exception 'completed_admin_text_row_mismatch';end if;
   actual:=(to_jsonb(pr)-array['created_at','search_tsv','embedding'])||jsonb_build_object('embedding',(pr.embedding::text)::jsonb);
   body:=convert_from(final.artifact_bytes,'UTF8')::jsonb;
   prepared_body:=convert_from(prepared.artifact_bytes,'UTF8')::jsonb;
   if not ingestion_generation_evidence.keys(commitment,array['id','chunkIndex','start','end','sha256'])
     or commitment->'chunkIndex' is distinct from to_jsonb(ordinal) or commitment->'start' is distinct from to_jsonb(cursor_byte)
     or (commitment->>'end')::integer<=cursor_byte or (commitment->>'end')::integer>c.source_byte_length
     or cr.chunk_index is distinct from ordinal or cr.page_number is distinct from 1
     or cr.candidate_owner_id is distinct from p_owner_id or cr.candidate_job_id is distinct from c.job_id
     or cr.candidate_lease_token is distinct from c.first_lease_token or cr.candidate_authority_digest is distinct from c.authority_digest
     or cr.candidate_source_sha256 is distinct from c.source_sha256 or cr.candidate_source_expectation_digest is distinct from c.source_expectation_digest
     or cr.candidate_prepared_sha256 is distinct from prepared.sha256
     or prepared.group_key is distinct from 'worker_core' or prepared.representation is distinct from 'provenance_json'
     or final.group_key is distinct from 'worker_core' or final.representation is distinct from 'provenance_json'
     or body->>'version' is distinct from 'ingestion-persisted-chunk-v1' or body->>'qualification' is distinct from 'derived_unverified'
     or body->>'documentId' is distinct from c.document_id::text or body->>'generationId' is distinct from c.generation_id::text
     or body->>'sourceSha256' is distinct from c.source_sha256 or body->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
     or body->>'chunkId' is distinct from cr.id::text or body->'chunkIndex' is distinct from to_jsonb(cr.chunk_index)
     or prepared_body->>'version' is distinct from 'ingestion-prepared-chunk-v1' or prepared_body->>'qualification' is distinct from 'derived_unverified'
     or prepared_body->>'documentId' is distinct from c.document_id::text or prepared_body->>'generationId' is distinct from c.generation_id::text
     or prepared_body->>'sourceSha256' is distinct from c.source_sha256 or prepared_body->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
     or prepared_body->>'chunkId' is distinct from cr.id::text or prepared_body->'chunkIndex' is distinct from to_jsonb(cr.chunk_index)
     or body->'row' is distinct from actual or body->>'preparedSha256' is distinct from prepared.sha256
     or prepared_body->'row' is distinct from
       (actual-'embedding')||jsonb_build_object('metadata',(actual->'metadata')-array['ingestion_job_id','ingestion_job_kind','ingestion_lease_token'])
     or convert_to(pr.content,'UTF8') is distinct from substring(original.artifact_bytes from cursor_byte+1 for (commitment->>'end')::integer-cursor_byte)
     or commitment->>'sha256' is distinct from 'sha256:'||encode(extensions.digest(convert_to(pr.content,'UTF8'),'sha256'),'hex')
     then raise exception 'completed_admin_text_row_mismatch';end if;
   if pr.id=any(p_chunk_ids) then rows:=rows||jsonb_build_array(actual-'embedding');end if;
   cursor_byte:=(commitment->>'end')::integer;ordinal:=ordinal+1;
 end loop;
 if cursor_byte<>c.source_byte_length or jsonb_array_length(rows)<>cardinality(p_chunk_ids)
   then raise exception 'completed_admin_text_row_mismatch';end if;
 -- Match all reviewed-visible populations to the already verified immutable TXT seal.
 -- Typed-current images remain forbidden above; metadata-visible old/null typed rows also cannot enter review.
 if exists(select 1 from public.document_images i join public.documents d on d.id=i.document_id
   where d.id=c.document_id and (nullif(coalesce(d.metadata,'{}'::jsonb)->>'index_generation_id','') is null
     or public.is_committed_artifact_generation(i.metadata,d.metadata)))
   then raise exception 'admin_reference_visible_images_mismatch';end if;
 if coalesce((select array_agg(s.id order by s.id) from public.document_sections s join public.documents d on d.id=s.document_id
     where d.id=c.document_id and public.is_committed_artifact_generation(s.metadata,d.metadata)),'{}'::uuid[])
   is distinct from coalesce((select array_agg((value->>'id')::uuid order by (value->>'id')::uuid)
     from jsonb_array_elements(packet->'sections')),'{}'::uuid[])
   then raise exception 'admin_reference_visible_sections_mismatch';end if;
 if coalesce((select array_agg(ch.id order by ch.id) from public.document_chunks ch join public.documents d on d.id=ch.document_id
     where d.id=c.document_id and (public.is_committed_document_generation(ch.index_generation_id,d.index_generation_id)
       or nullif(coalesce(d.metadata,'{}'::jsonb)->>'index_generation_id','') is null
       or public.is_committed_artifact_generation(ch.metadata,d.metadata))),'{}'::uuid[])
   is distinct from coalesce((select array_agg((value->>'id')::uuid order by (value->>'id')::uuid)
     from jsonb_array_elements(packet->'chunks')),'{}'::uuid[])
   then raise exception 'admin_reference_visible_chunks_mismatch';end if;
 inventory:=ingestion_generation_evidence.inventory(c)||jsonb_build_object('retainedOriginalWitness',jsonb_build_object(
   'status','retained','documentId',c.document_id,'generationId',c.generation_id,'sourceSha256',c.source_sha256,
   'sourceByteLength',c.source_byte_length,'sourceExpectationDigest',c.source_expectation_digest,
   'unitId',jsonb_build_object('family','private_objects','key','original-source-expectation-witness'),
   'representation','source_expectation_witness','bytesHex',encode(witness.artifact_bytes,'hex'),'sha256',witness.sha256,'byteLength',witness.byte_length));
 result:=jsonb_build_object('context',context,'version',1,'documentId',c.document_id,'generationId',c.generation_id,'ownerId',p_owner_id,
   'original',jsonb_build_object('bytesHex',encode(original.artifact_bytes,'hex'),'sha256',original.sha256,'byteLength',original.byte_length),
   'inventory',inventory,'rows',rows);
 if octet_length(convert_to(result::text,'UTF8'))>8388608 then raise exception 'completed_admin_text_response_limit';end if;
 return result;
end $$;

-- selected function ingestion_generation_evidence.admin_reference_evidence
create function ingestion_generation_evidence.admin_reference_evidence(p_receipt jsonb)
returns text[] language plpgsql set search_path='' as $$
declare bytes bytea:=convert_to(p_receipt::text,'UTF8'); encoded text; digest text; total integer; part integer; refs text[]:='{}';
begin
 if octet_length(bytes) not between 1 and 13500 then raise exception 'admin_reference_receipt_bound';end if;
 encoded:=replace(encode(bytes,'base64'),E'\n',''); digest:=encode(extensions.digest(bytes,'sha256'),'hex'); total:=(length(encoded)+399)/400;
 for part in 1..total loop
   refs:=array_append(refs,'admin-txt-prep-v1:'||digest||':'||lpad(part::text,2,'0')||'/'||lpad(total::text,2,'0')||':'||substring(encoded from (part-1)*400+1 for 400));
 end loop;
 return refs;
end $$;

-- selected function ingestion_generation_evidence.admin_reference_decode
create function ingestion_generation_evidence.admin_reference_decode(p_references text[])
returns jsonb language plpgsql set search_path='' as $$
declare ref text; parts text[]; digest text; total integer; ordinal integer:=0; encoded text:=''; bytes bytea; receipt jsonb; actual text[]:='{}';
begin
 if array_ndims(p_references) is distinct from 1 or cardinality(p_references) not between 1 and 50 then raise exception 'admin_reference_evidence_refused';end if;
 foreach ref in array p_references loop
   if ref is null or char_length(ref) not between 1 and 500 or ref is distinct from btrim(ref) then raise exception 'admin_reference_evidence_refused';end if;
   if ref like 'admin-txt-prep-v1:%' then
     parts:=regexp_match(ref,'^admin-txt-prep-v1:([0-9a-f]{64}):([0-9]{2})/([0-9]{2}):([A-Za-z0-9+/]+={0,2})$');
     if parts is null then raise exception 'admin_reference_evidence_refused';end if;
     if ordinal=0 then digest:=parts[1];total:=parts[3]::integer;end if;
     ordinal:=ordinal+1;
     if total not between 1 and 45 or parts[1] is distinct from digest or parts[2]::integer<>ordinal or parts[3]::integer<>total
       or length(parts[4])>400 or (ordinal<total and (length(parts[4])<>400 or parts[4] like '%=%')) then raise exception 'admin_reference_evidence_refused';end if;
     encoded:=encoded||parts[4];actual:=array_append(actual,ref);
   end if;
 end loop;
 if ordinal is distinct from total then raise exception 'admin_reference_evidence_refused';end if;
 bytes:=decode(encoded,'base64');
 if octet_length(bytes) not between 1 and 13500 or replace(encode(bytes,'base64'),E'\n','') is distinct from encoded
   or encode(extensions.digest(bytes,'sha256'),'hex') is distinct from digest then raise exception 'admin_reference_evidence_refused';end if;
 receipt:=convert_from(bytes,'UTF8')::jsonb;
 if convert_to(receipt::text,'UTF8') is distinct from bytes or ingestion_generation_evidence.admin_reference_evidence(receipt) is distinct from actual
   then raise exception 'admin_reference_evidence_refused';end if;
 return jsonb_build_object('receipt',receipt,'bytesHex',encode(bytes,'hex'),'sha256','sha256:'||digest);
exception when invalid_text_representation or character_not_in_repertoire then raise exception 'admin_reference_evidence_refused';
end $$;

-- selected function ingestion_generation_evidence.admin_reference_digest
create function ingestion_generation_evidence.admin_reference_digest(p_value jsonb)
returns text language sql immutable set search_path='' as $$
 select 'sha256:'||encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex');
$$;

-- selected function public.is_visible_document_page
create function public.is_visible_document_page(p_generation uuid,p_document_generation uuid,p_mode text) returns boolean
language sql immutable set search_path='' as $$ select coalesce((p_mode='legacy_unqualified' and p_generation is null) or (p_mode='typed_exact' and p_document_generation is not null and p_generation=p_document_generation),false) $$;

-- selected function ingestion_generation_evidence.admin_reference_reviewed_state
create function ingestion_generation_evidence.admin_reference_reviewed_state(
  p_document_id uuid,
  p_document jsonb
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'document', p_document - array['owner_id', 'created_at', 'updated_at', 'search_tsv', 'title_search_tsv'] - case when d.page_storage_mode='legacy_unqualified' then array['page_storage_mode'] else array[]::text[] end,
          'pages', coalesce((
            select jsonb_agg(to_jsonb(p) - array['created_at', 'updated_at'] - case when d.page_storage_mode='legacy_unqualified' then array['index_generation_id'] else array[]::text[] end order by p.page_number, p.id)
            from public.document_pages p where p.document_id = d.id and public.is_visible_document_page(p.index_generation_id,d.index_generation_id,d.page_storage_mode)
          ), '[]'::jsonb),
          'images', coalesce((
            select jsonb_agg(to_jsonb(i) - array['created_at', 'updated_at'] order by i.page_number nulls last, i.id)
            from public.document_images i
            where i.document_id = d.id
              and (
                nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '') is null
                or public.is_committed_artifact_generation(i.metadata, d.metadata)
              )
          ), '[]'::jsonb),
          'labels', coalesce((
            select jsonb_agg(to_jsonb(l) - array['owner_id', 'created_at', 'updated_at'] order by l.id)
            from public.document_labels l where l.document_id = d.id
          ), '[]'::jsonb),
          'summaries', coalesce((
            select jsonb_agg(to_jsonb(s) - array['owner_id', 'created_at', 'updated_at'] order by s.id)
            from public.document_summaries s where s.document_id = d.id
          ), '[]'::jsonb),
          'sections', coalesce((
            select jsonb_agg(to_jsonb(s) - array['owner_id', 'created_at', 'updated_at'] order by s.section_index, s.id)
            from public.document_sections s
            where s.document_id = d.id
              and public.is_committed_artifact_generation(s.metadata, d.metadata)
          ), '[]'::jsonb),
          'memory_cards', coalesce((
            select jsonb_agg(
              to_jsonb(m) - array['owner_id', 'embedding', 'search_tsv', 'created_at', 'updated_at']
              order by m.id
            )
            from public.document_memory_cards m
            where m.document_id = d.id
              and (
                nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '') is null
                or public.is_committed_artifact_generation(m.metadata, d.metadata)
              )
          ), '[]'::jsonb),
          'chunks', coalesce((
            select jsonb_agg(to_jsonb(c) - array['embedding', 'search_tsv', 'created_at'] order by c.chunk_index, c.id)
            from public.document_chunks c
            where c.document_id = d.id
              and (
                public.is_committed_document_generation(c.index_generation_id, d.index_generation_id)
                or nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '') is null
                or public.is_committed_artifact_generation(c.metadata, d.metadata)
              )
          ), '[]'::jsonb),
          'table_facts', coalesce((
            select jsonb_agg(to_jsonb(f) - array['owner_id', 'search_tsv', 'created_at'] order by f.id)
            from public.document_table_facts f
            where f.document_id = d.id
              and (
                nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '') is null
                or public.is_committed_artifact_generation(f.metadata, d.metadata)
              )
          ), '[]'::jsonb),
          'embedding_fields', coalesce((
            select jsonb_agg(
              to_jsonb(f) - array['owner_id', 'embedding', 'search_tsv', 'created_at']
              order by f.id
            )
            from public.document_embedding_fields f
            where f.document_id = d.id
              and public.is_committed_artifact_generation(f.metadata, d.metadata)
          ), '[]'::jsonb),
          'index_quality', coalesce((
            select to_jsonb(q) - array['owner_id', 'updated_at']
            from public.document_index_quality q where q.document_id = d.id
          ), '{}'::jsonb),
          'index_units', coalesce((
            select jsonb_agg(
              to_jsonb(u) - array['owner_id', 'embedding', 'search_tsv', 'created_at', 'updated_at']
              order by u.id
            )
            from public.document_index_units u
            where u.document_id = d.id
              and public.is_committed_artifact_generation(u.metadata, d.metadata)
          ), '[]'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.documents d
  where d.id = p_document_id
;
$$;

-- selected function ingestion_generation_evidence.admin_reference_receipt
create function ingestion_generation_evidence.admin_reference_receipt(p_context jsonb,p_comparison jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare c ingestion_generation_evidence.candidates; ad public.document_admission_events;
 seal ingestion_generation_evidence.prerequisite_accounting; witness ingestion_generation_evidence.retained_artifacts;
 baseline jsonb:=p_context->'baseline'; prepared jsonb; delta jsonb:='{}'; key text; expected_comparison jsonb; result jsonb;
begin
 select * into strict c from ingestion_generation_evidence.candidates where document_id=(baseline->>'id')::uuid and generation_id=(baseline->>'index_generation_id')::uuid;
 select * into strict ad from public.document_admission_events where id=(baseline->'metadata'->>'admission_event_id')::uuid;
 select * into strict seal from ingestion_generation_evidence.prerequisite_accounting where document_id=c.document_id and generation_id=c.generation_id and snapshot_digest=p_context->>'sealDigest';
 select * into strict witness from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source-expectation-witness';
 if not ingestion_generation_evidence.keys(p_comparison,array['scope','sourceSha256','expectationDigest','sourceByteLength','evidenceReference','changeState'])
   or jsonb_typeof(p_comparison->'evidenceReference') is distinct from 'string'
   or char_length(p_comparison->>'evidenceReference') not between 1 and 500
   or p_comparison->>'evidenceReference' is distinct from btrim(p_comparison->>'evidenceReference')
   then raise exception 'admin_reference_comparison_refused';end if;
 expected_comparison:=jsonb_build_object('scope','retained-current-vs-admitted-original','sourceSha256',ad.content_sha256,'expectationDigest',c.source_expectation_digest,
   'sourceByteLength',ad.byte_count,'evidenceReference',p_comparison->>'evidenceReference','changeState','unchanged');
 if p_comparison is distinct from expected_comparison or ad.content_sha256 is distinct from c.source_sha256 or ad.byte_count is distinct from c.source_byte_length
   then raise exception 'admin_reference_comparison_refused';end if;
 prepared:=baseline||jsonb_build_object('metadata',p_context->'preparedMetadata');
 foreach key in array array['corpus_scope','source_catalogue_key','source_policy_version','publisher_code','change_state'] loop
   delta:=delta||jsonb_build_object(key,jsonb_build_object('beforePresent',(baseline->'metadata')?key,
     'beforeValue',coalesce(baseline->'metadata'->key,'null'::jsonb),'afterValue',prepared->'metadata'->key));
 end loop;
 result:=jsonb_build_object('version','admin-text-reference-preparation-v1','documentId',c.document_id,'generationId',c.generation_id,'provenanceOwnerId',p_context->'provenanceOwnerId',
   'admission',jsonb_build_object('eventId',ad.id,'digest',ad.admission_digest),
   'candidate',jsonb_build_object('authorityDigest',c.authority_digest,'registrationDigest',ingestion_generation_evidence.admin_reference_digest(c.registration),'sourceSnapshotDigest',ingestion_generation_evidence.admin_reference_digest(c.source_snapshot)),
   'sealDigest',seal.snapshot_digest,'source',jsonb_build_object('sha256',c.source_sha256,'byteLength',c.source_byte_length,'expectationDigest',c.source_expectation_digest,'witnessDigest',witness.sha256),
   'populations',jsonb_build_object('chunksDigest',seal.snapshot->>'chunkPopulationDigest','sectionsDigest',ingestion_generation_evidence.admin_reference_digest(seal.snapshot->'packet'->'sections')),
   'completedDocumentDigest',ingestion_generation_evidence.admin_reference_digest(baseline-array['updated_at','search_tsv','title_search_tsv']),
   'preparedDocumentDigest',ingestion_generation_evidence.admin_reference_digest(prepared-array['updated_at','search_tsv','title_search_tsv']),
   'preparedReviewedStateDigest',ingestion_generation_evidence.admin_reference_reviewed_state(c.document_id,prepared),'delta',delta,'comparison',expected_comparison);
 if octet_length(convert_to(result::text,'UTF8'))>13500 then raise exception 'admin_reference_receipt_bound';end if;
 return result;
end $$;

-- selected function ingestion_generation_evidence.admin_text_commit_allowed
-- Only the validating terminal transaction can enter the existing sole pointer writer.
create function ingestion_generation_evidence.admin_text_commit_allowed(p_fence jsonb,p_generation uuid)
returns boolean language sql stable set search_path='' as $$
 select coalesce(current_setting('psychsift.admin_text_terminal_owner',true)=
   (p_fence->>'document_id')||':'||(p_fence->>'job_id'),false)
 and exists(select 1 from ingestion_generation_evidence.prerequisite_accounting s
   where s.document_id=(p_fence->>'document_id')::uuid and s.generation_id=p_generation
   and s.snapshot->>'version'='managed-admin-text-seal-v1'
   and s.snapshot->'packet'->'identity'->>'documentId'=p_fence->>'document_id'
   and s.snapshot->'packet'->'identity'->>'generationId'=p_generation::text
   and s.snapshot->'packet'->'identity'->>'jobId'=p_fence->>'job_id'
   and s.snapshot->'packet'->'identity'->>'firstLeaseToken'=p_fence->>'lease_token'
   and s.snapshot->'packet'->'identity'->>'authorityDigest'=p_fence->>'authority_digest'
   and s.snapshot_digest='sha256:'||encode(extensions.digest(convert_to(s.snapshot::text,'UTF8'),'sha256'),'hex')
   and exists(select 1 from ingestion_generation_evidence.candidates c join public.documents d on d.id=c.document_id
     where c.document_id=s.document_id and c.generation_id=s.generation_id and c.job_id=(p_fence->>'job_id')::uuid
     and c.first_lease_token=(p_fence->>'lease_token')::uuid and c.authority_digest=p_fence->>'authority_digest'
     and s.snapshot->'packet'->'identity'->>'sourceSha256'=c.source_sha256
     and s.snapshot->'packet'->'identity'->'sourceByteLength'=to_jsonb(c.source_byte_length)
     and s.snapshot->'packet'->'identity'->>'sourceExpectationDigest'=c.source_expectation_digest
     and s.snapshot->'packet'->'identity'->'ownerId'=to_jsonb(d.owner_id)
     and c.source_sha256='sha256:'||d.content_hash
     and (select count(*) from public.document_chunks cr where cr.document_id=c.document_id and cr.index_generation_id=c.generation_id)=jsonb_array_length(s.snapshot->'packet'->'chunks')
     and not exists(select 1 from ingestion_generation_evidence.candidate_chunk_rows cr left join public.document_chunks pr on pr.id=cr.id
       where cr.document_id=c.document_id and cr.index_generation_id=c.generation_id
       and (pr.id is null or (to_jsonb(pr)-array['created_at','search_tsv']) is distinct from
         (to_jsonb(jsonb_populate_record(null::public.document_chunks,to_jsonb(cr)))-array['created_at','search_tsv'])))))
$$;

-- selected function ingestion_generation_evidence.assert_admin_text_sections
create or replace function ingestion_generation_evidence.assert_admin_text_sections(c ingestion_generation_evidence.candidates,p_packet jsonb,p_committed boolean)
returns void language plpgsql set search_path='' as $$
declare s jsonb; body jsonb; unit_declaration jsonb; art ingestion_generation_evidence.retained_artifacts;
 cr ingestion_generation_evidence.candidate_chunk_rows; original ingestion_generation_evidence.retained_artifacts;
 ids jsonb; deps jsonb; sources jsonb; units jsonb; unit jsonb; refs uuid[]:='{}'; total integer; ordinal integer:=0; start_byte integer; end_byte integer;
begin
 if jsonb_typeof(p_packet->'sections') is distinct from 'array' then raise exception 'managed_admin_text_section_population_mismatch';end if;
 total:=jsonb_array_length(p_packet->'sections');
 if total>2000 or (select count(distinct value->>'id') from jsonb_array_elements(p_packet->'sections'))<>total
   or (select count(*) from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family='sections')<>total
   or (select count(*) from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='sections')<>total
   then raise exception 'managed_admin_text_section_population_mismatch';end if;
 select jsonb_agg(jsonb_build_object('family','sections','key',value->>'id') order by ord) into ids from jsonb_array_elements(p_packet->'sections') with ordinality x(value,ord);
 if not exists(select 1 from ingestion_generation_evidence.producer_declarations where document_id=c.document_id and generation_id=c.generation_id and family='sections' and group_key='deep_memory'
   and declaration->'artifactGenerationId'='null'::jsonb and declaration->'population'->>'tag'='known'
   and declaration->'population'->'expectedUnits'=coalesce(ids,'[]'::jsonb)) then raise exception 'managed_admin_text_section_population_mismatch';end if;
 select * into strict original from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source';
 for s in select value from jsonb_array_elements(p_packet->'sections') loop
   body:=s->'body'; deps:='[]';sources:='[]';units:='[]';
   if not ingestion_generation_evidence.keys(s,array['id','body','dependencies','sourceEvidenceIds'])
     or not ingestion_generation_evidence.keys(body,array['document_id','owner_id','section_index','heading','heading_path','page_start','page_end','chunk_ids','summary','tags','extraction_quality','metadata'])
     or body->>'document_id' is distinct from c.document_id::text or body->'owner_id' is distinct from c.source_snapshot->'owner_id'
     or body->'section_index' is distinct from to_jsonb(ordinal) or body->'page_start' is distinct from '1'::jsonb or body->'page_end' is distinct from '1'::jsonb
     or coalesce(body->>'heading','')='' or body->'heading_path' is distinct from jsonb_build_array(body->>'heading')
     or jsonb_typeof(body->'chunk_ids') is distinct from 'array' or jsonb_array_length(body->'chunk_ids')<1
     or jsonb_typeof(body->'summary') is distinct from 'string' or jsonb_typeof(body->'tags') is distinct from 'array'
     or body->>'extraction_quality' not in ('good','partial','poor')
     then raise exception 'managed_admin_text_section_body_mismatch';end if;
   for unit in select value from jsonb_array_elements(body->'chunk_ids') loop
     if (unit#>>'{}')::uuid=any(refs) then raise exception 'managed_admin_text_section_dependency_mismatch';end if;
     select * into cr from ingestion_generation_evidence.candidate_chunk_rows where id=(unit#>>'{}')::uuid and document_id=c.document_id and index_generation_id=c.generation_id;
     if not found or cr.section_heading is distinct from body->>'heading' or cr.section_path is distinct from array[cr.section_heading]
       or cr.metadata->>'extractor' is distinct from 'literal-admin-utf8-source-unit-v1' then raise exception 'managed_admin_text_section_dependency_mismatch';end if;
     refs:=array_append(refs,cr.id); start_byte:=(cr.metadata->>'heading_byte_start')::integer;end_byte:=(cr.metadata->>'heading_byte_end')::integer;
     if start_byte is null or end_byte is null or start_byte is distinct from (cr.metadata->>'source_byte_start')::integer or end_byte<=start_byte or end_byte>(cr.metadata->>'source_byte_end')::integer
       or convert_to(cr.section_heading,'UTF8') is distinct from substring(original.artifact_bytes from start_byte+1 for end_byte-start_byte)
       or not exists(select 1 from jsonb_array_elements(c.source_expectation->'units') x where x.value->>'id'=cr.metadata->>'source_unit_id'
         and x.value->>'locator'='utf8-bytes:'||(cr.metadata->>'source_byte_start')||':'||(cr.metadata->>'source_byte_end'))
       then raise exception 'managed_admin_text_section_heading_mismatch';end if;
     deps:=deps||jsonb_build_array(jsonb_build_object('family','chunks','key',cr.id::text||':final'));
     sources:=sources||jsonb_build_array(cr.metadata->>'source_unit_id');
     units:=units||jsonb_build_array(jsonb_build_object('id',cr.metadata->'source_unit_id','start',cr.metadata->'source_byte_start','end',cr.metadata->'source_byte_end','headingStart',start_byte,'headingEnd',end_byte));
   end loop;
   if s->'dependencies' is distinct from deps or s->'sourceEvidenceIds' is distinct from sources
     or body->'metadata' is distinct from jsonb_build_object('rag_indexing_version','rag-deep-memory-v1','index_generation_id',c.generation_id,'generated_by','local-worker',
       'artifact_generation_id',c.generation_id,'source_path',c.source_snapshot->'source_path','source_sha256',c.source_sha256,'source_expectation_digest',c.source_expectation_digest,'source_units',units)
     then raise exception 'managed_admin_text_section_dependency_mismatch';end if;
   select d.declaration into unit_declaration from ingestion_generation_evidence.unit_declarations d where d.document_id=c.document_id and d.generation_id=c.generation_id and d.family='sections' and d.unit_key=s->>'id';
   if unit_declaration is distinct from jsonb_build_object('id',jsonb_build_object('family','sections','key',s->>'id'),'groupKey','deep_memory','required',true,
     'dependencies',deps,'sourceEvidenceIds','[]'::jsonb,'qualification','derived_unverified','representation','provenance_json') then raise exception 'managed_admin_text_section_declaration_mismatch';end if;
   select * into art from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='sections' and unit_key=s->>'id';
   if not found or art.group_key<>'deep_memory' or art.representation<>'provenance_json' or art.source_sha256<>c.source_sha256
     or art.byte_length<>octet_length(art.artifact_bytes) or art.sha256<>'sha256:'||encode(extensions.digest(art.artifact_bytes,'sha256'),'hex')
     or convert_from(art.artifact_bytes,'UTF8')::jsonb is distinct from body
     or not exists(select 1 from ingestion_generation_evidence.outcomes where document_id=c.document_id and generation_id=c.generation_id and family='sections' and unit_key=s->>'id' and outcome->>'disposition'='retained' and outcome->>'artifactSha256'=art.sha256)
     then raise exception 'managed_admin_text_section_retained_mismatch';end if;
   if p_committed and not exists(select 1 from public.document_sections sr where sr.id=(s->>'id')::uuid and sr.document_id=c.document_id
     and (to_jsonb(sr)-array['created_at','updated_at'])=body||jsonb_build_object('id',s->'id','producer','local-worker','artifact_generation_id',c.generation_id,'index_generation_id',c.generation_id))
     then raise exception 'managed_admin_text_section_committed_mismatch';end if;
   ordinal:=ordinal+1;
 end loop;
 if exists(select 1 from ingestion_generation_evidence.candidate_chunk_rows where document_id=c.document_id and index_generation_id=c.generation_id and section_heading is not null and not(id=any(refs)))
   or (p_committed and (select count(*) from public.document_sections where document_id=c.document_id and index_generation_id=c.generation_id)<>total)
   or (not p_committed and exists(select 1 from public.document_sections where document_id=c.document_id and index_generation_id=c.generation_id))
   then raise exception 'managed_admin_text_section_population_mismatch';end if;
end $$;

-- selected function ingestion_generation_evidence.assert_admin_text_source_section_layout
create function ingestion_generation_evidence.assert_admin_text_source_section_layout(c ingestion_generation_evidence.candidates)
returns void language plpgsql security definer set search_path='' as $$
declare original ingestion_generation_evidence.retained_artifacts; witness ingestion_generation_evidence.retained_artifacts;
 u jsonb; spec jsonb; start_byte bigint; end_byte bigint; cursor_byte bigint:=0; heading_start bigint; heading_end bigint;
begin
 if c.source_section_layout is null or c.source_section_layout_bytes is null or c.source_section_layout_digest is null
   or octet_length(c.source_section_layout_bytes) not between 1 and 1048576
   or c.source_section_layout_digest is distinct from 'sha256:'||encode(extensions.digest(c.source_section_layout_bytes,'sha256'),'hex')
   or convert_from(c.source_section_layout_bytes,'UTF8')::jsonb is distinct from c.source_section_layout
   or not ingestion_generation_evidence.keys(c.source_section_layout,array['sourceSha256','units'])
   or c.source_section_layout->>'sourceSha256' is distinct from c.source_sha256
   or c.source_expectation->>'tag' is distinct from 'known'
   or c.source_expectation->>'sourceSha256' is distinct from c.source_sha256
   or convert_from(c.source_expectation_bytes,'UTF8')::jsonb is distinct from c.source_expectation
   or c.source_expectation_digest is distinct from 'sha256:'||encode(extensions.digest(c.source_expectation_bytes,'sha256'),'hex')
   or jsonb_typeof(c.source_section_layout->'units') is distinct from 'array'
   or jsonb_array_length(c.source_section_layout->'units') not between 1 and 2000
   or jsonb_array_length(c.source_section_layout->'units')<>jsonb_array_length(c.source_expectation->'units')
   or (select count(distinct value->>'sourceUnitId') from jsonb_array_elements(c.source_section_layout->'units'))<>jsonb_array_length(c.source_section_layout->'units')
   then raise exception 'admin_text_registered_layout_invalid';end if;
 select * into original from ingestion_generation_evidence.retained_artifacts
   where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source';
 if not found or original.representation is distinct from 'original_binary' or original.sha256 is distinct from c.source_sha256
   or original.source_sha256 is distinct from c.source_sha256 or original.byte_length is distinct from c.source_byte_length
   or original.byte_length not between 1 and 2097152
   or original.sha256 is distinct from 'sha256:'||encode(extensions.digest(original.artifact_bytes,'sha256'),'hex')
   then raise exception 'admin_text_registered_layout_original_invalid';end if;
 select * into witness from ingestion_generation_evidence.retained_artifacts
   where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source-expectation-witness';
 if not found or witness.representation is distinct from 'source_expectation_witness'
   or witness.source_sha256 is distinct from c.source_sha256 or witness.sha256 is distinct from c.source_expectation->'witness'->>'sha256'
   or witness.sha256 is distinct from 'sha256:'||encode(extensions.digest(witness.artifact_bytes,'sha256'),'hex')
   then raise exception 'admin_text_registered_layout_witness_invalid';end if;
 for u in select value from jsonb_array_elements(c.source_expectation->'units')
   order by split_part(value->>'locator',':',2)::bigint,split_part(value->>'locator',':',3)::bigint loop
   if coalesce(u->>'locator','') !~ '^utf8-bytes:(0|[1-9][0-9]*):[1-9][0-9]*$' then raise exception 'admin_text_registered_layout_unit_invalid';end if;
   start_byte:=split_part(u->>'locator',':',2)::bigint;end_byte:=split_part(u->>'locator',':',3)::bigint;
   if start_byte<>cursor_byte or end_byte<=start_byte or end_byte>original.byte_length then raise exception 'admin_text_registered_layout_unit_invalid';end if;
   cursor_byte:=end_byte;
   select value into spec from jsonb_array_elements(c.source_section_layout->'units') where value->>'sourceUnitId'=u->>'id';
   if not found or not ingestion_generation_evidence.keys(spec,array['sourceUnitId','headingByteStart','headingByteEnd'])
     or jsonb_typeof(spec->'sourceUnitId') is distinct from 'string'
     or ((spec->'headingByteStart'='null'::jsonb) is distinct from (spec->'headingByteEnd'='null'::jsonb))
     then raise exception 'admin_text_registered_layout_heading_invalid';end if;
   if spec->'headingByteStart'<>'null'::jsonb then
     if jsonb_typeof(spec->'headingByteStart') is distinct from 'number' or jsonb_typeof(spec->'headingByteEnd') is distinct from 'number'
       or spec->>'headingByteStart' !~ '^(0|[1-9][0-9]*)$' or spec->>'headingByteEnd' !~ '^[1-9][0-9]*$'
       then raise exception 'admin_text_registered_layout_heading_invalid';end if;
     heading_start:=(spec->>'headingByteStart')::bigint;heading_end:=(spec->>'headingByteEnd')::bigint;
     if heading_start<>start_byte or heading_end<=heading_start or heading_end>end_byte
       or btrim(convert_from(substring(original.artifact_bytes from heading_start::integer+1 for (heading_end-heading_start)::integer),'UTF8'))=''
       then raise exception 'admin_text_registered_layout_heading_invalid';end if;
   end if;
 end loop;
 if cursor_byte<>original.byte_length then raise exception 'admin_text_registered_layout_unit_invalid';end if;
end $$;

-- selected function ingestion_generation_evidence.candidate_enrichment_inputs
create or replace function ingestion_generation_evidence.candidate_enrichment_inputs(c ingestion_generation_evidence.candidates, p_document jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  version constant text := 'ingestion-candidate-enrichment-inputs-v1';
  cap constant bigint := 16777216;
  metadata_keys constant text[] := array['corpus_scope','source_kind','source_catalogue_key','source_policy_version','source_policy_digest','public_source_activation_event_id','public_source_activation_sequence','public_source_version_id','public_source_steward_id','content_mode','licence_policy','canonical_url','exact_version_url','version','content_hash','raw_response_hash','raw_response_byte_count','acquisition_disposition','public_source_storage_bucket','source_policy_checked','content_identity_verdict','content_identity_hash','content_identity_verdict_version','canonical_storage_path','public_corpus','admission_event_id','admission_policy_version','authority','source_role','authority_basis','rights_evidence_ref','provider_processing','purpose','supported_features','public_source_lifecycle','forbidden_source_identity','source_content_hash','source_exact_url','source_exact_version','licence_evidence_digest'];
  source_projection jsonb; current_projection jsonb; document_projection jsonb;
  g jsonb; ids jsonb; u jsonb; f jsonb; ref jsonb; requirement jsonb; pb jsonb; fb jsonb; wb jsonb; stored jsonb; projected jsonb; evidence jsonb;
  prepared ingestion_generation_evidence.retained_artifacts;
  final ingestion_generation_evidence.retained_artifacts;
  witness ingestion_generation_evidence.retained_artifacts;
  actual public.document_chunks;
  private_row ingestion_generation_evidence.candidate_chunk_rows;
  item record; artifact record; outcome record; key text; final_key text; chunk_id uuid;
  missing boolean := false; total integer; row_count integer; seen_ids uuid[] := '{}'; seen_indexes integer[] := '{}';
  rows jsonb := '[]'::jsonb; refs jsonb := '[]'::jsonb; result jsonb; budget bigint;
begin
  if jsonb_typeof(c.source_snapshot->'metadata') is distinct from 'object' or jsonb_typeof(p_document->'metadata') is distinct from 'object' then
    raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  -- Only source/admission metadata is returned. Ingestion/publication pointers are not fabricated.
  select jsonb_build_object('id',c.source_snapshot->'id','owner_id',c.source_snapshot->'owner_id',
    'title',c.source_snapshot->'title','file_name',c.source_snapshot->'file_name','source_path',c.source_snapshot->'source_path',
    'file_type',c.source_snapshot->'file_type','file_size',c.source_snapshot->'file_size','content_hash',c.source_snapshot->'content_hash',
    'metadata',coalesce((select jsonb_object_agg(k,v) from jsonb_each(c.source_snapshot->'metadata') x(k,v) where k=any(metadata_keys)),'{}'::jsonb)) into source_projection;
  select jsonb_build_object('id',p_document->'id','owner_id',p_document->'owner_id',
    'title',p_document->'title','file_name',p_document->'file_name','source_path',p_document->'source_path',
    'file_type',p_document->'file_type','file_size',p_document->'file_size','content_hash',p_document->'content_hash',
    'metadata',coalesce((select jsonb_object_agg(k,v) from jsonb_each(p_document->'metadata') x(k,v) where k=any(metadata_keys)),'{}'::jsonb)) into current_projection;
  if source_projection is distinct from current_projection or p_document->>'id' is distinct from c.document_id::text
    or coalesce(p_document->>'owner_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_document->>'content_hash' is distinct from substr(c.source_sha256,8)
    or p_document->'file_size' is distinct from to_jsonb(c.source_byte_length)
    or c.source_expectation_digest is distinct from 'sha256:'||encode(extensions.digest(c.source_expectation_bytes,'sha256'),'hex')
    or convert_from(c.source_expectation_bytes,'UTF8')::jsonb is distinct from c.source_expectation
    or c.registration->'sourceExpectation' is distinct from c.source_expectation
    or c.registration->>'sourceExpectationSha256' is distinct from c.source_expectation_digest
    then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  if p_document->>'file_type' is distinct from 'text/plain' or lower(coalesce(p_document->>'file_name','')) not like '%.txt' then
    return jsonb_build_object('version',version,'status','unavailable','reason','source_format_unsupported'); end if;
  if c.source_expectation->>'tag' is distinct from 'known' then
    return jsonb_build_object('version',version,'status','unavailable','reason','original_applicability_unavailable'); end if;
  select * into witness from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source-expectation-witness';
  if not found then return jsonb_build_object('version',version,'status','pending','reason','inputs_not_retained'); end if;
  if witness.group_key is distinct from 'private_objects' or witness.representation is distinct from 'source_expectation_witness'
    or witness.source_sha256 is distinct from c.source_sha256 or witness.sha256 is distinct from c.source_expectation->'witness'->>'sha256'
    or witness.byte_length is distinct from octet_length(witness.artifact_bytes)::bigint
    or witness.sha256 is distinct from 'sha256:'||encode(extensions.digest(witness.artifact_bytes,'sha256'),'hex')
    then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  wb:=convert_from(witness.artifact_bytes,'UTF8')::jsonb;
  if wb->>'version' is distinct from 'ingestion-original-applicability-v1' then
    return jsonb_build_object('version',version,'status','unavailable','reason','original_applicability_unavailable'); end if;
  if not ingestion_generation_evidence.keys(wb,array['version','qualification','sourceSha256','sourceByteLength','sourceUnits','groups'])
    or wb->>'qualification' is distinct from 'independently_declared_unverified'
    or wb->>'sourceSha256' is distinct from c.source_sha256 or wb->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
    or wb->'sourceUnits' is distinct from c.source_expectation->'units' or jsonb_typeof(wb->'groups') is distinct from 'array'
    or (select count(*) from jsonb_array_elements(wb->'groups') x where x.value->>'family'='images')<>1
    or (select count(*) from jsonb_array_elements(wb->'groups') x where x.value->>'family'='chunks')<>1
    then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  if jsonb_typeof(wb->'sourceUnits') is distinct from 'array' or jsonb_array_length(wb->'sourceUnits')=0
    or jsonb_array_length(wb->'sourceUnits')<>(select count(distinct value->>'id') from jsonb_array_elements(wb->'sourceUnits'))
    then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  for u in select value from jsonb_array_elements(wb->'sourceUnits') loop
    if not ingestion_generation_evidence.keys(u,array['id','required','dependencies','locator','nativeMapping'])
      or jsonb_typeof(u->'id') is distinct from 'string' or coalesce(u->>'id','')=''
      or jsonb_typeof(u->'required') is distinct from 'boolean'
      or jsonb_typeof(u->'locator') is distinct from 'string' or coalesce(u->>'locator','')=''
      or u->>'nativeMapping' is distinct from 'unavailable' or jsonb_typeof(u->'dependencies') is distinct from 'array'
      or jsonb_array_length(u->'dependencies')<>(select count(distinct value) from jsonb_array_elements(u->'dependencies'))
      or exists(select 1 from jsonb_array_elements(u->'dependencies') d where jsonb_typeof(d.value) is distinct from 'string'
        or d.value=u->'id' or not exists(select 1 from jsonb_array_elements(wb->'sourceUnits') s where s.value->'id'=d.value))
      then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  end loop;
  if jsonb_array_length(wb->'groups')<>5
    or (select count(distinct value->>'family') from jsonb_array_elements(wb->'groups'))<>5
    or exists(select 1 from jsonb_array_elements(wb->'groups') x where not ingestion_generation_evidence.keys(x.value,array['family','population'])
      or x.value->>'family' not in ('chunks','images','table_facts','embedding_fields','index_units'))
    then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  for g in select value->'population' from jsonb_array_elements(wb->'groups') loop
    if g->>'tag'='unknown' then
      if not ingestion_generation_evidence.keys(g,array['tag','limitation']) or jsonb_typeof(g->'limitation') is distinct from 'string'
        or coalesce(g->>'limitation','')='' then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    elsif g->>'tag'='known' then
      if not ingestion_generation_evidence.keys(g,array['tag','requirements','basis','reason']) or jsonb_typeof(g->'requirements') is distinct from 'array'
        or g->'basis' is distinct from '{"scope":"whole_original","kind":"independent_original_declaration"}'::jsonb
        or ((jsonb_array_length(g->'requirements')=0) is distinct from coalesce(g->>'reason'='no_original_requirements_in_scope',false))
        or (jsonb_array_length(g->'requirements')>0 and g->'reason' is distinct from 'null'::jsonb)
        or jsonb_array_length(g->'requirements')<>(select count(distinct value->>'id') from jsonb_array_elements(g->'requirements'))
        then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
      for requirement in select value from jsonb_array_elements(g->'requirements') loop
        if not ingestion_generation_evidence.keys(requirement,array['id','required','sourceEvidenceIds'])
          or jsonb_typeof(requirement->'id') is distinct from 'string' or coalesce(requirement->>'id','')='' or requirement->'required' is distinct from 'true'::jsonb
          or jsonb_typeof(requirement->'sourceEvidenceIds') is distinct from 'array' or jsonb_array_length(requirement->'sourceEvidenceIds')=0
          or jsonb_array_length(requirement->'sourceEvidenceIds')<>(select count(distinct value) from jsonb_array_elements(requirement->'sourceEvidenceIds'))
          or exists(select 1 from jsonb_array_elements(requirement->'sourceEvidenceIds') r where jsonb_typeof(r.value) is distinct from 'string'
            or not exists(select 1 from jsonb_array_elements(wb->'sourceUnits') s where s.value->'id'=r.value))
          or exists(select 1 from jsonb_array_elements(wb->'sourceUnits') s cross join lateral jsonb_array_elements(s.value->'dependencies') dep
            where requirement->'sourceEvidenceIds' @> jsonb_build_array(s.value->'id') and not requirement->'sourceEvidenceIds' @> jsonb_build_array(dep.value))
          then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
      end loop;
    else raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  end loop;
  if exists(with recursive edges as (
      select s.value->>'id' as start_id,d.value#>>'{}' as next_id,array[s.value->>'id'] as path
      from jsonb_array_elements(wb->'sourceUnits') s cross join lateral jsonb_array_elements(s.value->'dependencies') d
      union all
      select e.start_id,d.value#>>'{}',array_append(e.path,e.next_id) from edges e
      join lateral jsonb_array_elements(wb->'sourceUnits') s on s.value->>'id'=e.next_id
      cross join lateral jsonb_array_elements(s.value->'dependencies') d where not e.next_id=any(e.path)
    ) select 1 from edges where next_id=any(path)) then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  select value->'population' into g from jsonb_array_elements(wb->'groups') where value->>'family'='images';
  if g->>'tag' is distinct from 'known' then return jsonb_build_object('version',version,'status','unavailable','reason','image_applicability_unsupported'); end if;
  if not ingestion_generation_evidence.keys(g,array['tag','requirements','basis','reason']) or jsonb_typeof(g->'requirements') is distinct from 'array'
    or g->'basis' is distinct from '{"scope":"whole_original","kind":"independent_original_declaration"}'::jsonb
    then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  if jsonb_array_length(g->'requirements')>0 then return jsonb_build_object('version',version,'status','unavailable','reason','image_applicability_unsupported'); end if;
  if g->>'reason' is distinct from 'no_original_requirements_in_scope'
    or exists(select 1 from public.document_images where document_id=c.document_id and index_generation_id=c.generation_id)
    or exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and (family='images' or representation='image_binary'))
    then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  select value->'population' into g from jsonb_array_elements(wb->'groups') where value->>'family'='chunks';
  if g->>'tag' is distinct from 'known' then return jsonb_build_object('version',version,'status','unavailable','reason','original_applicability_unavailable'); end if;
  select declaration into g from ingestion_generation_evidence.producer_declarations where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and group_key='worker_core';
  if not found then return jsonb_build_object('version',version,'status','pending','reason','inputs_not_retained'); end if;
  if not ingestion_generation_evidence.keys(g,array['producer','artifactGenerationId','population'])
    or not ingestion_generation_evidence.keys(g->'producer',array['name','version','outputManifestDigest'])
    or not ingestion_generation_evidence.keys(g->'population',array['tag','expectedUnits','basis','reason'])
    or g->'producer'->>'name' is distinct from 'worker_candidate_chunks'
    or g->'producer'->>'version' is distinct from 'ingestion-prepared-chunk-v1'
    or coalesce(g->'producer'->>'outputManifestDigest','') !~ '^sha256:[0-9a-f]{64}$'
    or g->'artifactGenerationId' is distinct from 'null'::jsonb or g->'population'->>'tag' is distinct from 'known'
    or g->'population'->'reason' is distinct from 'null'::jsonb or jsonb_typeof(g->'population'->'basis') is distinct from 'array'
    or jsonb_array_length(g->'population'->'basis')=0
    or exists(select 1 from jsonb_array_elements(g->'population'->'basis') b where not ingestion_generation_evidence.keys(b.value,array['reference','sha256'])
      or jsonb_typeof(b.value->'reference') is distinct from 'string' or coalesce(b.value->>'reference','')=''
      or coalesce(b.value->>'sha256','') !~ '^sha256:[0-9a-f]{64}$')
    or jsonb_typeof(g->'population'->'expectedUnits') is distinct from 'array' then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  ids:=g->'population'->'expectedUnits';
  total:=jsonb_array_length(ids);
  if total=0 or total%2<>0 or total<>(select count(distinct value) from jsonb_array_elements(ids))
    or exists(select 1 from jsonb_array_elements(ids) x where not ingestion_generation_evidence.keys(x.value,array['family','key'])
      or x.value->>'family' is distinct from 'chunks' or coalesce(x.value->>'key','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(prepared|final)$')
    or exists(select 1 from jsonb_array_elements(ids) x where not ids @> jsonb_build_array(jsonb_build_object('family','chunks','key',split_part(x.value->>'key',':',1)||case when x.value->>'key' like '%:prepared' then ':final' else ':prepared' end)))
    or exists(select 1 from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and (group_key<>'worker_core' or not ids @> jsonb_build_array(jsonb_build_object('family','chunks','key',unit_key))))
    or exists(select 1 from public.document_chunks where document_id=c.document_id and index_generation_id=c.generation_id)
    or exists(select 1 from ingestion_generation_evidence.candidate_chunk_rows where document_id=c.document_id and index_generation_id=c.generation_id and not ids @> jsonb_build_array(jsonb_build_object('family','chunks','key',id::text||':final')))
    then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  if total/2>5000 then return jsonb_build_object('version',version,'status','unavailable','reason','chunk_limit_exceeded'); end if;
  document_projection:=current_projection-array['file_type','file_size','content_hash'];
  result:=jsonb_build_object('version',version,'status','ready','qualification','derived_unverified','sourceCompleteness','unavailable','nativeMapping','unavailable',
    'jobId',c.job_id,'leaseToken',c.first_lease_token,'authorityDigest',c.authority_digest,'documentId',c.document_id,'ownerId',p_document->'owner_id',
    'generationId',c.generation_id,'predecessorGenerationId',c.predecessor_generation_id,'sourceSha256',c.source_sha256,
    'sourceByteLength',c.source_byte_length,'sourceExpectationDigest',c.source_expectation_digest,
    'document',document_projection,'chunks','[]'::jsonb,'images','[]'::jsonb,'chunkEvidence','[]'::jsonb);
  budget:=octet_length(convert_to(result::text,'UTF8'));
  if budget>cap then return jsonb_build_object('version',version,'status','unavailable','reason','transport_limit_exceeded'); end if;
  for item in select value->>'key' as unit_key from jsonb_array_elements(ids) where value->>'key' like '%:prepared' order by value->>'key' loop
    key:=item.unit_key; chunk_id:=split_part(key,':',1)::uuid; final_key:=chunk_id::text||':final';
    select declaration into u from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=key;
    select declaration into f from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=final_key;
    if u is null or f is null then missing:=true; end if;
    for ref in select value from jsonb_array_elements(jsonb_build_array(u,f)) where value<>'null'::jsonb loop
      if not ingestion_generation_evidence.keys(ref,array['id','groupKey','required','dependencies','sourceEvidenceIds','qualification','representation'])
        or ref->>'groupKey' is distinct from 'worker_core' or ref->'required' is distinct from 'true'::jsonb
        or ref->>'qualification' is distinct from 'derived_unverified' or ref->>'representation' is distinct from 'provenance_json'
        or ref->'sourceEvidenceIds' is distinct from '[]'::jsonb
        then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    end loop;
    if (u is not null and u->'id' is distinct from jsonb_build_object('family','chunks','key',key))
      or (f is not null and (f->'id' is distinct from jsonb_build_object('family','chunks','key',final_key)
      or f->'dependencies' is distinct from jsonb_build_array(jsonb_build_object('family','chunks','key',key)))) then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    select * into prepared from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=key;
    select * into final from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=final_key;
    for artifact in select * from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key in (key,final_key) loop
      if artifact.group_key is distinct from 'worker_core' or artifact.representation is distinct from 'provenance_json'
        or artifact.source_sha256 is distinct from c.source_sha256 or artifact.locator is distinct from 'ingestion_chunk:'||artifact.unit_key
        or artifact.byte_length is distinct from octet_length(artifact.artifact_bytes)::bigint
        or artifact.sha256 is distinct from 'sha256:'||encode(extensions.digest(artifact.artifact_bytes,'sha256'),'hex')
        then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    end loop;
    for outcome in select o.* from ingestion_generation_evidence.outcomes o where o.document_id=c.document_id and o.generation_id=c.generation_id and o.family='chunks' and o.unit_key in (key,final_key) loop
      ref:=outcome.outcome;
      if not ingestion_generation_evidence.keys(ref,array['unitId','groupKey','disposition','artifactSha256','limitation'])
        or ref->'unitId' is distinct from jsonb_build_object('family','chunks','key',outcome.unit_key) or outcome.group_key is distinct from 'worker_core'
        or ref->>'groupKey' is distinct from 'worker_core' or ref->>'disposition' is distinct from 'retained' or ref->'limitation' is distinct from 'null'::jsonb
        or not exists(select 1 from ingestion_generation_evidence.retained_artifacts a where a.document_id=c.document_id and a.generation_id=c.generation_id and a.family='chunks' and a.unit_key=ref->'unitId'->>'key' and a.sha256=ref->>'artifactSha256')
        then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    end loop;
    if prepared.document_id is null then
      if final.document_id is not null then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
      missing:=true; continue; end if;
    pb:=convert_from(prepared.artifact_bytes,'UTF8')::jsonb;
    if not ingestion_generation_evidence.keys(pb,array['version','qualification','documentId','generationId','sourceSha256','sourceExpectationDigest','chunkId','chunkIndex','row','references'])
      or pb->>'version' is distinct from 'ingestion-prepared-chunk-v1' or pb->>'qualification' is distinct from 'derived_unverified'
      or pb->>'documentId' is distinct from c.document_id::text or pb->>'generationId' is distinct from c.generation_id::text
      or pb->>'sourceSha256' is distinct from c.source_sha256 or pb->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
      or pb->>'chunkId' is distinct from chunk_id::text or pb->'chunkIndex' is distinct from pb->'row'->'chunk_index'
      or jsonb_typeof(pb->'references') is distinct from 'array' or u is null
      or u->'dependencies' is distinct from (select jsonb_agg(value->'unitId' order by ord) from jsonb_array_elements(pb->'references') with ordinality x(value,ord))
      then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    if not ingestion_generation_evidence.keys(pb->'row',array['id','document_id','page_number','chunk_index','section_heading','section_path','heading_level','parent_heading','anchor_id','content','retrieval_synopsis','content_hash','index_generation_id','token_estimate','image_ids','metadata'])
      or pb->'row'->>'id' is distinct from chunk_id::text or pb->'row'->>'document_id' is distinct from c.document_id::text
      or pb->'row'->>'index_generation_id' is distinct from c.generation_id::text or pb->'row'->'image_ids' is distinct from '[]'::jsonb
      or jsonb_typeof(pb->'row'->'metadata') is distinct from 'object'
      or (pb->'row'->'metadata') ?| array['ingestion_lease_token','ingestion_job_kind','ingestion_job_id']
      or coalesce(pb->>'chunkIndex','') !~ '^(0|[1-9][0-9]*)$'
      or jsonb_typeof(pb->'chunkIndex') is distinct from 'number'
      or jsonb_typeof(pb->'row'->'content') is distinct from 'string' or coalesce(pb->'row'->>'content','')=''
      or jsonb_typeof(pb->'row'->'content_hash') is distinct from 'string'
      or jsonb_typeof(pb->'row'->'section_path') is distinct from 'array'
      or exists(select 1 from jsonb_array_elements(pb->'row'->'section_path') x where jsonb_typeof(x.value) is distinct from 'string')
      or (pb->'row'->'page_number' is distinct from 'null'::jsonb and (jsonb_typeof(pb->'row'->'page_number') is distinct from 'number' or coalesce(pb->'row'->>'page_number','') !~ '^[1-9][0-9]*$'))
      or (pb->'row'->'heading_level' is distinct from 'null'::jsonb and (jsonb_typeof(pb->'row'->'heading_level') is distinct from 'number' or coalesce(pb->'row'->>'heading_level','') !~ '^-?(0|[1-9][0-9]*)$'))
      or exists(select 1 from unnest(array['section_heading','parent_heading','anchor_id','retrieval_synopsis']) field where pb->'row'->field is distinct from 'null'::jsonb and jsonb_typeof(pb->'row'->field) is distinct from 'string')
      or jsonb_typeof(pb->'row'->'token_estimate') is distinct from 'number' or coalesce(pb->'row'->>'token_estimate','') !~ '^(0|[1-9][0-9]*)$'
      then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    if chunk_id=any(seen_ids) or (pb->>'chunkIndex')::integer=any(seen_indexes) then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    seen_ids:=array_append(seen_ids,chunk_id); seen_indexes:=array_append(seen_indexes,(pb->>'chunkIndex')::integer);
    if jsonb_array_length(pb->'references')=0 or jsonb_array_length(pb->'references')<>(select count(distinct value->'unitId') from jsonb_array_elements(pb->'references'))
      or not exists(select 1 from jsonb_array_elements(pb->'references') x where x.value->'unitId'='{"family":"private_objects","key":"original-source"}'::jsonb and x.value->>'sha256'=c.source_sha256 and x.value->'byteLength'=to_jsonb(c.source_byte_length))
      or not exists(select 1 from jsonb_array_elements(pb->'references') x where x.value->'unitId'='{"family":"private_objects","key":"original-source-expectation-witness"}'::jsonb and x.value->>'sha256'=witness.sha256 and x.value->>'representation'='source_expectation_witness')
      or not exists(select 1 from jsonb_array_elements(pb->'references') x where x.value->'unitId'->>'family'='pages' and (pb->'row'->'page_number'='null'::jsonb or x.value->'unitId'->>'key'=pb->'row'->>'page_number'))
      then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    for ref in select value from jsonb_array_elements(pb->'references') loop
      if not ingestion_generation_evidence.keys(ref,array['unitId','sha256','byteLength','representation'])
        or not ingestion_generation_evidence.keys(ref->'unitId',array['family','key'])
        or coalesce(ref->>'sha256','') !~ '^sha256:[0-9a-f]{64}$'
        or not exists(select 1 from ingestion_generation_evidence.retained_artifacts a where a.document_id=c.document_id and a.generation_id=c.generation_id
          and a.family=ref->'unitId'->>'family' and a.unit_key=ref->'unitId'->>'key' and a.sha256=ref->>'sha256'
          and to_jsonb(a.byte_length)=ref->'byteLength' and a.representation=ref->>'representation' and a.source_sha256=c.source_sha256
          and a.byte_length=octet_length(a.artifact_bytes) and a.sha256='sha256:'||encode(extensions.digest(a.artifact_bytes,'sha256'),'hex'))
        then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    end loop;
    if (select count(*) from ingestion_generation_evidence.outcomes where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key in (key,final_key))<>2 then missing:=true; end if;
    if final.document_id is null then missing:=true; continue; end if;
    if f is null then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    fb:=convert_from(final.artifact_bytes,'UTF8')::jsonb;
    select * into private_row from ingestion_generation_evidence.candidate_chunk_rows where id=chunk_id for share;
    if not found then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    -- PRIVATE CHUNK READ IDENTITY BEGIN
    if private_row.candidate_owner_id is distinct from (p_document->>'owner_id')::uuid
      or private_row.candidate_job_id is distinct from c.job_id
      or private_row.candidate_lease_token is distinct from c.first_lease_token
      or private_row.candidate_authority_digest is distinct from c.authority_digest
      or private_row.candidate_source_sha256 is distinct from c.source_sha256
      or private_row.candidate_source_expectation_digest is distinct from c.source_expectation_digest
      or private_row.candidate_prepared_sha256 is distinct from prepared.sha256 then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    actual:=jsonb_populate_record(null::public.document_chunks,to_jsonb(private_row));
    -- PRIVATE CHUNK READ IDENTITY END
    stored:=(to_jsonb(actual)-array['created_at','search_tsv','embedding'])||jsonb_build_object('embedding',(actual.embedding::text)::jsonb);
    if not ingestion_generation_evidence.keys(fb,array['version','qualification','documentId','generationId','sourceSha256','sourceExpectationDigest','chunkId','chunkIndex','preparedSha256','row'])
      or fb->>'version' is distinct from 'ingestion-persisted-chunk-v1' or fb->>'qualification' is distinct from 'derived_unverified'
      or fb->>'documentId' is distinct from c.document_id::text or fb->>'generationId' is distinct from c.generation_id::text
      or fb->>'sourceSha256' is distinct from c.source_sha256 or fb->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
      or fb->>'chunkId' is distinct from chunk_id::text or fb->'chunkIndex' is distinct from pb->'chunkIndex'
      or fb->>'preparedSha256' is distinct from prepared.sha256 or fb->'row' is distinct from stored
      or actual.document_id is distinct from c.document_id or actual.index_generation_id is distinct from c.generation_id
      or actual.metadata->>'ingestion_job_id' is distinct from c.job_id::text
      or actual.metadata->>'ingestion_job_kind' is distinct from 'node' or actual.metadata->>'ingestion_lease_token' is distinct from c.first_lease_token::text
      or actual.metadata->>'index_generation_id' is distinct from c.generation_id::text
      or (stored-array['metadata','embedding']) is distinct from ((pb->'row')-'metadata')
      or (actual.metadata-array['ingestion_job_id','ingestion_job_kind','ingestion_lease_token']) is distinct from pb->'row'->'metadata'
      or actual.embedding is null then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
    projected:=jsonb_build_object('id',actual.id,'document_id',actual.document_id,'index_generation_id',actual.index_generation_id,
      'page_number',actual.page_number,'chunk_index',actual.chunk_index,'section_heading',actual.section_heading,'section_path',actual.section_path,
      'heading_level',actual.heading_level,'parent_heading',actual.parent_heading,'anchor_id',actual.anchor_id,'content',actual.content,
      'image_ids',actual.image_ids,'metadata',actual.metadata);
    evidence:=jsonb_build_object('chunkId',chunk_id,'chunkIndex',actual.chunk_index,'preparedUnitId',jsonb_build_object('family','chunks','key',key),
      'finalUnitId',jsonb_build_object('family','chunks','key',final_key),'preparedSha256',prepared.sha256,'preparedByteLength',prepared.byte_length,
      'finalSha256',final.sha256,'finalByteLength',final.byte_length);
    budget:=budget+octet_length(convert_to(projected::text,'UTF8'))+octet_length(convert_to(evidence::text,'UTF8'))+case when jsonb_array_length(rows)=0 then 0 else 4 end;
    if budget>cap then return jsonb_build_object('version',version,'status','unavailable','reason','transport_limit_exceeded'); end if;
    rows:=rows||jsonb_build_array(projected); refs:=refs||jsonb_build_array(evidence);
  end loop;
  if missing then return jsonb_build_object('version',version,'status','pending','reason','inputs_not_retained'); end if;
  select count(*) into row_count from ingestion_generation_evidence.candidate_chunk_rows where document_id=c.document_id and index_generation_id=c.generation_id;
  if row_count<>total/2 or jsonb_array_length(rows)<>total/2 then raise exception 'candidate_enrichment_inputs_identity_mismatch'; end if;
  result:=result||jsonb_build_object('chunks',(select jsonb_agg(value order by (value->>'chunk_index')::integer,value->>'id') from jsonb_array_elements(rows)),
    'chunkEvidence',(select jsonb_agg(value order by (value->>'chunkIndex')::integer,value->>'chunkId') from jsonb_array_elements(refs)));
  if octet_length(convert_to(result::text,'UTF8'))>cap then return jsonb_build_object('version',version,'status','unavailable','reason','transport_limit_exceeded'); end if;
  return result;
exception when invalid_text_representation or character_not_in_repertoire or numeric_value_out_of_range then
  raise exception 'candidate_enrichment_inputs_identity_mismatch';
end $$;

-- selected function ingestion_generation_evidence.declare_groups
-- P2d private extraction-retention diagnostic; no whole-index quality or eligibility.
create or replace function ingestion_generation_evidence.declare_groups(c ingestion_generation_evidence.candidates,p_declarations jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb; u jsonb; p jsonb; d jsonb; prior jsonb; expected jsonb; actual jsonb; n integer; dg text;
begin
  if not ingestion_generation_evidence.keys(p_declarations,array['version','groups','units']) or p_declarations->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_declarations->'groups') is distinct from 'array' or jsonb_typeof(p_declarations->'units') is distinct from 'array' then raise exception 'invalid_generation_declarations'; end if;
  for g in select value from jsonb_array_elements(p_declarations->'groups') loop
    if not ingestion_generation_evidence.keys(g,array['family','groupKey','declaration'])
      or not exists(select 1 from jsonb_array_elements(ingestion_generation_evidence.slots()) s where s.value->>0=g->>'family' and s.value->>1=g->>'groupKey') then raise exception 'invalid_generation_producer_slot'; end if;
    d:=g->'declaration';p:=d->'population';
    if not ingestion_generation_evidence.keys(d,array['producer','artifactGenerationId','population'])
      or not ingestion_generation_evidence.keys(d->'producer',array['name','version','outputManifestDigest'])
      or coalesce(d->'producer'->>'name','')='' or coalesce(d->'producer'->>'version','')=''
      or coalesce(d->'producer'->>'outputManifestDigest','') !~ '^sha256:[0-9a-f]{64}$'
      or (d->'artifactGenerationId' is distinct from 'null'::jsonb and (g->>'groupKey'<>'deep_memory' or coalesce(d->>'artifactGenerationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or (d->>'artifactGenerationId')::uuid=c.generation_id or (d->>'artifactGenerationId')::uuid is not distinct from c.predecessor_generation_id)) then raise exception 'invalid_generation_producer_declaration'; end if;
    if g->>'groupKey'='deep_memory' and d->'artifactGenerationId' is distinct from 'null'::jsonb and exists(select 1 from ingestion_generation_evidence.producer_declarations pd where pd.document_id=c.document_id and pd.generation_id=c.generation_id and pd.group_key='deep_memory' and pd.declaration->'artifactGenerationId' is distinct from 'null'::jsonb and pd.declaration->'artifactGenerationId' is distinct from d->'artifactGenerationId') then raise exception 'generation_artifact_owner_mismatch'; end if;
    if p->>'tag'='known' then
      if not ingestion_generation_evidence.keys(p,array['tag','expectedUnits','basis','reason'])
        or jsonb_typeof(p->'expectedUnits') is distinct from 'array' or jsonb_typeof(p->'basis') is distinct from 'array'
        or jsonb_array_length(p->'basis')=0
        or ((jsonb_array_length(p->'expectedUnits')=0) is distinct from coalesce(p->>'reason'='no_units_expected',false))
        or (jsonb_array_length(p->'expectedUnits')>0 and p->'reason' is distinct from 'null'::jsonb) then raise exception 'invalid_generation_population'; end if;
      for u in select value from jsonb_array_elements(p->'basis') loop
        if not ingestion_generation_evidence.keys(u,array['reference','sha256']) or coalesce(u->>'reference','')='' or coalesce(u->>'sha256','') !~ '^sha256:[0-9a-f]{64}$' then raise exception 'invalid_generation_population_basis'; end if;
      end loop;
      for u in select value from jsonb_array_elements(p->'expectedUnits') loop
        if not ingestion_generation_evidence.keys(u,array['family','key']) or u->>'family' is distinct from g->>'family' or coalesce(u->>'key','')='' then raise exception 'invalid_generation_expected_unit'; end if;
      end loop;
      if exists(select 1 from jsonb_array_elements(p->'expectedUnits') x group by x.value having count(*)>1) then raise exception 'generation_producer_group_collision'; end if;
    elsif p->>'tag' in ('unknown','unavailable') then
      if not ingestion_generation_evidence.keys(p,array['tag','limitation']) or not ingestion_generation_evidence.keys(p->'limitation',array['code','scope','capability'])
      or coalesce(p->'limitation'->>'scope','')='' or jsonb_typeof(p->'limitation'->'code') is distinct from 'string' or coalesce(p->'limitation'->>'code','') not in ('required_fidelity_unassessed','producer_unavailable','producer_failed','producer_skipped','dependency_unknown')
      or jsonb_typeof(p->'limitation'->'capability') is distinct from 'string' or coalesce(p->'limitation'->>'capability','') not in ('source_fidelity','native_mapping','optional_derivative','source_inventory')
        or (p->>'tag'='unknown' and g->>'family' not in ('native_structure','cache_inputs','repair_audit_inputs'))
        or (p->>'tag'='unavailable' and g->>'groupKey' not in ('deep_memory','enrichment','cache')) then raise exception 'invalid_generation_unknown_population'; end if;
    else raise exception 'invalid_generation_population'; end if;
    if g->>'family'='quality' then
      if g->>'groupKey' is distinct from 'worker_core' or p->>'tag' is distinct from 'known'
        or p->'reason' is distinct from 'null'::jsonb
        or p->'expectedUnits' is distinct from '[{"family":"quality","key":"singleton"}]'::jsonb
        or jsonb_array_length(p->'basis')<>1 or p->'basis'->0->>'reference' is distinct from 'actual_extraction_retention'
        or p->'basis'->0->>'sha256' is distinct from c.source_sha256 then raise exception 'invalid_quality_diagnostic_plan'; end if;
    end if;
    if g->>'family'='attempt_control' then
      if g->>'groupKey' is distinct from 'control' or p->>'tag' is distinct from 'known'
        or p->'reason' is distinct from 'null'::jsonb or jsonb_array_length(p->'expectedUnits')<>2
        or not p->'expectedUnits' @> '[{"family":"attempt_control","key":"claim_checkpoint"},{"family":"attempt_control","key":"preseal_checkpoint"}]'::jsonb
        or jsonb_array_length(p->'basis')<>1 or p->'basis'->0->>'reference' is distinct from 'actual_issued_claim'
        then raise exception 'invalid_attempt_control_plan'; end if;
    end if;
    select declaration into prior from ingestion_generation_evidence.producer_declarations where document_id=c.document_id and generation_id=c.generation_id and family=g->>'family' and group_key=g->>'groupKey';
    if found then
      if prior is distinct from d then raise exception 'immutable_generation_declaration'; end if;
    else
      if c.expected_inventory_digest is not null then raise exception 'generation_inventory_already_frozen'; end if;
      insert into ingestion_generation_evidence.producer_declarations values(c.document_id,c.generation_id,g->>'family',g->>'groupKey',d,c.first_lease_token);
    end if;
  end loop;
  for u in select value from jsonb_array_elements(p_declarations->'units') loop
    if not ingestion_generation_evidence.keys(u,array['id','groupKey','required','dependencies','sourceEvidenceIds','qualification','representation'])
      or not ingestion_generation_evidence.keys(u->'id',array['family','key']) or coalesce(u->'id'->>'key','')=''
      or jsonb_typeof(u->'required') is distinct from 'boolean' or jsonb_typeof(u->'dependencies') is distinct from 'array'
      or jsonb_typeof(u->'sourceEvidenceIds') is distinct from 'array'
      or jsonb_typeof(u->'qualification') is distinct from 'string' or coalesce(u->>'qualification','') not in ('source_bytes_exact','whole_logical_unit_unverified','derived_unverified')
      or (u->'representation' is distinct from 'null'::jsonb and (jsonb_typeof(u->'representation') is distinct from 'string' or coalesce(u->>'representation','') not in ('original_binary','extracted_utf8','persisted_utf8','provenance_json','page_projection','document_projection','source_expectation_witness','image_binary','image_provenance')))
      or (u->'id'->>'family' in ('pages','native_structure','chunks','quality','document_metadata','private_objects','attempt_control') and u->'required' is distinct from 'true'::jsonb) then raise exception 'invalid_generation_unit_declaration'; end if;
    if u->>'representation' in ('image_binary','image_provenance') and (
      u->'id'->>'family' is distinct from 'private_objects' or u->>'groupKey' is distinct from 'private_objects' or u->>'qualification' is distinct from 'derived_unverified'
      or coalesce(u->'id'->>'key','') !~ (case when u->>'representation'='image_binary' then '^image:[1-9][0-9]*:binary$' else '^image:[1-9][0-9]*:provenance$' end)
      or u->'dependencies' is distinct from jsonb_build_array(jsonb_build_object('family','private_objects','key',case when u->>'representation'='image_binary' then 'original-source' else 'image:'||split_part(u->'id'->>'key',':',2)||':binary' end))) then raise exception 'invalid_retained_image_declaration'; end if;
    if u->'id'->>'family'='quality' then
      select coalesce(jsonb_agg(declaration->'id' order by family,unit_key),'[]'::jsonb) into expected
        from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and
          ((family='pages' and declaration->>'representation'='page_projection') or
           (family='private_objects' and (unit_key='original-source' or unit_key ~ '^page:[1-9][0-9]*:(extracted|persisted|original-provenance|persisted-provenance)$' or unit_key ~ '^image:[1-9][0-9]*:(binary|provenance)$')));
      select coalesce(jsonb_agg(dep.value order by dep.value->>'family',dep.value->>'key'),'[]'::jsonb) into actual from jsonb_array_elements(u->'dependencies') dep;
      if u->'id'->>'key' is distinct from 'singleton' or u->>'groupKey' is distinct from 'worker_core'
        or u->'required' is distinct from 'true'::jsonb or u->>'representation' is distinct from 'provenance_json'
        or u->>'qualification' is distinct from 'derived_unverified' or u->'sourceEvidenceIds' is distinct from '[]'::jsonb
        or actual is distinct from expected or jsonb_array_length(expected)=0 then raise exception 'invalid_quality_diagnostic_plan'; end if;
    end if;
    if u->'id'->>'family'='attempt_control' then
      if u->'id'->>'key' not in ('claim_checkpoint','preseal_checkpoint') or u->>'groupKey' is distinct from 'control'
        or u->'required' is distinct from 'true'::jsonb or u->>'representation' is distinct from 'provenance_json'
        or u->>'qualification' is distinct from 'derived_unverified' or u->'sourceEvidenceIds' is distinct from '[]'::jsonb
        or u->'dependencies' is distinct from (case when u->'id'->>'key'='claim_checkpoint'
          then '[{"family":"private_objects","key":"original-source"}]'::jsonb
          else '[{"family":"attempt_control","key":"claim_checkpoint"},{"family":"private_objects","key":"original-source"}]'::jsonb end)
        then raise exception 'invalid_attempt_control_plan'; end if;
    end if;
    select declaration into d from ingestion_generation_evidence.producer_declarations where document_id=c.document_id and generation_id=c.generation_id and family=u->'id'->>'family' and group_key=u->>'groupKey';
    if not found or d->'population'->>'tag'<>'known' or not (d->'population'->'expectedUnits' @> jsonb_build_array(u->'id')) then raise exception 'generation_unit_population_mismatch'; end if;
    if exists(select 1 from jsonb_array_elements(u->'dependencies') dep where not ingestion_generation_evidence.keys(dep.value,array['family','key']) or coalesce(dep.value->>'key','')='' or dep.value=u->'id')
      or exists(select 1 from jsonb_array_elements(u->'dependencies') dep group by dep.value having count(*)>1)
      or exists(select 1 from jsonb_array_elements(u->'sourceEvidenceIds') s where jsonb_typeof(s.value)<>'string' or not exists(select 1 from jsonb_array_elements(case when c.source_expectation->>'tag'='known' then c.source_expectation->'units' else '[]'::jsonb end) su where su.value->>'id'=s.value#>>'{}')) then raise exception 'generation_dependency_population_mismatch'; end if;
    select declaration into prior from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family=u->'id'->>'family' and unit_key=u->'id'->>'key';
    if found then
      if prior is distinct from u then raise exception 'generation_producer_group_collision'; end if;
    else
      insert into ingestion_generation_evidence.unit_declarations values(c.document_id,c.generation_id,u->'id'->>'family',u->'id'->>'key',u->>'groupKey',u);
    end if;
  end loop;
  for g in select value from jsonb_array_elements(p_declarations->'groups') loop
    if g->'declaration'->'population'->>'tag'='known' then
      select coalesce(jsonb_agg(declaration->'id' order by family,unit_key),'[]'::jsonb) into actual from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family=g->>'family' and group_key=g->>'groupKey';
      select coalesce(jsonb_agg(value order by value->>'family',value->>'key'),'[]'::jsonb) into expected from jsonb_array_elements(g->'declaration'->'population'->'expectedUnits');
      if actual is distinct from expected then raise exception 'generation_unit_population_mismatch'; end if;
    end if;
  end loop;
  select count(*) into n from ingestion_generation_evidence.producer_declarations where document_id=c.document_id and generation_id=c.generation_id;
  if n=19 and c.expected_inventory_digest is null then
    select 'sha256:'||encode(extensions.digest(convert_to(jsonb_build_object('sourceExpectationDigest',c.source_expectation_digest,
      'groups',(select coalesce(jsonb_agg(jsonb_build_object('family',family,'groupKey',group_key,'declaration',declaration) order by family,group_key),'[]'::jsonb) from ingestion_generation_evidence.producer_declarations where document_id=c.document_id and generation_id=c.generation_id),
      'units',(select coalesce(jsonb_agg(declaration order by family,unit_key),'[]'::jsonb) from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id))::text,'UTF8'),'sha256'),'hex') into dg;
    update ingestion_generation_evidence.candidates set expected_inventory_digest=dg where document_id=c.document_id and generation_id=c.generation_id;
  end if;
end $$;

-- selected function ingestion_generation_evidence.guard_page_mode
create function ingestion_generation_evidence.guard_page_mode() returns trigger
language plpgsql set search_path='' as $$ begin
  if (tg_op='INSERT' and new.page_storage_mode<>'legacy_unqualified') or (tg_op='UPDATE' and new.page_storage_mode is distinct from old.page_storage_mode) then
    if current_user<>'postgres' or current_setting('psychsift.page_commit_owner',true) is distinct from new.id::text then raise exception 'page_storage_mode_owner_required'; end if;
  end if;
  return new;
end $$;

-- selected function public.lock_ingestion_document_authority
-- Pre-lock lookups only choose the source lock. Recheck the route after locking the document.
create or replace function public.lock_ingestion_document_authority(p_document_id uuid, p_try boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text; v_version_id uuid; v_document public.documents%rowtype;
  v_version public.public_source_versions%rowtype; v_event public.public_source_activation_events%rowtype;
  v_policy public.public_source_policy_entries%rowtype;
  v_attempt public.public_source_upload_attempts%rowtype;
  v_digest text; v_metadata jsonb;
begin
  select v.id, v.source_catalogue_key into v_version_id, v_key
  from public.public_source_versions v where v.staging_document_id = p_document_id;
  if v_key is null then
    select d.metadata->>'source_catalogue_key' into v_key from public.documents d where d.id = p_document_id;
  end if;
  if v_key is not null then
    if p_try then
      if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0)) then return null; end if;
    else
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
    end if;
    -- Match current governance writers: advisory, latest event, document, version.
    -- NOWAIT preserves the latest-event identity; SKIP LOCKED here could select an older event.
    if p_try then
      select * into v_event from public.public_source_activation_events
        where source_catalogue_key = v_key order by activation_sequence desc limit 1 for update nowait;
    else
      select * into v_event from public.public_source_activation_events
        where source_catalogue_key = v_key order by activation_sequence desc limit 1 for update;
    end if;
    if not found then return null; end if;
  end if;
  if p_try then
    select * into v_document from public.documents where id = p_document_id for update skip locked;
  else
    select * into v_document from public.documents where id = p_document_id for update;
  end if;
  if not found then return null; end if;
  v_metadata := v_document.metadata;
  if jsonb_typeof(v_metadata) is distinct from 'object' then return null; end if;
  if v_metadata->>'source_catalogue_key' is distinct from v_key
    or exists (select 1 from public.public_source_versions v where v.staging_document_id = p_document_id and v.id is distinct from v_version_id)
    then return null; end if;
  if v_key is not null then
    if p_try then
      select * into v_version from public.public_source_versions where id = v_version_id for update nowait;
    else
      select * into v_version from public.public_source_versions where id = v_version_id for update;
    end if;
    if not found or v_version.staging_document_id is distinct from p_document_id
      or v_version.source_catalogue_key is distinct from v_key
      or v_metadata->>'public_source_version_id' is distinct from v_version.id::text then return null; end if;
    -- Finalization uses this same upload-attempt lock after the version lock.
    if p_try then
      select * into v_attempt from public.public_source_upload_attempts
        where id = v_version.finalized_upload_attempt_id for update nowait;
    else
      select * into v_attempt from public.public_source_upload_attempts
        where id = v_version.finalized_upload_attempt_id for update;
    end if;
    if not found or v_attempt.state is distinct from 'finalized'
      or v_version.current_upload_attempt_id is distinct from v_attempt.id
      or v_attempt.version_id is distinct from v_version.id
      or v_attempt.claim_token is distinct from v_version.upload_lease_token
      or v_attempt.claim_expires_at is distinct from v_version.upload_lease_expires_at
      or v_attempt.storage_bucket is distinct from v_version.storage_bucket
      or v_attempt.storage_path is distinct from v_version.reserved_storage_path then return null; end if;
    -- The existing control plane owns stewardship, latest activation, lifecycle,
    -- policy/content metadata and raw-response identity checks. Its locks are reentrant.
    begin
      perform public.assert_public_source_document_governance(p_document_id);
    exception when raise_exception then
      return null;
    end;
    select * into v_policy from public.public_source_policy_entries
      where source_catalogue_key = v_key;
    if not found or v_policy.policy_version is distinct from v_version.source_policy_version
      or v_policy.policy_digest is distinct from v_version.source_policy_digest
      or v_policy.lifecycle is distinct from 'active'
      or v_policy.content_mode is distinct from 'indexed_content'
      or v_policy.exact_document_licence is distinct from 'public_index_permitted'
      or v_event.policy_version is distinct from v_version.source_policy_version
      or v_version.intended_disposition is distinct from 'shadow'
      or v_version.upload_state is distinct from 'finalized'
      or v_version.reserved_document_id is distinct from p_document_id
      or v_version.reserved_storage_path is distinct from v_document.storage_path
      then return null; end if;
    -- Bind the current immutable control-plane identity and mutable authority.
    -- Document progress/enrichment metadata is deliberately outside this digest.
    v_digest := 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
      'version', to_jsonb(v_version), 'event', to_jsonb(v_event), 'policy', to_jsonb(v_policy),
      'upload_attempt', to_jsonb(v_attempt),
      'document', jsonb_build_object('id',v_document.id,'owner',v_document.owner_id,
        'source',v_document.source_path,'storage',v_document.storage_path,'file',v_document.file_name,
        'file_type',v_document.file_type,'file_size',v_document.file_size,'content_hash',v_document.content_hash),
      'source_metadata', (select jsonb_object_agg(entry.key,entry.value) from jsonb_each(v_metadata) entry
        where entry.key = any(array['corpus_scope','source_kind','source_catalogue_key','source_policy_version',
          'source_policy_digest','public_source_activation_event_id','public_source_activation_sequence',
          'public_source_version_id','public_source_steward_id','content_mode','licence_policy','canonical_url',
          'exact_version_url','version','content_hash','raw_response_hash','raw_response_byte_count',
          'acquisition_disposition','public_source_storage_bucket']))
    )::text, 'UTF8'), 'sha256'), 'hex');
  else
    -- Any public-source marker forbids silently entering the non-catalogue branch.
    if v_metadata ?| array['source_catalogue_key','source_policy_version','source_policy_digest','source_activation_event_id',
      'source_canonical_url','source_exact_url','source_exact_version','source_content_hash',
      'licence_evidence_digest','public_source_lifecycle','public_source_version_id',
      'public_source_activation_event_id','public_source_activation_sequence','public_source_steward_id',
      'public_source_storage_bucket','acquisition_disposition']
      or v_metadata->>'corpus_scope' = 'australian_public' then return null; end if;
    -- Trusted admission emits both permissions. A digest alone does not authorize
    -- provider work: missing, malformed, forbidden or conflicting values fail closed.
    -- Untagged legacy documents retain their existing eligibility semantics.
    if (v_metadata ?| array['admission_event_id','admission_policy_version','provider_processing']
        or (v_metadata->'authority') ? 'providerProcessing')
      and (v_metadata->'provider_processing' is distinct from '"permitted"'::jsonb
        or v_metadata#>'{authority,providerProcessing}' is distinct from '"permitted"'::jsonb)
      then return null; end if;
    v_digest := 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
      'owner', v_document.owner_id, 'source', v_document.source_path, 'storage', v_document.storage_path,
      'file', v_document.file_name, 'file_type', v_document.file_type, 'file_size', v_document.file_size,
      'content_hash', v_document.content_hash, 'corpus_scope', v_metadata->'corpus_scope',
      'content_mode', v_metadata->'content_mode', 'licence_policy', v_metadata->'licence_policy',
      'source_policy_checked', v_metadata->'source_policy_checked', 'content_identity_verdict', v_metadata->'content_identity_verdict',
      'content_identity_hash', v_metadata->'content_identity_hash', 'content_identity_verdict_version', v_metadata->'content_identity_verdict_version',
      'canonical_storage_path', v_metadata->'canonical_storage_path', 'public_corpus', v_metadata->'public_corpus',
      'admission_event_id', v_metadata->'admission_event_id', 'admission_policy_version', v_metadata->'admission_policy_version',
      'authority', v_metadata->'authority', 'source_role', v_metadata->'source_role', 'authority_basis', v_metadata->'authority_basis',
      'rights_evidence_ref', v_metadata->'rights_evidence_ref', 'provider_processing', v_metadata->'provider_processing',
      'purpose', v_metadata->'purpose', 'supported_features', v_metadata->'supported_features'
    )::text, 'UTF8'), 'sha256'), 'hex');
  end if;
  return jsonb_build_object('document', to_jsonb(v_document), 'authority_digest', v_digest);
exception when lock_not_available then
  -- A claim never waits on a busy authority row; a later bounded poll may retry.
  return null;
end $$;

-- selected function public.assert_current_ingestion_attempt
create or replace function public.assert_current_ingestion_attempt(p_fence jsonb, p_target_generation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_job jsonb; v_generation uuid; v_id uuid; v_document_id uuid;
begin
  if jsonb_typeof(p_fence) is distinct from 'object' or not (p_fence ?& array[
    'job_kind','job_id','document_id','worker_id','lease_token','expected_generation_id','authority_digest'])
    or coalesce(p_fence->>'job_kind','') not in ('node','indexing_v3')
    or jsonb_typeof(p_fence->'job_id') is distinct from 'string' or jsonb_typeof(p_fence->'document_id') is distinct from 'string'
    or jsonb_typeof(p_fence->'lease_token') is distinct from 'string'
    or (p_fence->'expected_generation_id' <> 'null'::jsonb and jsonb_typeof(p_fence->'expected_generation_id') is distinct from 'string')
    or (p_fence->>'job_kind'='indexing_v3' and p_fence->>'expected_generation_id' is null)
    or coalesce(btrim(p_fence->>'worker_id'),'') = ''
    or coalesce(p_fence->>'authority_digest','') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_fence->>'lease_token','') !~ '^[0-9a-f-]{36}$' then
    raise exception 'ingestion_attempt_required';
  end if;
  v_id := (p_fence->>'job_id')::uuid; v_document_id := (p_fence->>'document_id')::uuid;
  v_generation := (p_fence->>'expected_generation_id')::uuid;
  v_locked := public.lock_ingestion_document_authority(v_document_id, false);
  if v_locked is null then return null; end if;
  perform 1 from public.ingestion_jobs where document_id = v_document_id order by id for update;
  perform 1 from public.indexing_v3_agent_jobs where document_id = v_document_id order by id for update;
  if p_fence->>'job_kind' = 'node' then
    select to_jsonb(j) into v_job from public.ingestion_jobs j where j.id = v_id;
  elsif p_fence->>'job_kind' = 'indexing_v3' then
    select to_jsonb(j) into v_job from public.indexing_v3_agent_jobs j where j.id = v_id;
  end if;
  if v_job is null or v_job->>'document_id' is distinct from v_document_id::text
    or v_job->>'locked_by' is distinct from p_fence->>'worker_id'
    or v_job->>'lease_token' is distinct from p_fence->>'lease_token'
    or v_job->>'status' is distinct from 'processing'
    or (v_job->>'lease_expires_at')::timestamptz <= pg_catalog.clock_timestamp()
    or v_job->>'lease_expires_at' is null
    or (v_job->>'lease_expected_generation_id')::uuid is distinct from v_generation
    or (v_locked->'document'->>'index_generation_id')::uuid is distinct from v_generation
    or (v_generation is null and (v_locked->'document'->'metadata' ? 'index_generation_id'))
    or v_locked->>'authority_digest' is distinct from p_fence->>'authority_digest'
    or v_job->>'lease_authority_digest' is distinct from p_fence->>'authority_digest'
    or (p_target_generation is not null and (v_job->>'lease_write_generation_id')::uuid is distinct from p_target_generation)
    then return null; end if;
  return v_locked || jsonb_build_object('job', v_job);
end $$;

-- selected function ingestion_generation_evidence.immutable
-- Preserve the existing inventory-finalization exception; permit only the new
-- independently supplied triplet's first registration under a current node fence.
create or replace function ingestion_generation_evidence.immutable() returns trigger
language plpgsql set search_path='' as $$ declare worker text; attempt jsonb; begin
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

-- selected function ingestion_generation_evidence.lock_candidate
create function ingestion_generation_evidence.lock_candidate(p_fence jsonb,p_generation uuid)
returns ingestion_generation_evidence.candidates language plpgsql security definer set search_path='' as $$
declare c ingestion_generation_evidence.candidates; a jsonb;
begin
  a:=public.assert_current_ingestion_attempt(p_fence,p_generation);
  if a is null then return null; end if;
  select * into c from ingestion_generation_evidence.candidates
    where document_id=(p_fence->>'document_id')::uuid and generation_id=p_generation for update;
  if not found then raise exception 'generation_evidence_registration_required'; end if;
  if p_fence->>'job_kind'<>'node' or c.job_id is distinct from (p_fence->>'job_id')::uuid
    or c.first_lease_token is distinct from (p_fence->>'lease_token')::uuid
    or c.authority_digest is distinct from p_fence->>'authority_digest'
    or c.predecessor_generation_id is distinct from (p_fence->>'expected_generation_id')::uuid
    or c.source_sha256 is distinct from 'sha256:'|| (a->'document'->>'content_hash')
    or c.source_byte_length is distinct from (a->'document'->>'file_size')::bigint
    then return null; end if;
  return c;
end $$;

-- selected function public.assert_ingestion_artifact_sources
-- Fixed source-membership validation, internal only; never accepts a table or SQL fragment.
create function public.assert_ingestion_artifact_sources(p_row jsonb, p_document_id uuid, p_generation uuid, p_section_generation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id text; v_key text; v_ids jsonb;
begin
  if jsonb_typeof(p_row) is distinct from 'object' then raise exception 'invalid_ingestion_artifact'; end if;
  foreach v_key in array array['source_chunk_ids','chunk_ids','source_image_ids','image_ids'] loop
    v_ids:=coalesce(nullif(p_row->v_key,'null'::jsonb),'[]'::jsonb);
    if jsonb_typeof(v_ids) is distinct from 'array' or jsonb_array_length(v_ids)>100000 then raise exception 'invalid_ingestion_source_membership'; end if;
    for v_id in select jsonb_array_elements_text(v_ids) loop
      if v_id is null then raise exception 'invalid_ingestion_source_membership'; end if;
      if v_key in ('source_chunk_ids','chunk_ids') then
        if not exists(select 1 from public.document_chunks where id=v_id::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_chunk_membership_mismatch'; end if;
      else
        if not exists(select 1 from public.document_images where id=v_id::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_image_membership_mismatch'; end if;
      end if;
    end loop;
  end loop;
  if p_row->>'source_chunk_id' is not null and not exists(select 1 from public.document_chunks where id=(p_row->>'source_chunk_id')::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_chunk_membership_mismatch'; end if;
  if p_row->>'source_image_id' is not null and not exists(select 1 from public.document_images where id=(p_row->>'source_image_id')::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_image_membership_mismatch'; end if;
  if p_row->'metadata'->>'source_chunk_id' is not null and not exists(select 1 from public.document_chunks where id=(p_row->'metadata'->>'source_chunk_id')::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_chunk_membership_mismatch'; end if;
  if p_row->'metadata'->>'source_image_id' is not null and not exists(select 1 from public.document_images where id=(p_row->'metadata'->>'source_image_id')::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_image_membership_mismatch'; end if;
  if p_row->>'section_id' is not null and not exists(select 1 from public.document_sections where id=(p_row->>'section_id')::uuid and document_id=p_document_id and index_generation_id=coalesce(p_section_generation,p_generation)) then raise exception 'ingestion_section_membership_mismatch'; end if;
end $$;

-- selected function ingestion_generation_evidence.retain
create or replace function ingestion_generation_evidence.retain(c ingestion_generation_evidence.candidates,p_artifacts jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare a jsonb; u jsonb; b bytea; h text; prior ingestion_generation_evidence.retained_artifacts; page jsonb; descriptor jsonb; binary_ref ingestion_generation_evidence.retained_artifacts; descriptor_value jsonb; claimed_job public.ingestion_jobs%rowtype; quality_refs jsonb; quality_deps jsonb; quality_observation jsonb; quality_partition jsonb; quality_key text; quality_page_count bigint; quality_text_bytes bigint; quality_image_count bigint; quality_true bigint; quality_false bigint; quality_unknown bigint;
begin
  if jsonb_typeof(p_artifacts) is distinct from 'array' then raise exception 'invalid_generation_artifacts'; end if;
  for a in select value from jsonb_array_elements(p_artifacts) loop
    if not ingestion_generation_evidence.keys(a,array['unitId','groupKey','representation','bytesHex','sha256','byteLength','locator'])
      or not ingestion_generation_evidence.keys(a->'unitId',array['family','key']) or jsonb_typeof(a->'bytesHex') is distinct from 'string' or coalesce(a->>'bytesHex','') !~ '^([0-9a-f]{2})*$'
      or jsonb_typeof(a->'byteLength') is distinct from 'number' or coalesce(a->>'byteLength','') !~ '^(0|[1-9][0-9]*)$'
      or coalesce(a->>'locator','')='' then raise exception 'invalid_generation_artifact'; end if;
    select declaration into u from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family=a->'unitId'->>'family' and unit_key=a->'unitId'->>'key';
    if not found or u->>'groupKey' is distinct from a->>'groupKey' or u->>'representation' is distinct from a->>'representation' then raise exception 'generation_artifact_undeclared'; end if;
    b:=decode(a->>'bytesHex','hex');h:='sha256:'||encode(extensions.digest(b,'sha256'),'hex');
    if h is distinct from a->>'sha256' or (a->>'byteLength')::bigint is distinct from octet_length(b)::bigint then raise exception 'retained_artifact_bytes_mismatch'; end if;
    if a->>'representation'='original_binary' and (h is distinct from c.source_sha256 or octet_length(b)::bigint is distinct from c.source_byte_length or a->'unitId'->>'family'<>'private_objects' or a->'unitId'->>'key'<>'original-source') then raise exception 'retained_original_source_mismatch'; end if;
    if a->>'representation'='source_expectation_witness' and (c.source_expectation->>'tag'<>'known' or h is distinct from c.source_expectation->'witness'->>'sha256') then raise exception 'independent_original_witness_mismatch'; end if;
    if a->'unitId'->>'family'='quality' then
      if a->'unitId'->>'key' is distinct from 'singleton' or a->>'groupKey' is distinct from 'worker_core'
        or a->>'representation' is distinct from 'provenance_json' or a->>'locator' is distinct from 'prerequisite_quality:extraction_retention'
        or u->>'qualification' is distinct from 'derived_unverified' then raise exception 'quality_diagnostic_identity_mismatch'; end if;
      begin page:=convert_from(b,'UTF8')::jsonb; exception when others then raise exception 'quality_diagnostic_identity_mismatch'; end;
      if not ingestion_generation_evidence.keys(page,array['version','stage','qualification','documentId','generationId','sourceSha256','sourceByteLength','sourceExpectationDigest','references','pageObservations','observations','downstream'])
        or page->>'version' is distinct from 'ingestion-prerequisite-quality-v1' or page->>'stage' is distinct from 'extraction_retention'
        or page->>'qualification' is distinct from 'derived_unverified' or page->>'documentId' is distinct from c.document_id::text
        or page->>'generationId' is distinct from c.generation_id::text or page->>'sourceSha256' is distinct from c.source_sha256
        or page->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length) or page->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
        or jsonb_typeof(page->'references') is distinct from 'array' or jsonb_typeof(page->'pageObservations') is distinct from 'array'
        or not ingestion_generation_evidence.keys(page->'observations',array['pageCount','extractedUtf8ByteLength','capturedImageCount','ocrUsed','needsOcr','warnings'])
        or page->'downstream' is distinct from '{"status":"unavailable","reason":"downstream_stages_not_executed","qualityScore":null,"extractionQuality":null}'::jsonb
        then raise exception 'quality_diagnostic_identity_mismatch'; end if;
      select coalesce(jsonb_agg(jsonb_build_object('unitId',jsonb_build_object('family',family,'key',unit_key),'representation',representation,'sha256',sha256,'byteLength',byte_length) order by family,unit_key),'[]'::jsonb)
        into quality_refs from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and
          ((family='pages' and representation='page_projection') or
           (family='private_objects' and (unit_key='original-source' or unit_key ~ '^page:[1-9][0-9]*:(extracted|persisted|original-provenance|persisted-provenance)$' or unit_key ~ '^image:[1-9][0-9]*:(binary|provenance)$')));
      select coalesce(jsonb_agg(ref.value order by ref.value->'unitId'->>'family',ref.value->'unitId'->>'key'),'[]'::jsonb) into descriptor from jsonb_array_elements(page->'references') ref;
      select coalesce(jsonb_agg(ref.value->'unitId' order by ref.value->'unitId'->>'family',ref.value->'unitId'->>'key'),'[]'::jsonb) into quality_deps from jsonb_array_elements(quality_refs) ref;
      select coalesce(jsonb_agg(dep.value order by dep.value->>'family',dep.value->>'key'),'[]'::jsonb) into descriptor_value from jsonb_array_elements(u->'dependencies') dep;
      if descriptor is distinct from quality_refs or descriptor_value is distinct from quality_deps or jsonb_array_length(quality_refs)=0
        then raise exception 'quality_diagnostic_identity_mismatch'; end if;
      select count(*) filter(where family='pages' and representation='page_projection'),coalesce(sum(byte_length) filter(where representation='extracted_utf8'),0),count(*) filter(where representation='image_binary')
        into quality_page_count,quality_text_bytes,quality_image_count from ingestion_generation_evidence.retained_artifacts
        where document_id=c.document_id and generation_id=c.generation_id and ((family='pages' and representation='page_projection') or (family='private_objects' and (representation='extracted_utf8' or representation='image_binary')));
      if quality_page_count<1 or page->'observations'->'pageCount' is distinct from to_jsonb(quality_page_count)
        or page->'observations'->'extractedUtf8ByteLength' is distinct from to_jsonb(quality_text_bytes)
        or page->'observations'->'capturedImageCount' is distinct from to_jsonb(quality_image_count)
        or jsonb_array_length(page->'pageObservations')<>quality_page_count then raise exception 'quality_diagnostic_identity_mismatch'; end if;
      for quality_observation in select obs.value from jsonb_array_elements(page->'pageObservations') obs loop
        if not ingestion_generation_evidence.keys(quality_observation,array['pageNumber','ocrUsed','needsOcr'])
          or jsonb_typeof(quality_observation->'pageNumber') is distinct from 'number' or coalesce(quality_observation->>'pageNumber','') !~ '^[1-9][0-9]*$'
          or quality_observation->'ocrUsed' not in ('true'::jsonb,'false'::jsonb,'null'::jsonb)
          or quality_observation->'needsOcr' not in ('true'::jsonb,'false'::jsonb,'null'::jsonb)
          or not exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='pages' and unit_key=quality_observation->>'pageNumber' and representation='page_projection')
          then raise exception 'quality_diagnostic_identity_mismatch'; end if;
      end loop;
      if exists(select 1 from jsonb_array_elements(page->'pageObservations') obs group by obs.value->'pageNumber' having count(*)>1) then raise exception 'quality_diagnostic_identity_mismatch'; end if;
      -- Flags are producer-derived observations, never database certification of native/OCR fidelity.
      foreach quality_key in array array['ocrUsed','needsOcr'] loop
        select count(*) filter(where obs.value->quality_key='true'::jsonb),count(*) filter(where obs.value->quality_key='false'::jsonb),count(*) filter(where obs.value->quality_key='null'::jsonb)
          into quality_true,quality_false,quality_unknown from jsonb_array_elements(page->'pageObservations') obs;
        quality_partition:=jsonb_build_object('true',quality_true,'false',quality_false,'unknown',quality_unknown);
        if page->'observations'->quality_key is distinct from quality_partition then raise exception 'quality_diagnostic_identity_mismatch'; end if;
      end loop;
      quality_observation:=page->'observations'->'warnings';
      if not ingestion_generation_evidence.keys(quality_observation,array['known','entries']) or jsonb_typeof(quality_observation->'known') is distinct from 'boolean'
        or jsonb_typeof(quality_observation->'entries') is distinct from 'array' then raise exception 'quality_diagnostic_identity_mismatch'; end if;
      if quality_observation->'known'='false'::jsonb and jsonb_array_length(quality_observation->'entries')<>0 then raise exception 'quality_diagnostic_identity_mismatch'; end if;
      for descriptor_value in select entry.value from jsonb_array_elements(quality_observation->'entries') entry loop
        if not ingestion_generation_evidence.keys(descriptor_value,array['sha256','byteLength']) or jsonb_typeof(descriptor_value->'sha256') is distinct from 'string'
          or coalesce(descriptor_value->>'sha256','') !~ '^sha256:[0-9a-f]{64}$' or jsonb_typeof(descriptor_value->'byteLength') is distinct from 'number'
          or coalesce(descriptor_value->>'byteLength','') !~ '^(0|[1-9][0-9]*)$' then raise exception 'quality_diagnostic_identity_mismatch'; end if;
        if (descriptor_value->>'byteLength')::numeric>9007199254740991 then raise exception 'quality_diagnostic_identity_mismatch'; end if;
      end loop;
    end if;
    if a->'unitId'->>'family'='attempt_control' then
      if a->'unitId'->>'key'='preseal_checkpoint' then raise exception 'attempt_control_preseal_unavailable'; end if;
      if a->'unitId'->>'key' is distinct from 'claim_checkpoint' or a->>'groupKey' is distinct from 'control'
        or a->>'representation' is distinct from 'provenance_json' or a->>'locator' is distinct from 'ingestion_attempt:claim'
        or u->>'qualification' is distinct from 'derived_unverified' then raise exception 'attempt_control_claim_identity_mismatch'; end if;
      begin page:=convert_from(b,'UTF8')::jsonb; exception when others then raise exception 'attempt_control_claim_identity_mismatch'; end;
      select * into claimed_job from public.ingestion_jobs where id=c.job_id;
      if not found then raise exception 'attempt_control_claim_identity_mismatch'; end if;
      if not ingestion_generation_evidence.keys(page,array['version','phase','qualification','documentId','generationId','jobId','workerId','firstLeaseToken','attemptNumber','batchId','authorityDigest','predecessorGenerationId','sourceSha256','sourceByteLength','sourceExpectationDigest'])
        or page->>'version' is distinct from 'ingestion-attempt-control-v1' or page->>'phase' is distinct from 'claim'
        or page->>'qualification' is distinct from 'derived_unverified' or page->>'documentId' is distinct from c.document_id::text
        or page->>'generationId' is distinct from c.generation_id::text or page->>'jobId' is distinct from c.job_id::text
        or jsonb_typeof(page->'workerId') is distinct from 'string' or page->>'workerId' is distinct from claimed_job.locked_by
        or page->>'firstLeaseToken' is distinct from c.first_lease_token::text or claimed_job.attempt_count<1
        or page->'attemptNumber' is distinct from to_jsonb(claimed_job.attempt_count)
        or page->'batchId' is distinct from coalesce(to_jsonb(claimed_job.batch_id),'null'::jsonb)
        or page->>'authorityDigest' is distinct from c.authority_digest
        or page->'predecessorGenerationId' is distinct from coalesce(to_jsonb(c.predecessor_generation_id),'null'::jsonb)
        or page->>'sourceSha256' is distinct from c.source_sha256 or page->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
        or page->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
        or not exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source' and representation='original_binary' and sha256=c.source_sha256 and byte_length=c.source_byte_length)
        then raise exception 'attempt_control_claim_identity_mismatch'; end if;
    end if;
    if a->>'representation'='page_projection' then
      page:=convert_from(b,'UTF8')::jsonb;
      if not (ingestion_generation_evidence.keys(page,array['page_number','text','ocr_used','metadata']) or ingestion_generation_evidence.keys(page,array['document_id','page_number','text','ocr_used','metadata'])) or (page ? 'document_id' and page->>'document_id' is distinct from c.document_id::text)
        or page->>'page_number' is distinct from a->'unitId'->>'key' or a->'unitId'->>'family'<>'pages'
        or jsonb_typeof(page->'text') is distinct from 'string' or jsonb_typeof(page->'ocr_used') is distinct from 'boolean' or jsonb_typeof(page->'metadata') is distinct from 'object' then raise exception 'retained_page_identity_mismatch'; end if;
    end if;
    if a->>'representation' in ('image_binary','image_provenance') then
      if a->'unitId'->>'family' is distinct from 'private_objects' or a->>'groupKey' is distinct from 'private_objects' or u->>'qualification' is distinct from 'derived_unverified'
        or coalesce(a->'unitId'->>'key','') !~ (case when a->>'representation'='image_binary' then '^image:[1-9][0-9]*:binary$' else '^image:[1-9][0-9]*:provenance$' end)
        or a->>'locator' is distinct from 'extracted_image:'||split_part(a->'unitId'->>'key',':',2)||(case when a->>'representation'='image_provenance' then ':provenance' else '' end)
        or octet_length(b)=0 then raise exception 'retained_image_identity_mismatch'; end if;
      if a->>'representation'='image_provenance' then
        begin page:=convert_from(b,'UTF8')::jsonb; exception when others then raise exception 'retained_image_identity_mismatch'; end;
        if not ingestion_generation_evidence.keys(page,array['version','documentId','generationId','sourceSha256','placementId','qualification','descriptor','binary'])
          or page->'version' is distinct from '1'::jsonb or page->>'documentId' is distinct from c.document_id::text or page->>'generationId' is distinct from c.generation_id::text
          or page->>'sourceSha256' is distinct from c.source_sha256 or page->>'placementId' is distinct from split_part(a->'unitId'->>'key',':',2) or page->>'qualification' is distinct from 'derived_unverified'
          or not ingestion_generation_evidence.keys(page->'binary',array['unitId','sha256','byteLength'])
          or page->'binary'->'unitId' is distinct from jsonb_build_object('family','private_objects','key','image:'||(page->>'placementId')||':binary') then raise exception 'retained_image_identity_mismatch'; end if;
        select * into binary_ref from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='image:'||(page->>'placementId')||':binary';
        if not found or binary_ref.representation<>'image_binary' or page->'binary'->>'sha256' is distinct from binary_ref.sha256 or page->'binary'->'byteLength' is distinct from to_jsonb(binary_ref.byte_length) then raise exception 'retained_image_identity_mismatch'; end if;
        descriptor:=page->'descriptor';
        if jsonb_typeof(descriptor) is distinct from 'object' then raise exception 'retained_image_identity_mismatch'; end if;
        if not descriptor ?& array['pageNumber','mimeType'] or exists(select 1 from jsonb_object_keys(descriptor) k where k<>all(array['pageNumber','mimeType','bbox','width','height','sourceKind','metadata']))
          or jsonb_typeof(descriptor->'mimeType') is distinct from 'string' or coalesce(descriptor->>'mimeType','')='' then raise exception 'retained_image_identity_mismatch'; end if;
        if descriptor->'pageNumber' is distinct from 'null'::jsonb then
          if jsonb_typeof(descriptor->'pageNumber') is distinct from 'number' or coalesce(descriptor->>'pageNumber','') !~ '^[1-9][0-9]*$' then raise exception 'retained_image_identity_mismatch'; end if;
          if (descriptor->>'pageNumber')::numeric>9007199254740991 or not exists(select 1 from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='page:'||(descriptor->>'pageNumber')||':extracted') then raise exception 'retained_image_identity_mismatch'; end if;
        end if;
        foreach descriptor_value in array array[descriptor->'width',descriptor->'height'] loop
          if descriptor_value is not null and descriptor_value is distinct from 'null'::jsonb then
            if jsonb_typeof(descriptor_value) is distinct from 'number' or coalesce(descriptor_value#>>'{}','') !~ '^[1-9][0-9]*$' then raise exception 'retained_image_identity_mismatch'; end if;
            if (descriptor_value#>>'{}')::numeric>9007199254740991 then raise exception 'retained_image_identity_mismatch'; end if;
          end if;
        end loop;
        if descriptor ? 'bbox' and descriptor->'bbox' is distinct from 'null'::jsonb then
          if jsonb_typeof(descriptor->'bbox') is distinct from 'array' then raise exception 'retained_image_identity_mismatch'; end if;
          if jsonb_array_length(descriptor->'bbox')<>4 then raise exception 'retained_image_identity_mismatch'; end if;
          for descriptor_value in select * from jsonb_array_elements(descriptor->'bbox') loop
            if jsonb_typeof(descriptor_value) is distinct from 'number' then raise exception 'retained_image_identity_mismatch'; end if;
            if abs((descriptor_value#>>'{}')::numeric)>1.7976931348623157e308 then raise exception 'retained_image_identity_mismatch'; end if;
          end loop;
        end if;
        if (descriptor ? 'sourceKind' and (jsonb_typeof(descriptor->'sourceKind') is distinct from 'string' or coalesce(descriptor->>'sourceKind','') not in ('embedded','table_crop','diagram_crop','page_region','fallback','cover_page')))
          or (descriptor ? 'metadata' and jsonb_typeof(descriptor->'metadata') is distinct from 'object') then raise exception 'retained_image_identity_mismatch'; end if;
      end if;
    end if;
    select * into prior from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family=a->'unitId'->>'family' and unit_key=a->'unitId'->>'key';
    if found then
      if prior.group_key is distinct from a->>'groupKey' or prior.representation is distinct from a->>'representation' or prior.artifact_bytes is distinct from b or prior.locator is distinct from a->>'locator' then raise exception 'immutable_retained_artifact'; end if;
    else
      if a->'unitId'->>'family'='attempt_control' and not exists(select 1 from ingestion_generation_evidence.producer_declarations
        where document_id=c.document_id and generation_id=c.generation_id and family='attempt_control' and group_key='control'
          and declaration->'population'->'basis'->0->>'sha256'=h)
        then raise exception 'attempt_control_claim_identity_mismatch'; end if;
      insert into ingestion_generation_evidence.retained_artifacts values(c.document_id,c.generation_id,a->'unitId'->>'family',a->'unitId'->>'key',a->>'groupKey',a->>'representation',c.source_sha256,b,h,octet_length(b),a->>'locator');
    end if;
  end loop;
end $$;

-- selected function public.record_ingestion_generation_outcomes
create or replace function public.record_ingestion_generation_outcomes(p_fence jsonb,p_generation uuid,p_outcomes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c ingestion_generation_evidence.candidates; o jsonb; u jsonb; prior jsonb;
begin
  c:=ingestion_generation_evidence.lock_candidate(p_fence,p_generation);
  if c is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if jsonb_typeof(p_outcomes) is distinct from 'array' then raise exception 'invalid_generation_outcomes'; end if;
  for o in select value from jsonb_array_elements(p_outcomes) loop
    if not ingestion_generation_evidence.keys(o,array['unitId','groupKey','disposition','artifactSha256','limitation']) or not ingestion_generation_evidence.keys(o->'unitId',array['family','key'])
      or jsonb_typeof(o->'disposition') is distinct from 'string' or coalesce(o->>'disposition','') not in ('retained','excluded','failed','skipped') then raise exception 'invalid_generation_outcome'; end if;
    if o->'unitId'->>'family'='attempt_control' and o->'unitId'->>'key'='preseal_checkpoint'
      then raise exception 'attempt_control_preseal_unavailable'; end if;
    select declaration into u from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family=o->'unitId'->>'family' and unit_key=o->'unitId'->>'key';
    if not found or u->>'groupKey' is distinct from o->>'groupKey' then raise exception 'generation_outcome_undeclared'; end if;
    if o->>'disposition'='retained' then
      if o->'limitation' is distinct from 'null'::jsonb or not exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family=o->'unitId'->>'family' and unit_key=o->'unitId'->>'key' and group_key=o->>'groupKey' and sha256=o->>'artifactSha256') then raise exception 'generation_retained_outcome_mismatch'; end if;
    elsif o->'artifactSha256' is distinct from 'null'::jsonb or not ingestion_generation_evidence.keys(o->'limitation',array['code','scope','capability']) or coalesce(o->'limitation'->>'scope','')='' or jsonb_typeof(o->'limitation'->'code') is distinct from 'string' or coalesce(o->'limitation'->>'code','') not in ('required_fidelity_unassessed','producer_unavailable','producer_failed','producer_skipped','dependency_unknown') or jsonb_typeof(o->'limitation'->'capability') is distinct from 'string' or coalesce(o->'limitation'->>'capability','') not in ('source_fidelity','native_mapping','optional_derivative','source_inventory') then raise exception 'generation_failed_outcome_limitation_required'; end if;
    select outcome into prior from ingestion_generation_evidence.outcomes where document_id=c.document_id and generation_id=c.generation_id and family=o->'unitId'->>'family' and unit_key=o->'unitId'->>'key';
    if found then
      if prior is distinct from o then raise exception 'immutable_generation_outcome'; end if;
    else insert into ingestion_generation_evidence.outcomes values(c.document_id,c.generation_id,o->'unitId'->>'family',o->'unitId'->>'key',o->>'groupKey',o); end if;
  end loop;
  return jsonb_build_object('ok',true);
end $$;

-- selected function ingestion_generation_evidence.persist_candidate_chunks
create or replace function ingestion_generation_evidence.persist_candidate_chunks(p_fence jsonb,p_generation uuid,p_chunks jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  c ingestion_generation_evidence.candidates;
  prepared ingestion_generation_evidence.retained_artifacts;
  prior_final ingestion_generation_evidence.retained_artifacts;
  witness ingestion_generation_evidence.retained_artifacts;
  actual public.document_chunks;
  private_row ingestion_generation_evidence.candidate_chunk_rows;
  expected public.document_chunks;
  u jsonb; f jsonb; body jsonb; r jsonb; ref jsonb; stored jsonb; expected_row jsonb;
  refs jsonb; outcome_result jsonb; artifact jsonb; bytes bytea; digest text; results jsonb:='[]'::jsonb;
  chunk_id uuid; prepared_key text; final_key text; total integer;
begin
  c:=ingestion_generation_evidence.lock_candidate(p_fence,p_generation);
  if c is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if jsonb_typeof(p_chunks) is distinct from 'array' then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
  if jsonb_array_length(p_chunks)>500
    or jsonb_array_length(p_chunks)=0 or c.source_expectation->>'tag' is distinct from 'known'
    then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
  select count(distinct value->>'id') into total from jsonb_array_elements(p_chunks);
  if total<>jsonb_array_length(p_chunks) or jsonb_array_length(p_chunks)<>(select count(distinct value->'chunk_index') from jsonb_array_elements(p_chunks)) then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
  for r in select value from jsonb_array_elements(p_chunks) loop
    if jsonb_typeof(r) is distinct from 'object'
      or coalesce(r->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or r->>'document_id' is distinct from c.document_id::text
      or r->>'index_generation_id' is distinct from c.generation_id::text
      or r->'image_ids' is distinct from '[]'::jsonb
      or jsonb_typeof(r->'embedding') is distinct from 'array'
      or not ingestion_generation_evidence.keys(r,array['id','document_id','page_number','chunk_index','section_heading','section_path','heading_level','parent_heading','anchor_id','content','retrieval_synopsis','content_hash','index_generation_id','token_estimate','image_ids','metadata','embedding'])
      or jsonb_typeof(r->'metadata') is distinct from 'object'
      or (r->'metadata') ?| array['ingestion_lease_token','ingestion_job_kind','ingestion_job_id']
      then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
    chunk_id:=(r->>'id')::uuid; prepared_key:=chunk_id::text||':prepared'; final_key:=chunk_id::text||':final';
    select declaration into u from ingestion_generation_evidence.unit_declarations
      where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=prepared_key;
    select declaration into f from ingestion_generation_evidence.unit_declarations
      where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=final_key;
    if u is null or f is null or u->>'groupKey' is distinct from 'worker_core' or f->>'groupKey' is distinct from 'worker_core'
      or u->'required' is distinct from 'true'::jsonb or f->'required' is distinct from 'true'::jsonb
      or u->>'representation' is distinct from 'provenance_json' or f->>'representation' is distinct from 'provenance_json'
      or u->>'qualification' is distinct from 'derived_unverified' or f->>'qualification' is distinct from 'derived_unverified'
      or u->'sourceEvidenceIds' is distinct from '[]'::jsonb or f->'sourceEvidenceIds' is distinct from '[]'::jsonb
      or f->'dependencies' is distinct from jsonb_build_array(jsonb_build_object('family','chunks','key',prepared_key))
      then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
    select * into prepared from ingestion_generation_evidence.retained_artifacts
      where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=prepared_key;
    if not found or prepared.group_key<>'worker_core' or prepared.representation<>'provenance_json'
      or prepared.source_sha256<>c.source_sha256 or prepared.locator<>'ingestion_chunk:'||prepared_key
      or prepared.byte_length<>octet_length(prepared.artifact_bytes)
      or prepared.sha256<>'sha256:'||encode(extensions.digest(prepared.artifact_bytes,'sha256'),'hex')
      then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
    body:=convert_from(prepared.artifact_bytes,'UTF8')::jsonb;
    if not ingestion_generation_evidence.keys(body,array['version','qualification','documentId','generationId','sourceSha256','sourceExpectationDigest','chunkId','chunkIndex','row','references'])
      or body->>'version' is distinct from 'ingestion-prepared-chunk-v1' or body->>'qualification' is distinct from 'derived_unverified'
      or body->>'documentId' is distinct from c.document_id::text or body->>'generationId' is distinct from c.generation_id::text
      or body->>'sourceSha256' is distinct from c.source_sha256 or body->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
      or body->>'chunkId' is distinct from chunk_id::text or body->'chunkIndex' is distinct from r->'chunk_index'
      or body->'row' is distinct from r-'embedding' or jsonb_typeof(body->'references') is distinct from 'array'
      then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
    if not exists(select 1 from ingestion_generation_evidence.outcomes o where o.document_id=c.document_id and o.generation_id=c.generation_id and o.family='chunks' and o.unit_key=prepared_key and o.outcome->>'disposition'='retained' and o.outcome->>'artifactSha256'=prepared.sha256) then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
    refs:=body->'references';
    if jsonb_array_length(refs)=0 or jsonb_array_length(refs)<>(select count(distinct value->'unitId') from jsonb_array_elements(refs))
      or not exists(select 1 from jsonb_array_elements(refs) x where x.value->'unitId'=jsonb_build_object('family','private_objects','key','original-source') and x.value->>'sha256'=c.source_sha256 and x.value->'byteLength'=to_jsonb(c.source_byte_length))
      or not exists(select 1 from jsonb_array_elements(refs) x where x.value->'unitId'=jsonb_build_object('family','private_objects','key','original-source-expectation-witness') and x.value->>'representation'='source_expectation_witness' and x.value->>'sha256'=c.source_expectation->'witness'->>'sha256')
      or not exists(select 1 from jsonb_array_elements(refs) x where x.value->'unitId'->>'family'='pages' and (r->'page_number'='null'::jsonb or x.value->'unitId'->>'key'=r->>'page_number'))
      or u->'dependencies' is distinct from (select jsonb_agg(value->'unitId' order by ord) from jsonb_array_elements(refs) with ordinality x(value,ord))
      then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
    for ref in select value from jsonb_array_elements(refs) loop
      if not ingestion_generation_evidence.keys(ref,array['unitId','sha256','byteLength','representation'])
        or not exists(select 1 from ingestion_generation_evidence.retained_artifacts a
          where a.document_id=c.document_id and a.generation_id=c.generation_id
            and a.family=ref->'unitId'->>'family' and a.unit_key=ref->'unitId'->>'key'
            and a.sha256=ref->>'sha256' and to_jsonb(a.byte_length)=ref->'byteLength'
            and a.representation=ref->>'representation' and a.source_sha256=c.source_sha256
            and a.sha256='sha256:'||encode(extensions.digest(a.artifact_bytes,'sha256'),'hex')
            and a.byte_length=octet_length(a.artifact_bytes))
        then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
    end loop;
    select * into witness from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source-expectation-witness';
    body:=convert_from(witness.artifact_bytes,'UTF8')::jsonb;
    if jsonb_typeof(body->'groups') is distinct from 'array' then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
    if body->>'version' is distinct from 'ingestion-original-applicability-v1' or body->>'sourceSha256' is distinct from c.source_sha256
      or body->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
      or not exists(select 1 from jsonb_array_elements(body->'groups') x where x.value->>'family'='images'
        and x.value->'population'->>'tag'='known' and x.value->'population'->'requirements'='[]'::jsonb
        and x.value->'population'->>'reason'='no_original_requirements_in_scope')
      then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(r,c.document_id,c.generation_id,null);
    expected:=jsonb_populate_record(null::public.document_chunks,r||jsonb_build_object('embedding',(r->'embedding')::text));
    expected_row:=to_jsonb(expected)-array['created_at','search_tsv','metadata','embedding'];
    -- Existing public candidates are not moved, hidden or adopted by this correction.
    if exists(select 1 from public.document_chunks where id=chunk_id
      or (document_id=c.document_id and index_generation_id=c.generation_id and chunk_index=expected.chunk_index)) then raise exception 'immutable_ingestion_chunk'; end if;
    if exists(select 1 from ingestion_generation_evidence.candidate_chunk_rows where document_id=c.document_id and index_generation_id=c.generation_id and chunk_index=expected.chunk_index and id<>chunk_id) then raise exception 'immutable_ingestion_chunk'; end if;
    select * into private_row from ingestion_generation_evidence.candidate_chunk_rows where id=chunk_id;
    if found then
      -- PRIVATE CHUNK REPLAY IDENTITY BEGIN
      if private_row.candidate_owner_id is distinct from (c.source_snapshot->>'owner_id')::uuid
        or private_row.candidate_job_id is distinct from c.job_id
        or private_row.candidate_lease_token is distinct from c.first_lease_token
        or private_row.candidate_authority_digest is distinct from c.authority_digest
        or private_row.candidate_source_sha256 is distinct from c.source_sha256
        or private_row.candidate_source_expectation_digest is distinct from c.source_expectation_digest
        or private_row.candidate_prepared_sha256 is distinct from prepared.sha256 then raise exception 'immutable_ingestion_chunk'; end if;
      actual:=jsonb_populate_record(null::public.document_chunks,to_jsonb(private_row));
      -- PRIVATE CHUNK REPLAY IDENTITY END
      select * into prior_final from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=final_key;
      if not found or prior_final.source_sha256<>c.source_sha256 or prior_final.group_key<>'worker_core'
        or prior_final.representation<>'provenance_json' or prior_final.locator<>'ingestion_chunk:'||final_key
        or prior_final.sha256<>'sha256:'||encode(extensions.digest(prior_final.artifact_bytes,'sha256'),'hex')
        or prior_final.byte_length<>octet_length(prior_final.artifact_bytes)
        or actual.metadata->>'ingestion_job_id' is distinct from c.job_id::text
        or actual.metadata->>'ingestion_job_kind' is distinct from 'node'
        or actual.metadata->>'ingestion_lease_token' is distinct from c.first_lease_token::text
        or coalesce(actual.metadata->>'ingestion_lease_token','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then raise exception 'immutable_ingestion_chunk'; end if;
      stored:=(to_jsonb(actual)-array['created_at','search_tsv','embedding'])||jsonb_build_object('embedding',(actual.embedding::text)::jsonb);
      body:=convert_from(prior_final.artifact_bytes,'UTF8')::jsonb;
      if body->'row' is distinct from stored or body->>'preparedSha256' is distinct from prepared.sha256
        then raise exception 'immutable_ingestion_chunk'; end if;
      if actual.document_id<>c.document_id or actual.index_generation_id is distinct from c.generation_id
        or (to_jsonb(actual)-array['created_at','search_tsv','metadata','embedding']) is distinct from expected_row
        or (actual.metadata-array['ingestion_lease_token','ingestion_job_kind','ingestion_job_id']) is distinct from r->'metadata'
        or (actual.embedding::text)::jsonb is distinct from (expected.embedding::text)::jsonb then raise exception 'immutable_ingestion_chunk'; end if;
    else
      r:=r||jsonb_build_object('metadata',r->'metadata'||jsonb_build_object('index_generation_id',c.generation_id,
        'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'),
        'embedding',(r->'embedding')::text);
      insert into ingestion_generation_evidence.candidate_chunk_rows(id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,retrieval_synopsis,content_hash,index_generation_id,token_estimate,image_ids,metadata,embedding,
        candidate_owner_id,candidate_job_id,candidate_lease_token,candidate_authority_digest,candidate_source_sha256,candidate_source_expectation_digest,candidate_prepared_sha256)
      select x.id,x.document_id,x.page_number,x.chunk_index,x.section_heading,x.section_path,x.heading_level,x.parent_heading,x.anchor_id,x.content,x.retrieval_synopsis,x.content_hash,x.index_generation_id,x.token_estimate,x.image_ids,x.metadata,x.embedding,
        (c.source_snapshot->>'owner_id')::uuid,c.job_id,c.first_lease_token,c.authority_digest,c.source_sha256,c.source_expectation_digest,prepared.sha256
        from jsonb_populate_record(null::public.document_chunks,r) x;
      select * into strict private_row from ingestion_generation_evidence.candidate_chunk_rows where id=chunk_id and document_id=c.document_id and index_generation_id=c.generation_id;
      actual:=jsonb_populate_record(null::public.document_chunks,to_jsonb(private_row));
    end if;
    stored:=(to_jsonb(actual)-array['created_at','search_tsv','embedding'])||jsonb_build_object('embedding',(actual.embedding::text)::jsonb);
    body:=jsonb_build_object('version','ingestion-persisted-chunk-v1','qualification','derived_unverified',
      'documentId',c.document_id,'generationId',c.generation_id,'sourceSha256',c.source_sha256,
      'sourceExpectationDigest',c.source_expectation_digest,'chunkId',chunk_id,'chunkIndex',actual.chunk_index,
      'preparedSha256',prepared.sha256,'row',stored);
    bytes:=convert_to(body::text,'UTF8'); digest:='sha256:'||encode(extensions.digest(bytes,'sha256'),'hex');
    artifact:=jsonb_build_object('unitId',jsonb_build_object('family','chunks','key',final_key),'groupKey','worker_core',
      'representation','provenance_json','bytesHex',encode(bytes,'hex'),'sha256',digest,'byteLength',octet_length(bytes),'locator','ingestion_chunk:'||final_key);
    perform ingestion_generation_evidence.retain(c,jsonb_build_array(artifact));
    outcome_result:=public.record_ingestion_generation_outcomes(p_fence,p_generation,jsonb_build_array(jsonb_build_object(
      'unitId',jsonb_build_object('family','chunks','key',final_key),'groupKey','worker_core','disposition','retained','artifactSha256',digest,'limitation',null)));
    if outcome_result->'ok' is distinct from 'true'::jsonb then raise exception 'ingestion_chunk_evidence_mismatch'; end if;
    results:=results||jsonb_build_array(jsonb_build_object('preparedUnitId',jsonb_build_object('family','chunks','key',prepared_key),
      'finalUnitId',jsonb_build_object('family','chunks','key',final_key),'preparedSha256',prepared.sha256,'finalSha256',digest,'finalByteLength',octet_length(bytes)));
  end loop;
  return jsonb_build_object('ok',true,'chunkEvidence',results);
exception when invalid_text_representation or character_not_in_repertoire or numeric_value_out_of_range or check_violation then
  raise exception 'ingestion_chunk_evidence_mismatch';
end $$;

-- selected function ingestion_generation_evidence.visual_unit_fence
create function ingestion_generation_evidence.visual_unit_fence(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$ begin
 return coalesce(ingestion_generation_evidence.keys(p,array['job_kind','job_id','document_id','worker_id','lease_token','expected_generation_id','authority_digest'])
  and p->'job_kind'='"node"'::jsonb and jsonb_typeof(p->'worker_id')='string' and btrim(p->>'worker_id')<>''
  and jsonb_typeof(p->'authority_digest')='string' and p->>'authority_digest' ~ '^sha256:[0-9a-f]{64}$'
  and jsonb_typeof(p->'job_id')='string' and p->>'job_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and jsonb_typeof(p->'document_id')='string' and p->>'document_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and jsonb_typeof(p->'lease_token')='string' and p->>'lease_token' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (p->'expected_generation_id'='null'::jsonb or (jsonb_typeof(p->'expected_generation_id')='string'
   and p->>'expected_generation_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),false);
end $$;

-- selected function public.trusted_document_admission_core
-- Factual document kind is emitted by trusted ordinary intake, for new admissions only.
create or replace function public.trusted_document_admission_core(
  p_admission jsonb,
  p_document jsonb,
  p_replay_only boolean,
  p_actor_kind text,
  p_administrator_id uuid,
  p_backend_principal text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_document_id uuid;
  v_staging_owner_id uuid;
  v_correlation_id uuid;
  v_import_batch_id uuid;
  v_supersedes_document_id uuid;
  v_authority jsonb;
  v_authority_key text;
  v_date_key text;
  v_date_value text;
  v_content_hex text;
  v_admission_digest text;
  v_document_input_digest text;
  v_request_digest text;
  v_actor_identity text;
  v_constraint_name text;
  v_event_id uuid := gen_random_uuid();
  v_job_id uuid := gen_random_uuid();
  v_max_attempts integer;
  v_metadata jsonb;
  v_storage_prefix text;
  v_storage_relative text;
  v_existing_event public.document_admission_events%rowtype;
  v_document public.documents%rowtype;
  v_job public.ingestion_jobs%rowtype;
begin
  if pg_catalog.jsonb_typeof(p_admission) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_document) is distinct from 'object'
    or p_replay_only is null
  then
    raise exception 'invalid_trusted_document_admission';
  end if;

  if not p_admission ?& array[
      'document_id', 'staging_owner_id', 'source_channel', 'content_sha256',
      'file_name_sha256', 'storage_path_sha256', 'mime_type', 'byte_count',
      'correlation_id', 'admission_policy_version', 'authority'
    ]
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_admission) as key
      where key <> all(array[
        'document_id', 'staging_owner_id', 'source_channel', 'content_sha256',
        'file_name_sha256', 'storage_path_sha256', 'mime_type', 'byte_count',
        'correlation_id', 'admission_policy_version', 'authority'
      ])
    )
  then
    raise exception 'invalid_trusted_document_admission_keys';
  end if;

  if not p_document ?& array[
      'id', 'owner_id', 'title', 'description', 'file_name', 'file_type',
      'file_size', 'storage_path', 'content_hash', 'metadata', 'max_attempts'
    ]
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_document) as key
      where key <> all(array[
        'id', 'owner_id', 'title', 'description', 'file_name', 'file_type',
        'file_size', 'storage_path', 'content_hash', 'source_path',
        'import_batch_id', 'metadata', 'max_attempts'
      ])
    )
  then
    raise exception 'invalid_trusted_document_input_keys';
  end if;

  begin
    v_document_id := (p_admission->>'document_id')::uuid;
    v_staging_owner_id := (p_admission->>'staging_owner_id')::uuid;
    v_correlation_id := (p_admission->>'correlation_id')::uuid;
    if p_document ? 'import_batch_id' and p_document->'import_batch_id' is distinct from 'null'::jsonb then
      v_import_batch_id := (p_document->>'import_batch_id')::uuid;
    end if;
  exception when invalid_text_representation then
    raise exception 'invalid_trusted_document_uuid';
  end;

  if p_admission->>'document_id' is distinct from v_document_id::text
    or p_admission->>'staging_owner_id' is distinct from v_staging_owner_id::text
    or p_admission->>'correlation_id' is distinct from v_correlation_id::text
    or p_document->>'id' is distinct from v_document_id::text
    or p_document->>'owner_id' is distinct from v_staging_owner_id::text
    or (v_import_batch_id is not null and p_document->>'import_batch_id' is distinct from v_import_batch_id::text)
    or p_admission->>'document_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_admission->>'staging_owner_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_admission->>'correlation_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (v_import_batch_id is not null and p_document->>'import_batch_id'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  then
    raise exception 'invalid_trusted_document_identity';
  end if;

  if p_actor_kind = 'administrator' then
    if p_administrator_id is null or p_backend_principal is not null
      or p_admission->>'source_channel' is distinct from 'admin_api'
      or v_staging_owner_id is distinct from p_administrator_id
      or v_import_batch_id is not null
      or p_document ? 'source_path'
    then
      raise exception 'invalid_administrator_admission_scope';
    end if;
    v_actor_identity := p_administrator_id::text;
  elsif p_actor_kind = 'trusted_backend' then
    if p_administrator_id is not null or p_backend_principal is null
      or p_admission->>'source_channel' is distinct from 'backend_import'
      or v_import_batch_id is null
      or not p_document ? 'source_path'
      or p_document->'source_path' is not distinct from 'null'::jsonb
    then
      raise exception 'invalid_backend_admission_scope';
    end if;
    v_actor_identity := p_backend_principal;
  else
    raise exception 'invalid_trusted_document_actor';
  end if;

  if p_admission->>'admission_policy_version' is distinct from 'trusted-document-admission-v1'
    or p_admission->>'content_sha256' !~ '^sha256:[0-9a-f]{64}$'
    or p_admission->>'file_name_sha256' !~ '^sha256:[0-9a-f]{64}$'
    or p_admission->>'storage_path_sha256' !~ '^sha256:[0-9a-f]{64}$'
    or (p_admission->>'mime_type' in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    )) is not true
    or pg_catalog.jsonb_typeof(p_admission->'byte_count') is distinct from 'number'
    or (p_admission->>'byte_count')::numeric <> pg_catalog.trunc((p_admission->>'byte_count')::numeric)
    or (p_admission->>'byte_count')::numeric not between 1 and 157286400
  then
    raise exception 'invalid_trusted_document_admission';
  end if;

  v_content_hex := pg_catalog.substring(p_admission->>'content_sha256', 8);
  if p_document->>'content_hash' is distinct from v_content_hex
    or p_document->>'file_type' is distinct from p_admission->>'mime_type'
    or pg_catalog.jsonb_typeof(p_document->'file_size') is distinct from 'number'
    or (p_document->>'file_size')::numeric is distinct from (p_admission->>'byte_count')::numeric
    or pg_catalog.jsonb_typeof(p_document->'title') is distinct from 'string'
    or pg_catalog.length(pg_catalog.btrim(p_document->>'title')) not between 1 and 180
    or p_document->>'title' is distinct from pg_catalog.btrim(p_document->>'title')
    or p_document->>'title' ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(p_document->'file_name') is distinct from 'string'
    or pg_catalog.length(p_document->>'file_name') not between 1 and 255
    or p_document->>'file_name' is distinct from pg_catalog.btrim(p_document->>'file_name')
    or p_document->>'file_name' ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(p_document->'storage_path') is distinct from 'string'
    or pg_catalog.length(p_document->>'storage_path') not between 1 and 1024
    or p_document->>'storage_path' is distinct from pg_catalog.btrim(p_document->>'storage_path')
    or p_document->>'storage_path' ~ '[[:cntrl:]]'
    or (p_document->'description' is distinct from 'null'::jsonb
      and (pg_catalog.jsonb_typeof(p_document->'description') is distinct from 'string'
        or pg_catalog.length(p_document->>'description') not between 1 and 1000
        or p_document->>'description' is distinct from pg_catalog.btrim(p_document->>'description')
        or p_document->>'description' ~ '[[:cntrl:]]'))
    or pg_catalog.jsonb_typeof(p_document->'metadata') is distinct from 'object'
    -- PostgreSQL's jsonb text encoding is the authoritative database resource bound.
    -- Callers may preflight compact canonical JSON bytes, but jsonb adds formatting.
    or pg_catalog.octet_length((p_document->'metadata')::text) > 65536
    or 'sha256:' || pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_document->>'file_name', 'UTF8'), 'sha256'), 'hex')
      is distinct from p_admission->>'file_name_sha256'
    or 'sha256:' || pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_document->>'storage_path', 'UTF8'), 'sha256'), 'hex')
      is distinct from p_admission->>'storage_path_sha256'
  then
    raise exception 'invalid_trusted_document_input';
  end if;

  v_storage_prefix := v_staging_owner_id::text || '/documents/' || v_document_id::text || '/';
  v_storage_relative := pg_catalog.substr(p_document->>'storage_path', pg_catalog.length(v_storage_prefix) + 1);
  if pg_catalog.left(p_document->>'storage_path', pg_catalog.length(v_storage_prefix)) is distinct from v_storage_prefix
    or pg_catalog.strpos(p_document->>'storage_path', pg_catalog.chr(92)) > 0
    or v_storage_relative = ''
    or exists (select 1 from pg_catalog.unnest(pg_catalog.string_to_array(v_storage_relative, '/')) as path(segment)
      where path.segment in ('', '.', '..'))
  then
    raise exception 'invalid_trusted_document_storage_path';
  end if;

  if p_document ? 'source_path'
    and p_document->'source_path' is distinct from 'null'::jsonb
    and (pg_catalog.jsonb_typeof(p_document->'source_path') is distinct from 'string'
      or pg_catalog.length(p_document->>'source_path') not between 1 and 4096
      or p_document->>'source_path' is distinct from pg_catalog.btrim(p_document->>'source_path')
      or p_document->>'source_path' ~ '[[:cntrl:]]')
  then
    raise exception 'invalid_trusted_document_source_path';
  end if;

  if pg_catalog.jsonb_typeof(p_document->'max_attempts') is distinct from 'number'
    or (p_document->>'max_attempts')::numeric <> pg_catalog.trunc((p_document->>'max_attempts')::numeric)
    or (p_document->>'max_attempts')::numeric not between 1 and 100
  then
    raise exception 'invalid_trusted_document_max_attempts';
  end if;
  v_max_attempts := (p_document->>'max_attempts')::integer;

  v_authority := p_admission->'authority';
  if pg_catalog.jsonb_typeof(v_authority) is distinct from 'object'
    or not v_authority ?& array[
      'version', 'sourceRole', 'authorityBasis', 'licencePolicy',
      'rightsEvidenceRef', 'publisher', 'jurisdiction', 'publicationDate',
      'effectiveDate', 'reviewDate', 'expiryDate', 'currentness',
      'supersedesDocumentId', 'purpose', 'supportedFeatures', 'providerProcessing'
    ]
  then
    raise exception 'invalid_trusted_document_authority';
  end if;

  for v_authority_key in select key from pg_catalog.jsonb_object_keys(v_authority) as key loop
    if v_authority_key <> all(array[
      'version', 'sourceRole', 'authorityBasis', 'licencePolicy',
      'rightsEvidenceRef', 'publisher', 'jurisdiction', 'publicationDate',
      'effectiveDate', 'reviewDate', 'expiryDate', 'currentness',
      'supersedesDocumentId', 'purpose', 'supportedFeatures', 'providerProcessing'
    ]) then
      raise exception 'invalid_trusted_document_authority_keys';
    end if;
  end loop;

  if v_authority->'version' is distinct from '1'::jsonb
    or (v_authority->>'sourceRole' in (
      'local_guideline', 'clinical_guideline', 'clinical_reference',
      'service_directory', 'form_reference', 'tool_reference', 'safety_alert',
      'regulatory', 'quality_standard', 'legal', 'subsidy',
      'professional_review', 'service_policy'
    )) is not true
    or v_authority->>'authorityBasis' is distinct from
      (case p_actor_kind when 'administrator' then 'administrator_template' else 'backend_manifest' end)
    or (v_authority->>'licencePolicy' in ('review_required', 'public_index_permitted')) is not true
    or pg_catalog.jsonb_typeof(v_authority->'rightsEvidenceRef') is distinct from 'string'
    or pg_catalog.length(v_authority->>'rightsEvidenceRef') not between 1 and 500
    or v_authority->>'rightsEvidenceRef' is distinct from pg_catalog.btrim(v_authority->>'rightsEvidenceRef')
    or v_authority->>'rightsEvidenceRef' ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(v_authority->'publisher') is distinct from 'string'
    or pg_catalog.length(v_authority->>'publisher') not between 1 and 300
    or v_authority->>'publisher' is distinct from pg_catalog.btrim(v_authority->>'publisher')
    or v_authority->>'publisher' ~ '[[:cntrl:]]'
    or v_authority->>'jurisdiction' is distinct from 'Australia'
    or (v_authority->>'currentness' in ('current', 'unknown')) is not true
    or v_authority->>'purpose' is distinct from 'clinical_retrieval'
    or (v_authority->>'providerProcessing' in ('permitted', 'forbidden')) is not true
    or pg_catalog.jsonb_typeof(v_authority->'supportedFeatures') is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_authority->'supportedFeatures') not between 1 and 3
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_authority->'supportedFeatures') as features(feature)
      where pg_catalog.jsonb_typeof(feature) is distinct from 'string'
        or (feature #>> '{}' in ('text', 'tables', 'images')) is not true
    )
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(v_authority->'supportedFeatures'))
      <> (select pg_catalog.count(distinct feature) from pg_catalog.jsonb_array_elements_text(v_authority->'supportedFeatures') feature)
    or v_authority->'supportedFeatures' is distinct from (
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(feature) order by
        case feature when 'images' then 1 when 'tables' then 2 when 'text' then 3 end)
      from pg_catalog.jsonb_array_elements_text(v_authority->'supportedFeatures') feature
    )
  then
    raise exception 'invalid_trusted_document_authority';
  end if;

  if p_document->'metadata'->>'corpus_scope' is distinct from 'uploaded_local'
    or p_document->'metadata'->>'content_mode' is distinct from 'indexed_content'
    or p_document->'metadata'->'authority' is distinct from v_authority
  then
    raise exception 'invalid_trusted_document_authority_binding';
  end if;

  foreach v_date_key in array array['publicationDate', 'effectiveDate', 'reviewDate', 'expiryDate'] loop
    if v_authority->v_date_key is distinct from 'null'::jsonb then
      if pg_catalog.jsonb_typeof(v_authority->v_date_key) is distinct from 'string'
        or v_authority->>v_date_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then
        raise exception 'invalid_trusted_document_authority_date';
      end if;
      v_date_value := v_authority->>v_date_key;
      begin
        perform v_date_value::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'invalid_trusted_document_authority_date';
      end;
    end if;
  end loop;

  if v_authority->'supersedesDocumentId' is distinct from 'null'::jsonb then
    begin
      v_supersedes_document_id := (v_authority->>'supersedesDocumentId')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_trusted_document_supersedes_id';
    end;
    if v_authority->>'supersedesDocumentId' is distinct from v_supersedes_document_id::text
      or v_supersedes_document_id = v_document_id
    then
      raise exception 'invalid_trusted_document_supersedes_id';
    end if;
  end if;

  v_admission_digest := 'sha256:' || pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_admission::text, 'UTF8'), 'sha256'), 'hex');
  v_document_input_digest := 'sha256:' || pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_document::text, 'UTF8'), 'sha256'), 'hex');
  v_request_digest := 'sha256:' || pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'actor_kind', p_actor_kind,
      'actor_identity', v_actor_identity,
      'admission_digest', v_admission_digest,
      'document_input_digest', v_document_input_digest
    )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'trusted-document-admission:replay:' || p_actor_kind || ':' || v_actor_identity || ':' ||
      (p_admission->>'source_channel') || ':' || v_correlation_id::text,
    0
  ));

  select event.* into v_existing_event
  from public.document_admission_events event
  where event.source_channel = p_admission->>'source_channel'
    and event.correlation_id = v_correlation_id
    and event.actor_kind = p_actor_kind
    and event.administrator_id is not distinct from p_administrator_id
    and event.backend_principal is not distinct from p_backend_principal
  for share;

  if found then
    if v_existing_event.request_digest is distinct from v_request_digest then
      raise exception 'admission_replay_conflict';
    end if;

    select document.* into v_document
    from public.documents document
    where document.id = v_existing_event.document_id
      and document.owner_id = v_existing_event.staging_owner_id
      and document.content_hash = v_content_hex;

    select job.* into v_job
    from public.ingestion_jobs job
    where job.id = v_existing_event.ingestion_job_id
      and job.document_id = v_existing_event.document_id;

    if v_document.id is null or v_job.id is null then
      raise exception 'admission_replay_state_missing' using errcode = '55000';
    end if;

    return pg_catalog.jsonb_build_object(
      'outcome', 'replayed',
      'admission_event_id', v_existing_event.id,
      'document', pg_catalog.to_jsonb(v_document),
      'job', pg_catalog.to_jsonb(v_job)
    );
  end if;

  if p_replay_only then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'trusted-document-admission:content:' || v_staging_owner_id::text || ':' || v_content_hex,
    0
  ));

  if exists (
    select 1 from public.documents document
    where document.owner_id = v_staging_owner_id
      and document.content_hash = v_content_hex
  ) then
    raise exception 'duplicate_content';
  end if;

  if exists (select 1 from public.documents document where document.id = v_document_id) then
    raise exception 'document_identity_conflict';
  end if;

  -- Retain only caller metadata used for source naming, provenance, and admission diagnostics.
  -- Clinical review, extraction, catalogue, and indexing authority is established
  -- by their owning server workflows rather than by either public admission RPC.
  select coalesce(pg_catalog.jsonb_object_agg(item.key, item.value), '{}'::jsonb)
  into v_metadata
  from pg_catalog.jsonb_each(p_document->'metadata') as item(key, value)
  where item.key = any(array[
    'original_file_name',
    'original_title',
    'smart_title_base',
    'smart_title_group_key',
    'smart_title_duplicate_index',
    'smart_title_duplicate_reason',
    'version',
    'max_upload_mb',
    'queue_batch_size'
  ]);

  v_metadata := v_metadata || pg_catalog.jsonb_build_object(
    'source_title', p_document->>'title',
    'source_kind', 'document',
    'uploaded_by', v_staging_owner_id,
    'source_path', case when p_document ? 'source_path' then p_document->'source_path' else 'null'::jsonb end,
    'import_batch_id', v_import_batch_id,
    'admission_max_attempts', v_max_attempts,
    'confidentiality_scope', 'guidelines-only',
    'content_hash', v_content_hex,
    'uploaded_at', v_now,
    'admission_event_id', v_event_id,
    'admission_policy_version', 'trusted-document-admission-v1',
    'authority', v_authority,
    'corpus_scope', 'uploaded_local',
    'content_mode', 'indexed_content',
    'source_role', v_authority->>'sourceRole',
    'authority_basis', v_authority->>'authorityBasis',
    'licence_policy', v_authority->>'licencePolicy',
    'rights_evidence_ref', v_authority->>'rightsEvidenceRef',
    'publisher', v_authority->>'publisher',
    'jurisdiction', 'Australia',
    'publication_date', v_authority->'publicationDate',
    'effective_date', v_authority->'effectiveDate',
    'review_date', v_authority->'reviewDate',
    'expiry_date', v_authority->'expiryDate',
    'publisher_code', null,
    'indexed_at', null,
    'document_status', v_authority->>'currentness',
    'clinical_validation_status', 'unverified',
    'extraction_quality', 'unknown',
    'supersedes_document_id', v_authority->'supersedesDocumentId',
    'purpose', 'clinical_retrieval',
    'supported_features', v_authority->'supportedFeatures',
    'provider_processing', v_authority->>'providerProcessing',
    'technical_ready', false,
    'passage_ready', false,
    'provider_ready', false
  );

  begin
    insert into public.documents (
      id, owner_id, title, description, file_name, file_type, file_size,
      storage_path, content_hash, source_path, import_batch_id, status, metadata
    ) values (
      v_document_id,
      v_staging_owner_id,
      p_document->>'title',
      case when p_document->'description' is distinct from 'null'::jsonb
        then p_document->>'description' else null end,
      p_document->>'file_name',
      p_document->>'file_type',
      (p_document->>'file_size')::bigint,
      p_document->>'storage_path',
      v_content_hex,
      case when p_document ? 'source_path' and p_document->'source_path' is distinct from 'null'::jsonb
        then p_document->>'source_path' else null end,
      v_import_batch_id,
      'queued',
      v_metadata
    ) returning * into v_document;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'documents_owner_content_hash_unique_idx' then
      raise exception 'duplicate_content';
    elsif v_constraint_name = 'documents_pkey' then
      raise exception 'document_identity_conflict';
    end if;
    raise;
  end;

  insert into public.ingestion_jobs (
    id, document_id, batch_id, status, stage, progress, max_attempts
  ) values (
    v_job_id, v_document.id, v_import_batch_id, 'pending', 'queued', 0, v_max_attempts
  ) returning * into v_job;

  insert into public.document_admission_events (
    id, document_id, ingestion_job_id, staging_owner_id, source_channel,
    actor_kind, administrator_id, backend_principal, correlation_id,
    admission_policy_version, content_sha256, file_name_sha256,
    storage_path_sha256, mime_type, byte_count, authority,
    admission_digest, document_input_digest, request_digest, created_at
  ) values (
    v_event_id, v_document.id, v_job.id, v_staging_owner_id,
    p_admission->>'source_channel', p_actor_kind, p_administrator_id,
    p_backend_principal, v_correlation_id, 'trusted-document-admission-v1',
    p_admission->>'content_sha256', p_admission->>'file_name_sha256',
    p_admission->>'storage_path_sha256', p_admission->>'mime_type',
    (p_admission->>'byte_count')::bigint, v_authority,
    v_admission_digest, v_document_input_digest, v_request_digest, v_now
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'created',
    'admission_event_id', v_event_id,
    'document', pg_catalog.to_jsonb(v_document),
    'job', pg_catalog.to_jsonb(v_job)
  );
end;
$$;

-- selected function public.admit_administrator_document
create or replace function public.admit_administrator_document(
  p_admission jsonb,
  p_document jsonb,
  p_replay_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_recent_assurance boolean := false;
begin
  if v_uid is null
    or pg_catalog.jsonb_typeof(v_jwt) is distinct from 'object'
    or v_jwt->>'role' is distinct from 'authenticated'
    or v_jwt->>'sub' is distinct from v_uid::text
    or v_jwt#>>'{app_metadata,site_role}' is distinct from 'administrator'
    or v_jwt->>'aal' is distinct from 'aal2'
    or pg_catalog.jsonb_typeof(v_jwt->'amr') is distinct from 'array'
  then
    raise exception 'administrator_assurance_required';
  end if;

  select exists(
    select 1
    from pg_catalog.jsonb_array_elements(v_jwt->'amr') as methods(amr)
    where pg_catalog.jsonb_typeof(amr) = 'object'
      and amr->>'method' in ('password', 'otp', 'totp', 'webauthn')
      and case when pg_catalog.jsonb_typeof(amr->'timestamp') = 'number' then
        pg_catalog.to_timestamp((amr->>'timestamp')::double precision) <= v_now
          and pg_catalog.to_timestamp((amr->>'timestamp')::double precision) >= v_now - interval '900 seconds'
      else false end
  )
  into v_recent_assurance
  ;

  if not v_recent_assurance then
    raise exception 'administrator_recent_authentication_required';
  end if;

  return public.trusted_document_admission_core(
    p_admission, p_document, p_replay_only, 'administrator', v_uid, null
  );
end;
$$;

-- selected function public.begin_ingestion_generation_evidence
create or replace function public.begin_ingestion_generation_evidence(p_fence jsonb,p_generation uuid,p_registration jsonb,p_original_hex text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb;c ingestion_generation_evidence.candidates; b bytea; ex bytea; h text; admission public.document_admission_events; se jsonb; x jsonb;
begin
  a:=public.assert_current_ingestion_attempt(p_fence,p_generation);
  if a is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'job_kind'<>'node' or p_generation is null or not ingestion_generation_evidence.keys(p_registration,array['version','profileVersion','sourceSha256','sourceByteLength','sourceExpectation','sourceExpectationHex','sourceExpectationSha256','declarations'])
    or p_registration->'version' is distinct from '1'::jsonb or p_registration->>'profileVersion' is distinct from 'u10-u12-prerequisite-profile-v1'
    or jsonb_typeof(p_registration->'sourceByteLength') is distinct from 'number' or coalesce(p_registration->>'sourceByteLength','') !~ '^[1-9][0-9]*$'
    or p_original_hex is null or p_original_hex !~ '^([0-9a-f]{2})+$' then raise exception 'invalid_generation_registration'; end if;
  b:=decode(p_original_hex,'hex');h:='sha256:'||encode(extensions.digest(b,'sha256'),'hex');
  if octet_length(b) not between 1 and 157286400 or octet_length(b)::bigint is distinct from (a->'document'->>'file_size')::bigint
    or octet_length(b)::bigint is distinct from (p_registration->>'sourceByteLength')::bigint or h is distinct from p_registration->>'sourceSha256'
    or h is distinct from 'sha256:'||(a->'document'->>'content_hash') then raise exception 'retained_source_admission_mismatch'; end if;
  if a->'document'->'metadata' ? 'admission_event_id' then
    select * into admission from public.document_admission_events where id=(a->'document'->'metadata'->>'admission_event_id')::uuid;
    if not found or admission.document_id is distinct from (p_fence->>'document_id')::uuid or admission.content_sha256 is distinct from h or admission.byte_count is distinct from octet_length(b)::bigint
      or admission.admission_policy_version<>'trusted-document-admission-v1'
      or admission.mime_type is distinct from a->'document'->>'file_type'
      or admission.file_name_sha256 is distinct from 'sha256:'||encode(extensions.digest(convert_to(a->'document'->>'file_name','UTF8'),'sha256'),'hex')
      or admission.storage_path_sha256 is distinct from 'sha256:'||encode(extensions.digest(convert_to(a->'document'->>'storage_path','UTF8'),'sha256'),'hex') then raise exception 'retained_source_admission_mismatch'; end if;
  end if;
  se:=p_registration->'sourceExpectation';
  if not ingestion_generation_evidence.keys(se,array['version','sourceSha256','tag','units','witness','limitation']) or se->'version' is distinct from '1'::jsonb or se->>'sourceSha256' is distinct from h then raise exception 'invalid_original_source_expectation'; end if;
  if se->>'tag'='known' then
    if jsonb_typeof(se->'units') is distinct from 'array' or jsonb_array_length(se->'units')=0 or se->'limitation' is distinct from 'null'::jsonb
      or not ingestion_generation_evidence.keys(se->'witness',array['reference','sha256']) or coalesce(se->'witness'->>'reference','')='' or coalesce(se->'witness'->>'sha256','') !~ '^sha256:[0-9a-f]{64}$' then raise exception 'invalid_original_source_expectation'; end if;
    for x in select value from jsonb_array_elements(se->'units') loop
      if not ingestion_generation_evidence.keys(x,array['id','required','dependencies','locator','nativeMapping']) or coalesce(x->>'id','')='' or coalesce(x->>'locator','')=''
        or jsonb_typeof(x->'required') is distinct from 'boolean' or jsonb_typeof(x->'dependencies') is distinct from 'array' or jsonb_typeof(x->'nativeMapping') is distinct from 'string' or x->>'nativeMapping' is distinct from 'unavailable'
        or exists(select 1 from jsonb_array_elements(x->'dependencies') dep where jsonb_typeof(dep.value)<>'string' or dep.value#>>'{}'=x->>'id' or not exists(select 1 from jsonb_array_elements(se->'units') su where su.value->>'id'=dep.value#>>'{}')) then raise exception 'invalid_original_source_dependency'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(se->'units') x group by x.value->>'id' having count(*)>1) then raise exception 'invalid_original_source_population'; end if;
  elsif se->>'tag' in ('unknown','unavailable') then
    if se->'units' is distinct from 'null'::jsonb or se->'witness' is distinct from 'null'::jsonb or coalesce(se->>'limitation','')='' then raise exception 'invalid_original_source_expectation'; end if;
  else raise exception 'invalid_original_source_expectation'; end if;
  if coalesce(p_registration->>'sourceExpectationHex','') !~ '^([0-9a-f]{2})+$' then raise exception 'invalid_original_expectation_bytes'; end if;
  ex:=decode(p_registration->>'sourceExpectationHex','hex');
  if convert_from(ex,'UTF8')::jsonb is distinct from se or p_registration->>'sourceExpectationSha256' is distinct from 'sha256:'||encode(extensions.digest(ex,'sha256'),'hex') then raise exception 'original_expectation_digest_mismatch'; end if;
  select * into c from ingestion_generation_evidence.candidates where document_id=(p_fence->>'document_id')::uuid and generation_id=p_generation for update;
  if found then
    if c.registration is distinct from p_registration or c.job_id is distinct from (p_fence->>'job_id')::uuid or c.first_lease_token is distinct from (p_fence->>'lease_token')::uuid or c.authority_digest is distinct from p_fence->>'authority_digest' then raise exception 'immutable_generation_registration'; end if;
  else
    insert into ingestion_generation_evidence.candidates(document_id,generation_id,job_id,first_lease_token,authority_digest,predecessor_generation_id,source_sha256,source_byte_length,source_expectation,source_expectation_bytes,source_expectation_digest,source_snapshot,profile_version,registration)
    values((p_fence->>'document_id')::uuid,p_generation,(p_fence->>'job_id')::uuid,(p_fence->>'lease_token')::uuid,p_fence->>'authority_digest',(p_fence->>'expected_generation_id')::uuid,h,octet_length(b),se,ex,p_registration->>'sourceExpectationSha256',a->'document',p_registration->>'profileVersion',p_registration) returning * into c;
  end if;
  if exists(select 1 from jsonb_array_elements(p_registration->'declarations'->'groups') g where g.value->>'family'<>'private_objects')
    or not exists(select 1 from jsonb_array_elements(p_registration->'declarations'->'units') u where u.value->'id'=jsonb_build_object('family','private_objects','key','original-source') and u.value->>'representation'='original_binary') then raise exception 'complete_private_objects_plan_required'; end if;
  -- The immutable plan must include all four distinct representations of every
  -- actual logical page before the first source artifact is retained. Original-only
  -- registration cannot become a permanently incomplete bootstrap declaration.
  if not exists(select 1 from jsonb_array_elements(p_registration->'declarations'->'units') u where u.value->'id'->>'key' ~ '^page:[1-9][0-9]*:extracted$')
    or exists(select 1 from jsonb_array_elements(p_registration->'declarations'->'units') u where
      u.value->'id'->>'family' is distinct from 'private_objects' or u.value->>'groupKey' is distinct from 'private_objects' or u.value->'required' is distinct from 'true'::jsonb
      or not coalesce(((u.value->'id'->>'key'='original-source' and u.value->>'representation'='original_binary')
        or (u.value->'id'->>'key'='original-source-expectation-witness' and u.value->>'representation'='source_expectation_witness')
        or (u.value->'id'->>'key' ~ '^page:[1-9][0-9]*:(extracted|persisted|original-provenance|persisted-provenance)$' and u.value->>'representation'=case split_part(u.value->'id'->>'key',':',3) when 'extracted' then 'extracted_utf8' when 'persisted' then 'persisted_utf8' else 'provenance_json' end)
        or (u.value->'id'->>'key' ~ '^image:[1-9][0-9]*:(binary|provenance)$' and u.value->>'representation'=case split_part(u.value->'id'->>'key',':',3) when 'binary' then 'image_binary' else 'image_provenance' end)),false))
    or exists(select 1 from jsonb_array_elements(p_registration->'declarations'->'units') u where u.value->'id'->>'key' like 'page:%' group by split_part(u.value->'id'->>'key',':',2) having count(*)<>4 or count(distinct split_part(u.value->'id'->>'key',':',3))<>4)
    or exists(select 1 from jsonb_array_elements(p_registration->'declarations'->'units') u where u.value->'id'->>'key' like 'image:%' group by split_part(u.value->'id'->>'key',':',2) having count(*)<>2 or count(distinct split_part(u.value->'id'->>'key',':',3))<>2)
    then raise exception 'complete_private_objects_plan_required'; end if;
  if exists(select 1 from jsonb_array_elements(p_registration->'declarations'->'units') u where u.value->'id'->>'key' like 'image:%') then
    if (select count(distinct split_part(u.value->'id'->>'key',':',2)) from jsonb_array_elements(p_registration->'declarations'->'units') u where u.value->'id'->>'key' like 'image:%') is distinct from (select max(split_part(u.value->'id'->>'key',':',2)::numeric) from jsonb_array_elements(p_registration->'declarations'->'units') u where u.value->'id'->>'key' like 'image:%')
      then raise exception 'complete_private_objects_plan_required'; end if;
  end if;
  perform ingestion_generation_evidence.declare_groups(c,p_registration->'declarations');
  perform ingestion_generation_evidence.retain(c,jsonb_build_array(jsonb_build_object('unitId',jsonb_build_object('family','private_objects','key','original-source'),'groupKey','private_objects','representation','original_binary','bytesHex',p_original_hex,'sha256',h,'byteLength',octet_length(b),'locator','whole_original_file')));
  return jsonb_build_object('ok',true,'managed',true,'technicalEligibility','unavailable');
end $$;

-- coordinated TABLE to SETOF jsonb replacement; no CASCADE
drop function public.claim_indexing_v3_agent_jobs(text,integer,integer);

-- selected function public.claim_indexing_v3_agent_jobs
create function public.claim_indexing_v3_agent_jobs(p_worker_id text, p_claim_limit integer default 1, p_stale_after_minutes integer default 45)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare v_candidate record; v_locked jsonb; v_job public.indexing_v3_agent_jobs%rowtype; v_count integer := 0; v_now timestamptz; v_generation uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' or p_claim_limit is null or p_claim_limit not between 1 and 100
    or p_stale_after_minutes not between 1 and 1440 or p_stale_after_minutes is null then raise exception 'invalid_ingestion_claim_configuration'; end if;
  -- Discovery remains bounded by successful claims and revalidates every source/document route under locks.
  for v_candidate in select j.id, d.id as document_id from public.documents d
    left join public.indexing_v3_agent_jobs j on j.document_id=d.id
    where d.status='indexed' and d.index_generation_id is not null
      and not exists(select 1 from public.ingestion_jobs i where i.document_id=d.id and i.status='pending')
      and ((j.id is null and d.metadata ? 'indexing_v3_agent_status'
        and coalesce(d.metadata->>'indexing_v3_agent_status','pending') not in ('completed','needs_enrichment_artifacts'))
        or (j.attempt_count < j.max_attempts and (
          j.status in ('pending','failed') and coalesce(j.next_run_at,pg_catalog.clock_timestamp()) <= pg_catalog.clock_timestamp()
          or j.status='processing' and j.lease_expires_at <= pg_catalog.clock_timestamp())))
    order by d.created_at,d.id
  loop
    exit when v_count >= p_claim_limit;
    v_locked := public.lock_ingestion_document_authority(v_candidate.document_id, true);
    if v_locked is null then continue; end if;
    perform 1 from public.ingestion_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    perform 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    v_now := pg_catalog.clock_timestamp();
    if exists (select 1 from public.ingestion_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now)
      or exists (select 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now) then continue; end if;
    v_generation := (v_locked->'document'->>'index_generation_id')::uuid;
    if v_generation is null or v_locked->'document'->>'status' is distinct from 'indexed'
      or exists(select 1 from public.ingestion_jobs where document_id=v_candidate.document_id and status='pending') then continue; end if;
    select * into v_job from public.indexing_v3_agent_jobs where document_id=v_candidate.document_id for update skip locked;
    if not found then
      if v_candidate.id is not null or not (v_locked->'document'->'metadata' ? 'indexing_v3_agent_status')
        or coalesce(v_locked->'document'->'metadata'->>'indexing_v3_agent_status','pending') in ('completed','needs_enrichment_artifacts') then continue; end if;
      insert into public.indexing_v3_agent_jobs(document_id,status,enrichment_status)
        values(v_candidate.document_id,'pending','pending') returning * into v_job;
    end if;
    if v_job.attempt_count >= v_job.max_attempts or not (
      v_job.status in ('pending','failed') and coalesce(v_job.next_run_at,v_now)<=v_now
      or v_job.status='processing' and v_job.lease_expires_at<=v_now) then continue; end if;
    update public.indexing_v3_agent_jobs set status = 'processing', enrichment_status='processing', last_error=null, updated_at=v_now, locked_by = p_worker_id, locked_at = v_now,
      lease_token = gen_random_uuid(), lease_expected_generation_id = v_generation,
      lease_write_generation_id = v_generation,
      lease_authority_digest = v_locked->>'authority_digest', lease_expires_at = v_now + make_interval(secs => p_stale_after_minutes * 60),
      lease_duration_seconds = p_stale_after_minutes * 60, attempt_count = attempt_count + 1, next_run_at = null
    where id = v_job.id returning * into v_job;
    update public.documents set metadata=public.jsonb_merge_deep(metadata,jsonb_build_object(
      'indexing_v3_agent_status','processing','indexing_v3_agent_version',v_job.version,'indexing_v3_agent_attempt_count',v_job.attempt_count,
      'indexing_v3_agent_max_attempts',v_job.max_attempts,'indexing_v3_agent_locked_by',p_worker_id,'indexing_v3_agent_locked_at',v_now,
      'enrichment_status','processing')),updated_at=v_now where id=v_candidate.document_id;
    return next to_jsonb(v_job) || jsonb_build_object('job_kind','indexing_v3','batch_id',v_locked->'document'->'import_batch_id','documents',v_locked->'document');
    v_count := v_count + 1;
  end loop;
end $$;

-- coordinated TABLE to SETOF jsonb replacement; no CASCADE
drop function public.claim_ingestion_jobs(text,integer,integer);

-- selected function public.claim_ingestion_jobs
create function public.claim_ingestion_jobs(p_worker_id text, p_claim_limit integer default 1, p_stale_after_minutes integer default 45)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare v_candidate record; v_locked jsonb; v_job public.ingestion_jobs%rowtype; v_count integer := 0; v_now timestamptz; v_generation uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' or p_claim_limit is null or p_claim_limit not between 1 and 100
    or p_stale_after_minutes not between 1 and 1440 or p_stale_after_minutes is null then raise exception 'invalid_ingestion_claim_configuration'; end if;
  for v_candidate in select j.id, j.document_id from public.ingestion_jobs j
    where j.attempt_count < j.max_attempts
      and (j.status = 'pending' and coalesce(j.next_run_at, pg_catalog.clock_timestamp()) <= pg_catalog.clock_timestamp()
        or j.status = 'processing' and j.lease_expires_at <= pg_catalog.clock_timestamp())
    order by j.created_at, j.id
  loop
    exit when v_count >= p_claim_limit;
    v_locked := public.lock_ingestion_document_authority(v_candidate.document_id, true);
    if v_locked is null then continue; end if;
    perform 1 from public.ingestion_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    perform 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    v_now := pg_catalog.clock_timestamp();
    if exists (select 1 from public.ingestion_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now)
      or exists (select 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now) then continue; end if;
    select * into v_job from public.ingestion_jobs where id = v_candidate.id for update skip locked;
    if not found or v_job.attempt_count >= v_job.max_attempts or not (
      v_job.status = 'pending' and coalesce(v_job.next_run_at, v_now) <= v_now
      or v_job.status = 'processing' and v_job.lease_expires_at <= v_now) then continue; end if;
    v_generation := (v_locked->'document'->>'index_generation_id')::uuid;
    if v_generation is null and (v_locked->'document'->'metadata' ? 'index_generation_id') then continue; end if;

    update public.ingestion_jobs set status = 'processing', locked_by = p_worker_id, locked_at = v_now,
      lease_token = gen_random_uuid(), lease_expected_generation_id = v_generation,
      lease_write_generation_id = gen_random_uuid(),
      lease_authority_digest = v_locked->>'authority_digest', lease_expires_at = v_now + make_interval(secs => p_stale_after_minutes * 60),
      lease_duration_seconds = p_stale_after_minutes * 60, attempt_count = attempt_count + 1, next_run_at = null
    where id = v_job.id returning * into v_job;
    return next to_jsonb(v_job) || jsonb_build_object('job_kind','node', 'documents',v_locked->'document');
    v_count := v_count + 1;
  end loop;
end $$;

-- selected function public.patch_ingestion_document_state
create or replace function public.patch_ingestion_document_state(p_fence jsonb, p_state jsonb, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  if exists(select 1 from ingestion_generation_evidence.candidates where document_id=(p_fence->>'document_id')::uuid and job_id=(p_fence->>'job_id')::uuid)
    and (p_metadata is distinct from '{}'::jsonb or (p_state ? 'status' and p_state->>'status'='indexed' and v_locked->'document'->>'status' is distinct from 'indexed')) then
    return jsonb_build_object('ok',false,'reason','technical_supplier_not_implemented');
  end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if jsonb_typeof(p_state) is distinct from 'object' or jsonb_typeof(p_metadata) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_state) k where k <> all(array['status','error_message']))
    or exists(select 1 from jsonb_object_keys(p_metadata) k where k <> all(array['indexed_at','cover_image_id','rag_enrichment_version','rag_indexing_version','rag_memory_version','rag_memory_updated_at','rag_enrichment_updated_at','enrichment_status','enrichment_error','section_count','memory_card_count','extraction_quality','index_quality_score','index_quality_issues','index_quality_metrics','optional_index_write_issues','indexing_v3_agent_status','indexing_v3_agent_last_error','indexing_v3_agent_repair_reason','indexing_v3_agent_updated_at','completion_gate_missing','embedding_model','page_count','ocr_page_count','needs_ocr_page_count','text_character_count','extracted_image_count','searchable_image_count','skipped_image_count','skipped_image_reasons','image_type_counts','extraction_warnings','document_embedding_field_types','shadow_extraction','index_generation_id']))
    or (p_metadata ? 'index_generation_id' and p_metadata->>'index_generation_id' is distinct from p_fence->>'expected_generation_id')
    or (p_state ? 'status' and coalesce(p_state->>'status','') not in ('queued','processing','indexed','failed')) then raise exception 'invalid_ingestion_document_patch'; end if;
  update public.documents set status=case when p_state ? 'status' then p_state->>'status' else status end,
    error_message=case when p_state ? 'error_message' then p_state->>'error_message' else error_message end,
    metadata=public.jsonb_merge_deep(metadata,p_metadata),updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  return jsonb_build_object('ok',true);
end $$;

-- selected function public.commit_document_index_generation
-- Existing function signatures, ownership and ACLs remain unchanged.
create or replace function public.commit_document_index_generation(p_fence jsonb, p_generation uuid, p_page_count integer, p_chunk_count integer, p_image_count integer, p_metadata jsonb, p_pages jsonb, p_quality jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_next jsonb; v_result jsonb;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if exists(select 1 from ingestion_generation_evidence.candidates where document_id=v_document_id and generation_id=p_generation) and not ingestion_generation_evidence.admin_text_commit_allowed(p_fence,p_generation) then
    return jsonb_build_object('ok',false,'reason','technical_supplier_not_implemented');
  end if;
  if p_fence->>'job_kind' <> 'node' or p_generation is null or p_chunk_count is null or p_image_count is null or p_page_count is null
    or jsonb_typeof(p_pages) is distinct from 'array' or jsonb_typeof(p_quality) is distinct from 'object'
    or p_page_count < 0 or p_page_count > 100000 or p_chunk_count < 0 or p_image_count < 0 or p_chunk_count+p_image_count = 0
    or p_chunk_count <> (select count(*) from public.document_chunks where document_id=v_document_id and index_generation_id=p_generation)
    or p_image_count <> (select count(*) from public.document_images where document_id=v_document_id and index_generation_id=p_generation and searchable)
    or p_page_count <> jsonb_array_length(p_pages) then raise exception 'invalid_ingestion_core_counts'; end if;
  -- Only the reserved generation becomes visible. Earlier committed evidence is retained for later lifecycle work.
  -- Retain previous generations; typed pages become visible only with sole pointer commit.
  insert into public.document_pages(document_id,index_generation_id,page_number,text,ocr_used,metadata)
  select v_document_id,p_generation,r.page_number,r.text,r.ocr_used,coalesce(r.metadata,'{}'::jsonb)
    from jsonb_to_recordset(p_pages) r(page_number integer,text text,ocr_used boolean,metadata jsonb);
  insert into public.document_index_quality(document_id,owner_id,quality_score,extraction_quality,metrics,issues,updated_at)
  values(v_document_id,(v_locked->'document'->>'owner_id')::uuid,(p_quality->>'quality_score')::real,p_quality->>'extraction_quality',
    p_quality->'metrics',array(select jsonb_array_elements_text(p_quality->'issues')),pg_catalog.clock_timestamp())
  on conflict(document_id) do update set
    quality_score=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.quality_score else excluded.quality_score end,
    extraction_quality=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.extraction_quality else excluded.extraction_quality end,
    metrics=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.metrics || excluded.metrics else excluded.metrics end,
    issues=case when p_fence->>'job_kind'='indexing_v3' then array(select distinct x from unnest(public.document_index_quality.issues || excluded.issues) x) else excluded.issues end,
    updated_at=excluded.updated_at;

  update public.ingestion_jobs set lease_expected_generation_id=p_generation where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='node'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  perform set_config('psychsift.page_commit_owner',v_document_id::text,true);
  update public.documents set page_storage_mode='typed_exact',status='indexed',page_count=p_page_count,chunk_count=p_chunk_count,image_count=p_image_count,error_message=null,
    metadata=metadata || jsonb_build_object('index_generation_id',p_generation), updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  perform set_config('psychsift.page_commit_owner','',true);
  v_next := p_fence || jsonb_build_object('expected_generation_id',p_generation);
  v_result := public.patch_ingestion_document_state(v_next,'{}'::jsonb,p_metadata);
  if v_result->'ok' is distinct from 'true'::jsonb then raise exception 'ingestion_mutation_row_count'; end if;
  return jsonb_build_object('ok',true,'fence',v_next,'index_generation_id',p_generation);
end $$;

-- selected function public.complete_ingestion_job
create or replace function public.complete_ingestion_job(p_fence jsonb, p_batch_id uuid, p_stage text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_batch uuid; v_pending integer; v_processing integer; v_failed integer;
begin
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if exists(select 1 from ingestion_generation_evidence.candidates where document_id=(p_fence->>'document_id')::uuid and job_id=(p_fence->>'job_id')::uuid) and not ingestion_generation_evidence.admin_text_commit_allowed(p_fence,(p_fence->>'expected_generation_id')::uuid) then return jsonb_build_object('ok',false,'reason','technical_supplier_not_implemented'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  v_batch := (v_locked->'job'->>'batch_id')::uuid;
  if p_batch_id is not null and p_batch_id is distinct from v_batch then raise exception 'ingestion_batch_identity_mismatch'; end if;
  if v_batch is not null then perform 1 from public.import_batches where id=v_batch for update; end if;
  update public.ingestion_jobs set status='completed',stage=p_stage,progress=100,error_message=null,locked_by=null,locked_at=null,completed_at=pg_catalog.clock_timestamp()
  where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='node'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  -- The document and its attempt rows are locked by assert_current_ingestion_attempt.
  -- A successful replacement supersedes older failed attempts, never a newer job.
  update public.ingestion_jobs set status='completed',stage='superseded by successful index',progress=100,
    error_message=null,locked_by=null,locked_at=null,next_run_at=null,completed_at=pg_catalog.clock_timestamp()
  where document_id=v_document_id and id<>(p_fence->>'job_id')::uuid and status='failed'
    and created_at <= (v_locked->'job'->>'created_at')::timestamptz;
  if v_batch is not null then
    select count(*) filter(where status='pending'),count(*) filter(where status='processing'),count(*) filter(where status='failed')
      into v_pending,v_processing,v_failed from public.ingestion_jobs where batch_id=v_batch;
    update public.import_batches set status=case when v_pending+v_processing>0 then 'processing' when v_failed>0 then 'completed_with_errors' else 'completed' end,
      failed_files=v_failed, completed_at=case when v_pending+v_processing>0 then null else pg_catalog.clock_timestamp() end where id=v_batch;
  end if;
  return jsonb_build_object('ok',true);
end $$;

-- selected function public.complete_managed_admin_text
create or replace function public.complete_managed_admin_text(p_fence jsonb,p_generation uuid,p_packet jsonb,p_read_only boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c ingestion_generation_evidence.candidates; a jsonb; j public.ingestion_jobs; ad public.document_admission_events;
 original ingestion_generation_evidence.retained_artifacts; witness ingestion_generation_evidence.retained_artifacts;
 retained ingestion_generation_evidence.retained_artifacts; prepared ingestion_generation_evidence.retained_artifacts;
 final ingestion_generation_evidence.retained_artifacts; candidate_row ingestion_generation_evidence.candidate_chunk_rows;
 public_row public.document_chunks; actual jsonb; identity jsonb; w jsonb; g jsonb; u jsonb; r jsonb; b jsonb;
 seal jsonb; prior ingestion_generation_evidence.prerequisite_accounting; source_text text; cursor_byte integer:=0;
 start_byte integer; end_byte integer; chunk_total integer; chunk_index integer:=0; source_covered integer:=0;
 bytes bytea; digest text; pages jsonb; quality jsonb; next_fence jsonb; result jsonb;
begin
 if p_read_only is null or not ingestion_generation_evidence.visual_unit_fence(p_fence)
   or p_fence->>'job_kind' is distinct from 'node' or p_generation is null
   or not ((p_packet->>'version'='managed-admin-text-complete-v1' and ingestion_generation_evidence.keys(p_packet,array['version','identity','chunks','quality']))
     or (p_packet->>'version'='managed-admin-text-complete-v2' and ingestion_generation_evidence.keys(p_packet,array['version','identity','chunks','sections','quality']) and jsonb_typeof(p_packet->'sections')='array'))
   or jsonb_typeof(p_packet->'chunks') is distinct from 'array'
   then raise exception 'managed_admin_text_invalid_packet';end if;
 chunk_total:=jsonb_array_length(p_packet->'chunks');
 if not ingestion_generation_evidence.keys(p_packet->'quality',array['quality_score','extraction_quality','issues','metrics'])
   or jsonb_typeof(p_packet->'quality'->'quality_score') is distinct from 'number'
   or (p_packet->'quality'->>'quality_score')::numeric not between 0 and 1
   or coalesce(p_packet->'quality'->>'extraction_quality','') not in ('good','partial','poor','unknown')
   or jsonb_typeof(p_packet->'quality'->'issues') is distinct from 'array' or jsonb_typeof(p_packet->'quality'->'metrics') is distinct from 'object'
   then raise exception 'managed_admin_text_quality_mismatch';end if;
 if chunk_total<1 or chunk_total>2000 or octet_length(convert_to(p_packet::text,'UTF8'))>1048576
   then raise exception 'managed_admin_text_transport_limit';end if;
 -- Preserve governance -> document -> both sorted job sets -> candidate lock order.
 a:=public.lock_ingestion_document_authority((p_fence->>'document_id')::uuid,false);
 if a is null then raise exception 'managed_admin_text_authority_mismatch';end if;
 perform 1 from public.ingestion_jobs where document_id=(p_fence->>'document_id')::uuid order by id for update;
 perform 1 from public.indexing_v3_agent_jobs where document_id=(p_fence->>'document_id')::uuid order by id for update;
 select * into strict j from public.ingestion_jobs where id=(p_fence->>'job_id')::uuid;
 select * into strict c from ingestion_generation_evidence.candidates
   where document_id=(p_fence->>'document_id')::uuid and generation_id=p_generation for update;
 identity:=jsonb_build_object('documentId',c.document_id,'generationId',c.generation_id,'jobId',c.job_id,
   'workerId',p_fence->>'worker_id','firstLeaseToken',c.first_lease_token,'attemptNumber',j.attempt_count,
   'batchId',j.batch_id,'authorityDigest',c.authority_digest,'predecessorGenerationId',c.predecessor_generation_id,
   'ownerId',c.source_snapshot->'owner_id','sourceSha256',c.source_sha256,'sourceByteLength',c.source_byte_length,
   'sourceExpectationDigest',c.source_expectation_digest);
 if p_packet->'identity' is distinct from identity or j.id is distinct from c.job_id or j.document_id is distinct from c.document_id
   or j.lease_token is distinct from c.first_lease_token or c.first_lease_token::text is distinct from p_fence->>'lease_token'
   or j.lease_write_generation_id is distinct from c.generation_id or c.predecessor_generation_id is distinct from (p_fence->>'expected_generation_id')::uuid
   or c.authority_digest is distinct from p_fence->>'authority_digest' or c.authority_digest is distinct from a->>'authority_digest'
   or j.lease_authority_digest is distinct from c.authority_digest or c.source_snapshot->'owner_id' is distinct from a->'document'->'owner_id'
   or c.source_sha256 is distinct from 'sha256:'||(a->'document'->>'content_hash')
   or c.source_byte_length is distinct from (a->'document'->>'file_size')::bigint or c.source_byte_length>2097152
   or a->'document'->>'file_type' is distinct from 'text/plain'
   or exists(select 1 from public.ingestion_jobs other where other.document_id=c.document_id and other.id<>j.id
     and (other.created_at>j.created_at or other.status in ('pending','processing')))
   then raise exception 'managed_admin_text_identity_mismatch';end if;
 select * into ad from public.document_admission_events where id=(a->'document'->'metadata'->>'admission_event_id')::uuid;
 if not found or ad.actor_kind is distinct from 'administrator' or ad.source_channel is distinct from 'admin_api'
   or ad.document_id is distinct from c.document_id or ad.staging_owner_id is distinct from (a->'document'->>'owner_id')::uuid
   or ad.content_sha256 is distinct from c.source_sha256 or ad.byte_count is distinct from c.source_byte_length or ad.mime_type is distinct from 'text/plain'
   or ad.admission_policy_version is distinct from 'trusted-document-admission-v1'
   or ad.authority is distinct from a->'document'->'metadata'->'authority'
   or c.source_snapshot->'metadata'->'admission_event_id' is distinct from a->'document'->'metadata'->'admission_event_id'
   or ad.authority->>'authorityBasis' is distinct from 'administrator_template'
   or ad.authority->>'licencePolicy' is distinct from 'public_index_permitted'
   or ad.authority->>'providerProcessing' is distinct from 'permitted'
   or ad.authority->>'purpose' is distinct from 'clinical_retrieval'
   or ad.authority->>'currentness' is distinct from 'current' or ad.authority->'supportedFeatures' is distinct from '["text"]'::jsonb
   or (ad.authority->>'effectiveDate')::date>current_date or (ad.authority->>'expiryDate')::date<=current_date
   or (ad.authority->>'reviewDate')::date<=current_date
   then raise exception 'managed_admin_text_admission_mismatch';end if;
 select * into original from ingestion_generation_evidence.retained_artifacts
   where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source';
 if not found or original.representation<>'original_binary' or original.sha256 is distinct from c.source_sha256
   or original.byte_length is distinct from c.source_byte_length or original.byte_length<>octet_length(original.artifact_bytes)
   or original.sha256<>'sha256:'||encode(extensions.digest(original.artifact_bytes,'sha256'),'hex') then raise exception 'managed_admin_text_original_mismatch';end if;
 source_text:=convert_from(original.artifact_bytes,'UTF8');
 if convert_to(source_text,'UTF8')<>original.artifact_bytes or btrim(source_text)='' then raise exception 'managed_admin_text_utf8';end if;
 if p_packet->'quality'->'metrics'->'page_count' is distinct from '1'::jsonb
   or p_packet->'quality'->'metrics'->'ocr_page_count' is distinct from '0'::jsonb
   or p_packet->'quality'->'metrics'->'needs_ocr_page_count' is distinct from '0'::jsonb
   or p_packet->'quality'->'metrics'->'extracted_image_count' is distinct from '0'::jsonb
   or p_packet->'quality'->'metrics'->'searchable_image_count' is distinct from '0'::jsonb
   then raise exception 'managed_admin_text_quality_mismatch';end if;
 select * into witness from ingestion_generation_evidence.retained_artifacts
   where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source-expectation-witness';
 if not found or witness.representation<>'source_expectation_witness' or witness.sha256 is distinct from c.source_expectation->'witness'->>'sha256'
   or witness.source_sha256<>c.source_sha256 or witness.sha256<>'sha256:'||encode(extensions.digest(witness.artifact_bytes,'sha256'),'hex')
   or witness.byte_length<>octet_length(witness.artifact_bytes) or c.source_expectation->>'tag' is distinct from 'known'
   or convert_from(c.source_expectation_bytes,'UTF8')::jsonb is distinct from c.source_expectation
   or c.source_expectation_digest<>'sha256:'||encode(extensions.digest(c.source_expectation_bytes,'sha256'),'hex')
   then raise exception 'managed_admin_text_witness_mismatch';end if;
 w:=convert_from(witness.artifact_bytes,'UTF8')::jsonb;
 if not ingestion_generation_evidence.keys(w,array['version','qualification','sourceSha256','sourceByteLength','sourceUnits','groups'])
   or w->>'version' is distinct from 'ingestion-original-applicability-v1' or w->>'qualification' is distinct from 'independently_declared_unverified'
   or w->>'sourceSha256' is distinct from c.source_sha256 or w->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
   or w->'sourceUnits' is distinct from c.source_expectation->'units' or jsonb_typeof(w->'groups') is distinct from 'array'
   or jsonb_array_length(w->'groups')<>5 or (select count(distinct value->>'family') from jsonb_array_elements(w->'groups'))<>5
   then raise exception 'managed_admin_text_original_population_mismatch';end if;
 for g in select value from jsonb_array_elements(w->'groups') loop
   if not ingestion_generation_evidence.keys(g,array['family','population']) or g->>'family' not in ('chunks','images','table_facts','embedding_fields','index_units')
     or not ingestion_generation_evidence.keys(g->'population',array['tag','requirements','basis','reason'])
     or g->'population'->>'tag' is distinct from 'known' or jsonb_typeof(g->'population'->'requirements') is distinct from 'array'
     or g->'population'->'basis' is distinct from '{"scope":"whole_original","kind":"independent_original_declaration"}'::jsonb
     then raise exception 'managed_admin_text_original_population_mismatch';end if;
   if g->>'family'='chunks' then
     if jsonb_array_length(g->'population'->'requirements')=0 or g->'population'->'reason' is distinct from 'null'::jsonb then raise exception 'managed_admin_text_original_population_mismatch';end if;
     if (select count(distinct value->>'id') from jsonb_array_elements(g->'population'->'requirements'))<>jsonb_array_length(g->'population'->'requirements') then raise exception 'managed_admin_text_source_obligation_mismatch';end if;
     for r in select value from jsonb_array_elements(g->'population'->'requirements') loop
       if not ingestion_generation_evidence.keys(r,array['id','required','sourceEvidenceIds']) or r->'required' is distinct from 'true'::jsonb
         or jsonb_typeof(r->'sourceEvidenceIds') is distinct from 'array' or jsonb_array_length(r->'sourceEvidenceIds')<1
         or (select count(distinct value) from jsonb_array_elements(r->'sourceEvidenceIds'))<>jsonb_array_length(r->'sourceEvidenceIds')
         or exists(select 1 from jsonb_array_elements_text(r->'sourceEvidenceIds') ref where not exists(select 1 from jsonb_array_elements(w->'sourceUnits') su where su.value->>'id'=ref))
         or exists(select 1 from jsonb_array_elements(w->'sourceUnits') su cross join lateral jsonb_array_elements_text(su.value->'dependencies') dep
           where r->'sourceEvidenceIds' ? (su.value->>'id') and not (r->'sourceEvidenceIds' ? dep))
         then raise exception 'managed_admin_text_source_obligation_mismatch';end if;
     end loop;
   elsif g->'population'->'requirements'<>'[]'::jsonb or g->'population'->>'reason' is distinct from 'no_original_requirements_in_scope'
     then raise exception 'managed_admin_text_unsupported_original_requirements';end if;
 end loop;
 if jsonb_array_length(w->'sourceUnits')<1 then raise exception 'managed_admin_text_source_coverage_gap';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(w->'sourceUnits'))<>jsonb_array_length(w->'sourceUnits')
   or exists(select 1 from jsonb_array_elements(w->'sourceUnits') su where not ingestion_generation_evidence.keys(su.value,array['id','required','dependencies','locator','nativeMapping'])
     or jsonb_typeof(su.value->'required') is distinct from 'boolean' or jsonb_typeof(su.value->'dependencies') is distinct from 'array' or su.value->>'nativeMapping' is distinct from 'unavailable'
     or exists(select 1 from jsonb_array_elements_text(su.value->'dependencies') dep where not exists(select 1 from jsonb_array_elements(w->'sourceUnits') parent where parent.value->>'id'=dep)))
   then raise exception 'managed_admin_text_source_obligation_mismatch';end if;
 if exists(with recursive edges as (
   select su.value->>'id' as root,su.value->>'id' as node,array[su.value->>'id']::text[] as path,false as cycle from jsonb_array_elements(w->'sourceUnits') su
   union all select edges.root,dep,array_append(edges.path,dep),dep=any(edges.path) from edges join lateral jsonb_array_elements(w->'sourceUnits') su on su.value->>'id'=edges.node cross join lateral jsonb_array_elements_text(su.value->'dependencies') dep where not edges.cycle)
   select 1 from edges where cycle) then raise exception 'managed_admin_text_source_dependency_cycle';end if;
 for u in select value from jsonb_array_elements(w->'sourceUnits') order by split_part(value->>'locator',':',2)::integer,split_part(value->>'locator',':',3)::integer loop
   if coalesce(u->>'locator','') !~ '^utf8-bytes:(0|[1-9][0-9]*):([1-9][0-9]*)$' then raise exception 'managed_admin_text_source_locator';end if;
   start_byte:=split_part(u->>'locator',':',2)::integer;end_byte:=split_part(u->>'locator',':',3)::integer;
   if start_byte>source_covered or start_byte>=end_byte or end_byte>c.source_byte_length then raise exception 'managed_admin_text_source_coverage_gap';end if;
   perform convert_from(substring(original.artifact_bytes from start_byte+1 for end_byte-start_byte),'UTF8');
   source_covered:=greatest(source_covered,end_byte);
   if u->'required'='true'::jsonb and not exists(select 1 from jsonb_array_elements(w->'groups') gr cross join lateral jsonb_array_elements(gr.value->'population'->'requirements') req where gr.value->>'family'='chunks' and req.value->'sourceEvidenceIds' ? (u->>'id')) then raise exception 'managed_admin_text_source_obligation_mismatch';end if;
 end loop;
 if source_covered<>c.source_byte_length then raise exception 'managed_admin_text_source_coverage_gap';end if;
 -- TXT has one exact logical page. Unknown generic native diagnostics are superseded
 -- only for this type by direct original/extracted/persisted UTF8 byte identity.
 for retained in select * from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id loop
   if retained.sha256<>'sha256:'||encode(extensions.digest(retained.artifact_bytes,'sha256'),'hex') or retained.byte_length<>octet_length(retained.artifact_bytes) or retained.source_sha256<>c.source_sha256 then raise exception 'managed_admin_text_retained_mismatch';end if;
 end loop;
 if (select count(*) from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='pages')<>1
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='page:1:extracted' and artifact_bytes=original.artifact_bytes and representation='extracted_utf8')
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='page:1:persisted' and artifact_bytes=original.artifact_bytes and representation='persisted_utf8')
   then raise exception 'managed_admin_text_page_mismatch';end if;
 select convert_from(artifact_bytes,'UTF8')::jsonb into strict b from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='pages' and unit_key='1' and representation='page_projection';
 if b->>'text' is distinct from source_text or b->'page_number' is distinct from '1'::jsonb or b->'ocr_used' is distinct from 'false'::jsonb then raise exception 'managed_admin_text_page_mismatch';end if;
 pages:=jsonb_build_array(b);
 if exists(select 1 from ingestion_generation_evidence.unit_declarations d left join ingestion_generation_evidence.outcomes o using(document_id,generation_id,family,unit_key)
   where d.document_id=c.document_id and d.generation_id=c.generation_id and d.declaration->'required'='true'::jsonb
     and not (d.family='attempt_control' and d.unit_key='preseal_checkpoint')
     and (o.outcome->>'disposition' is distinct from 'retained' or not exists(select 1 from ingestion_generation_evidence.retained_artifacts art where art.document_id=d.document_id and art.generation_id=d.generation_id and art.family=d.family and art.unit_key=d.unit_key and art.sha256=o.outcome->>'artifactSha256')))
   or exists(select 1 from ingestion_generation_evidence.unit_declarations d cross join lateral jsonb_array_elements(d.declaration->'dependencies') dep where d.document_id=c.document_id and d.generation_id=c.generation_id and not exists(select 1 from ingestion_generation_evidence.outcomes o where o.document_id=c.document_id and o.generation_id=c.generation_id and o.family=dep.value->>'family' and o.unit_key=dep.value->>'key' and o.outcome->>'disposition'='retained'))
   then raise exception 'managed_admin_text_required_retention_missing';end if;
 if (select count(*) from ingestion_generation_evidence.candidate_chunk_rows where document_id=c.document_id and index_generation_id=c.generation_id)<>chunk_total
   or (select count(*) from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family='chunks')<>2*chunk_total
   or exists(select 1 from ingestion_generation_evidence.scoped_projection_rows where document_id=c.document_id and generation_id=c.generation_id)
   or exists(select 1 from ingestion_generation_evidence.visual_unit_rows where document_id=c.document_id and generation_id=c.generation_id)
   or exists(select 1 from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family not in ('private_objects','pages','chunks','document_metadata','quality','attempt_control') and not (p_packet->>'version'='managed-admin-text-complete-v2' and family='sections'))
   or exists(select 1 from ingestion_generation_evidence.managed_vector_packets where document_id=c.document_id and generation_id=c.generation_id)
   then raise exception 'managed_admin_text_chunk_population_mismatch';end if;
 for r in select value from jsonb_array_elements(p_packet->'chunks') loop
   if not ingestion_generation_evidence.keys(r,array['id','chunkIndex','start','end','sha256'])
     or r->'chunkIndex' is distinct from to_jsonb(chunk_index) or r->'start' is distinct from to_jsonb(cursor_byte)
     or (r->>'end')::integer<=cursor_byte or (r->>'end')::integer>c.source_byte_length then raise exception 'managed_admin_text_chunk_coverage_mismatch';end if;
   select * into strict candidate_row from ingestion_generation_evidence.candidate_chunk_rows where id=(r->>'id')::uuid and document_id=c.document_id and index_generation_id=c.generation_id;
   select * into strict prepared from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=candidate_row.id::text||':prepared';
   select * into strict final from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=candidate_row.id::text||':final';
   public_row:=jsonb_populate_record(null::public.document_chunks,to_jsonb(candidate_row));
   actual:=(to_jsonb(public_row)-array['created_at','search_tsv','embedding'])||jsonb_build_object('embedding',(public_row.embedding::text)::jsonb);
   b:=convert_from(final.artifact_bytes,'UTF8')::jsonb;
   if candidate_row.chunk_index<>chunk_index or candidate_row.page_number<>1 or candidate_row.candidate_owner_id is distinct from (identity->>'ownerId')::uuid
     or candidate_row.candidate_job_id<>c.job_id or candidate_row.candidate_lease_token<>c.first_lease_token or candidate_row.candidate_authority_digest<>c.authority_digest
     or candidate_row.candidate_source_sha256<>c.source_sha256 or candidate_row.candidate_source_expectation_digest<>c.source_expectation_digest
     or candidate_row.candidate_prepared_sha256<>prepared.sha256 or candidate_row.embedding is null or jsonb_array_length((candidate_row.embedding::text)::jsonb)<>1536
     or not exists(select 1 from jsonb_array_elements_text((candidate_row.embedding::text)::jsonb) coordinate where coordinate::double precision<>0)
     or candidate_row.image_ids<>'{}'::uuid[] or candidate_row.retrieval_synopsis is not null
     or convert_to(candidate_row.content,'UTF8')<>substring(original.artifact_bytes from cursor_byte+1 for (r->>'end')::integer-cursor_byte)
     or r->>'sha256'<>'sha256:'||encode(extensions.digest(convert_to(candidate_row.content,'UTF8'),'sha256'),'hex')
     or b->'row' is distinct from actual or b->>'preparedSha256' is distinct from prepared.sha256
     or (convert_from(prepared.artifact_bytes,'UTF8')::jsonb)->'row' is distinct from (actual-'embedding')||jsonb_build_object('metadata',(actual->'metadata')-array['ingestion_job_id','ingestion_job_kind','ingestion_lease_token'])
     then raise exception 'managed_admin_text_chunk_readback_mismatch';end if;
   cursor_byte:=(r->>'end')::integer;chunk_index:=chunk_index+1;
 end loop;
 if cursor_byte<>c.source_byte_length then raise exception 'managed_admin_text_chunk_coverage_mismatch';end if;
 select 'sha256:'||encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_object('key',unit_key,'sha256',sha256,'byteLength',byte_length) order by unit_key)::text,'UTF8'),'sha256'),'hex') into digest from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks';
 if p_packet->>'version'='managed-admin-text-complete-v2' then
   if j.status='completed' then
     -- All generations: an old-generation row must not move into the checked population.
     perform 1 from public.document_sections where document_id=c.document_id order by id for share;
     perform 1 from public.document_index_quality where document_id=c.document_id order by document_id for share;
   end if;
   perform ingestion_generation_evidence.assert_admin_text_sections(c,p_packet,j.status='completed');
   if p_packet->'quality' is distinct from ingestion_generation_evidence.admin_text_quality(c,jsonb_array_length(p_packet->'sections')) then raise exception 'managed_admin_text_quality_mismatch';end if;
 end if;
 seal:=jsonb_build_object('version','managed-admin-text-seal-v1','scope','whole_retained_utf8_txt','activated',true,'packet',p_packet,
   'chunkPopulationDigest',digest,'sourceWitnessSha256',witness.sha256,
   'nativeFidelity','whole_original_extracted_persisted_utf8_bytes_equal','sourceCompleteness','whole_original_byte_domain_covered',
   'deferredOptionalFamilies',jsonb_build_array('embedding_fields','index_units','table_facts','images','summary','generated_labels','sections','memory_cards','producer_aliases','cache_inputs'),
   'clinicalApproval','not_assessed','publicationApproval','not_granted');
 if p_packet->>'version'='managed-admin-text-complete-v2' then
   seal:=seal||jsonb_build_object('sectionsVersion','managed-admin-text-sections-v2','deferredOptionalFamilies',(seal->'deferredOptionalFamilies')-'sections');
 end if;
 digest:='sha256:'||encode(extensions.digest(convert_to(seal::text,'UTF8'),'sha256'),'hex');
 if j.status='completed' then
   select * into strict prior from ingestion_generation_evidence.prerequisite_accounting where document_id=c.document_id and generation_id=c.generation_id and snapshot->>'version'='managed-admin-text-seal-v1';
   if prior.snapshot is distinct from seal or prior.snapshot_digest<>digest or j.stage<>'admin_text_completed' or j.locked_by is not null
     or j.lease_expires_at is not null or j.next_run_at is not null or j.lease_expected_generation_id is distinct from c.generation_id
     or (a->'document'->>'index_generation_id')::uuid is distinct from c.generation_id
     or (select count(*) from public.document_chunks where document_id=c.document_id and index_generation_id=c.generation_id)<>chunk_total
     or exists(select 1 from ingestion_generation_evidence.candidate_chunk_rows cr left join public.document_chunks pr on pr.id=cr.id where cr.document_id=c.document_id and cr.index_generation_id=c.generation_id and (pr.id is null or (to_jsonb(pr)-array['created_at','search_tsv']) is distinct from (to_jsonb(jsonb_populate_record(null::public.document_chunks,to_jsonb(cr)))-array['created_at','search_tsv'])))
     or not exists(select 1 from public.document_pages where document_id=c.document_id and index_generation_id=c.generation_id and page_number=1 and text=source_text and not ocr_used)
     or (select count(*) from public.document_pages where document_id=c.document_id and index_generation_id=c.generation_id)<>1
     or exists(select 1 from public.document_images where document_id=c.document_id and index_generation_id=c.generation_id)
     or not exists(select 1 from public.document_index_quality where document_id=c.document_id and owner_id=(identity->>'ownerId')::uuid and quality_score=(p_packet->'quality'->>'quality_score')::real and extraction_quality=p_packet->'quality'->>'extraction_quality' and metrics->>'admin_text_seal_digest'=digest)
     or not exists(select 1 from ingestion_generation_evidence.retained_artifacts art join ingestion_generation_evidence.outcomes o using(document_id,generation_id,family,unit_key) where art.document_id=c.document_id and art.generation_id=c.generation_id and art.family='attempt_control' and art.unit_key='preseal_checkpoint' and o.outcome->>'artifactSha256'=art.sha256 and o.outcome->>'disposition'='retained' and (convert_from(art.artifact_bytes,'UTF8')::jsonb)->'terminalPacket'=p_packet)
     then raise exception 'managed_admin_text_replay_mismatch';end if;
   if p_packet->>'version'='managed-admin-text-complete-v2' then perform ingestion_generation_evidence.assert_admin_text_quality_state(c,p_packet,digest);end if;
   result:=jsonb_build_object('status','admin_text_completed','replay','already_completed','activated',true);
 else
   if p_read_only or j.status<>'processing' or j.locked_by is distinct from p_fence->>'worker_id' or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
     or j.lease_expected_generation_id is distinct from c.predecessor_generation_id or (a->'document'->>'index_generation_id')::uuid is distinct from c.predecessor_generation_id
     then raise exception 'managed_admin_text_current_attempt_required';end if;
   if public.assert_current_ingestion_attempt(p_fence,p_generation) is null then raise exception 'managed_admin_text_current_attempt_required';end if;
   -- Generic producers remain unable to mint preseal credit. This terminal alone
   -- retains the server-produced checkpoint at the checked activation boundary.
   select * into strict retained from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='attempt_control' and unit_key='claim_checkpoint';
   b:=convert_from(retained.artifact_bytes,'UTF8')::jsonb;
   if (b-array['version','phase','qualification']) is distinct from (identity-'ownerId') or b->>'version' is distinct from 'ingestion-attempt-control-v1' or b->>'phase' is distinct from 'claim' or b->>'qualification' is distinct from 'derived_unverified'
     or not exists(select 1 from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family='attempt_control' and unit_key='preseal_checkpoint' and declaration->'dependencies'='[{"family":"attempt_control","key":"claim_checkpoint"},{"family":"private_objects","key":"original-source"}]'::jsonb)
     then raise exception 'managed_admin_text_attempt_control_mismatch';end if;
   b:=b||jsonb_build_object('phase','preseal','terminalVersion','managed-admin-text-complete-v1','terminalPacket',p_packet);
   bytes:=convert_to(b::text,'UTF8');
   insert into ingestion_generation_evidence.retained_artifacts(document_id,generation_id,family,unit_key,group_key,representation,source_sha256,artifact_bytes,sha256,byte_length,locator)
     values(c.document_id,c.generation_id,'attempt_control','preseal_checkpoint','control','provenance_json',c.source_sha256,bytes,'sha256:'||encode(extensions.digest(bytes,'sha256'),'hex'),octet_length(bytes),'ingestion_attempt:admin_text_preseal');
   insert into ingestion_generation_evidence.outcomes(document_id,generation_id,family,unit_key,group_key,outcome)
     values(c.document_id,c.generation_id,'attempt_control','preseal_checkpoint','control',jsonb_build_object('unitId',jsonb_build_object('family','attempt_control','key','preseal_checkpoint'),'groupKey','control','disposition','retained','artifactSha256','sha256:'||encode(extensions.digest(bytes,'sha256'),'hex'),'limitation',null));
   insert into ingestion_generation_evidence.prerequisite_accounting(document_id,generation_id,snapshot_digest,snapshot) values(c.document_id,c.generation_id,digest,seal);
   insert into public.document_chunks(id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,retrieval_synopsis,content_hash,index_generation_id,token_estimate,image_ids,metadata,embedding)
     select cr.id,cr.document_id,cr.page_number,cr.chunk_index,cr.section_heading,cr.section_path,cr.heading_level,cr.parent_heading,cr.anchor_id,cr.content,cr.retrieval_synopsis,cr.content_hash,cr.index_generation_id,cr.token_estimate,cr.image_ids,cr.metadata,cr.embedding from ingestion_generation_evidence.candidate_chunk_rows cr where cr.document_id=c.document_id and cr.index_generation_id=c.generation_id;
   if p_packet->>'version'='managed-admin-text-complete-v2' then
     for r in select value from jsonb_array_elements(p_packet->'sections') loop
       b:=r->'body'||jsonb_build_object('id',r->'id','index_generation_id',p_generation,'producer','local-worker','artifact_generation_id',p_generation);
       insert into public.document_sections(id,document_id,owner_id,section_index,heading,heading_path,page_start,page_end,chunk_ids,summary,tags,extraction_quality,index_generation_id,producer,artifact_generation_id,metadata)
         select sr.id,sr.document_id,sr.owner_id,sr.section_index,sr.heading,sr.heading_path,sr.page_start,sr.page_end,sr.chunk_ids,sr.summary,sr.tags,sr.extraction_quality,sr.index_generation_id,sr.producer,sr.artifact_generation_id,sr.metadata from jsonb_populate_record(null::public.document_sections,b) sr;
     end loop;
     perform ingestion_generation_evidence.assert_admin_text_sections(c,p_packet,true);
   end if;
   quality:=p_packet->'quality'||jsonb_build_object('metrics',p_packet->'quality'->'metrics'||jsonb_build_object('source_byte_length',c.source_byte_length,'text_byte_equality',true,'chunk_byte_coverage',true,'chunk_count',chunk_total,'admin_text_seal_digest',digest));
   perform set_config('psychsift.admin_text_terminal_owner',c.document_id::text||':'||c.job_id::text,true);
   -- The immutable terminal receipt and quality row carry the technical proof.
   -- Keep the existing managed metadata-patch refusal intact.
   result:=public.commit_document_index_generation(p_fence,p_generation,1,chunk_total,0,'{}'::jsonb,pages,quality);
   if result->'ok' is distinct from 'true'::jsonb then raise exception 'managed_admin_text_commit_failed';end if;
   next_fence:=result->'fence';
   if p_packet->>'version'='managed-admin-text-complete-v2' then
     -- Terminal-owned quality delta only; generic managed metadata patches still refuse.
     update public.documents set metadata=metadata||jsonb_build_object('extraction_quality',quality->'extraction_quality',
       'index_quality_score',quality->'quality_score','index_quality_issues',quality->'issues','index_quality_metrics',quality->'metrics',
       'section_count',jsonb_array_length(p_packet->'sections'),'memory_card_count',0),updated_at=clock_timestamp() where id=c.document_id;
     if (public.lock_ingestion_document_authority(c.document_id,false))->>'authority_digest' is distinct from c.authority_digest then raise exception 'managed_admin_text_authority_mismatch';end if;
     perform ingestion_generation_evidence.assert_admin_text_quality_state(c,p_packet,digest);
   end if;
   result:=public.complete_ingestion_job(next_fence,j.batch_id,'admin_text_completed');
   if result->'ok' is distinct from 'true'::jsonb then raise exception 'managed_admin_text_completion_failed';end if;
   update public.ingestion_jobs set next_run_at=null,lease_expires_at=null,lease_duration_seconds=null where id=c.job_id;
   perform set_config('psychsift.admin_text_terminal_owner','',true);
   result:=jsonb_build_object('status','admin_text_completed','replay','completed','activated',true);
 end if;
 bytes:=convert_to(seal::text,'UTF8');
 return jsonb_build_object('ok',true,'managedAdminTextTerminal',result||jsonb_build_object('seal',jsonb_build_object('bytesHex',encode(bytes,'hex'),'sha256',digest,'byteLength',octet_length(bytes))));
exception when invalid_text_representation or character_not_in_repertoire or numeric_value_out_of_range then raise exception 'managed_admin_text_invalid_source';
end $$;

-- selected function public.update_indexing_v3_agent_job_status
create or replace function public.update_indexing_v3_agent_job_status(p_fence jsonb, p_status text, p_error text, p_next_run_at timestamptz, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_status text; v_batch uuid; v_pending integer; v_processing integer; v_failed integer;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_fence->>'job_kind'<>'indexing_v3' or coalesce(p_status,'') not in ('completed','failed','deferred','needs_enrichment_artifacts')
    or jsonb_typeof(p_metadata) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_metadata) k where k <> all(array['completion_gate','completion_gate_missing','indexing_v3_agent_deferral_count','indexing_v3_agent_repair_reason'])) then raise exception 'invalid_indexing_agent_status'; end if;
  if p_status='completed' and not exists(select 1 from public.document_strict_gate_status where document_id=v_document_id and gate_passed) then return jsonb_build_object('ok',false,'reason','completion_gate_blocked'); end if;
  v_status := case when p_status in ('deferred','failed') and (v_locked->'job'->>'attempt_count')::integer >= (v_locked->'job'->>'max_attempts')::integer then 'needs_enrichment_artifacts' when p_status='deferred' then 'pending' else p_status end;
  v_batch := (v_locked->'document'->>'import_batch_id')::uuid;
  if v_batch is not null then perform 1 from public.import_batches where id=v_batch for update; end if;
  update public.documents set metadata=public.jsonb_merge_deep(metadata,p_metadata || jsonb_build_object('indexing_v3_agent_status',v_status,
    'indexing_v3_agent_last_error',p_error,'enrichment_status',case when v_status='completed' then 'completed' when v_status='needs_enrichment_artifacts' then v_status else 'pending' end)),updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  update public.indexing_v3_agent_jobs set status=v_status,last_error=p_error,locked_by=null,locked_at=null,
    next_run_at=case when v_status in ('completed','needs_enrichment_artifacts') then null else p_next_run_at end,
    enrichment_status=case when v_status='completed' then 'completed' when v_status='needs_enrichment_artifacts' then v_status else 'pending' end,updated_at=pg_catalog.clock_timestamp()
  where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='indexing_v3'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  if v_batch is not null then
    select count(*) filter(where status='pending'),count(*) filter(where status='processing'),count(*) filter(where status='failed')
      into v_pending,v_processing,v_failed from public.ingestion_jobs where batch_id=v_batch;
    update public.import_batches set status=case when v_pending+v_processing>0 then 'processing' when v_failed>0 then 'completed_with_errors' else 'completed' end,
      failed_files=v_failed,completed_at=case when v_pending+v_processing>0 then null else pg_catalog.clock_timestamp() end where id=v_batch;
  end if;
  return jsonb_build_object('ok',true,'status',v_status);
end $$;

-- selected function public.complete_strict_enrichment_job
create or replace function public.complete_strict_enrichment_job(p_fence jsonb, p_stage text, p_agent_version text, p_visual_indexing_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_gate record; v_result jsonb;
begin
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if exists(select 1 from ingestion_generation_evidence.candidates where document_id=(p_fence->>'document_id')::uuid and job_id=(p_fence->>'job_id')::uuid) then return jsonb_build_object('ok',false,'reason','technical_supplier_not_implemented'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  select * into v_gate from public.document_strict_gate_status where document_id=v_document_id;
  if not found or not v_gate.gate_passed then return jsonb_build_object('ok',false,'reason','completion_gate_blocked','missing',coalesce(to_jsonb(v_gate.missing),'[]'::jsonb)); end if;
  update public.documents set metadata=jsonb_strip_nulls(
    (coalesce(metadata,'{}'::jsonb)
      - 'indexing_v3_agent_locked_by'
      - 'indexing_v3_agent_locked_at'
      - 'indexing_v3_agent_next_run_at'
      - 'indexing_v3_agent_last_error'
      - 'completion_gate_missing')
    || jsonb_build_object(
      'enrichment_status','completed',
      'indexing_v3_agent_status','completed',
      'indexing_v3_agent_version',p_agent_version,
      'indexing_v3_agent_updated_at',pg_catalog.clock_timestamp(),
      'indexing_v3_agent_deferral_count',0,
      'visual_indexing_version',p_visual_indexing_version,
      'completion_gate',jsonb_build_object(
        'result','complete','missing',v_gate.missing,'counts',v_gate.counts,'presence',v_gate.presence,
        'source','complete_strict_enrichment_job'))),updated_at=pg_catalog.clock_timestamp()
    where id=v_document_id;
  -- U10 owns admission/coverage receipts. Record the observed gate without
  -- promoting extraction_quality, inflating quality_score or clearing issues.
  update public.document_index_quality set
    metrics=public.jsonb_merge_deep(metrics,jsonb_build_object('strict_enrichment_gate',jsonb_build_object(
      'result','complete','counts',v_gate.counts,'presence',v_gate.presence,'source','complete_strict_enrichment_job'))),
    updated_at=pg_catalog.clock_timestamp()
    where document_id=v_document_id;
  if p_fence->>'job_kind'='node' then
    v_result := public.complete_ingestion_job(p_fence,(v_locked->'job'->>'batch_id')::uuid,p_stage);
  else
    v_result := public.update_indexing_v3_agent_job_status(p_fence,'completed',null,null,'{}'::jsonb);
  end if;
  if v_result->'ok' is distinct from 'true'::jsonb then raise exception 'ingestion_mutation_row_count'; end if;
  return v_result;
end $$;

-- selected function public.declare_ingestion_generation_evidence
create function public.declare_ingestion_generation_evidence(p_fence jsonb,p_generation uuid,p_declarations jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c ingestion_generation_evidence.candidates;begin
  c:=ingestion_generation_evidence.lock_candidate(p_fence,p_generation);
  if c is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  perform ingestion_generation_evidence.declare_groups(c,p_declarations);
  return jsonb_build_object('ok',true);
end $$;

-- selected function public.document_publication_state_digest
create or replace function public.document_publication_state_digest(
  p_document_id uuid,
  p_expected_owner_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'document', to_jsonb(d) - array['owner_id', 'created_at', 'updated_at', 'search_tsv', 'title_search_tsv'] - case when d.page_storage_mode='legacy_unqualified' then array['page_storage_mode'] else array[]::text[] end,
          'pages', coalesce((
            select jsonb_agg(to_jsonb(p) - array['created_at', 'updated_at'] - case when d.page_storage_mode='legacy_unqualified' then array['index_generation_id'] else array[]::text[] end order by p.page_number, p.id)
            from public.document_pages p where p.document_id = d.id and public.is_visible_document_page(p.index_generation_id,d.index_generation_id,d.page_storage_mode)
          ), '[]'::jsonb),
          'images', coalesce((
            select jsonb_agg(to_jsonb(i) - array['created_at', 'updated_at'] order by i.page_number nulls last, i.id)
            from public.document_images i
            where i.document_id = d.id
              and (
                nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '') is null
                or public.is_committed_artifact_generation(i.metadata, d.metadata)
              )
          ), '[]'::jsonb),
          'labels', coalesce((
            select jsonb_agg(to_jsonb(l) - array['owner_id', 'created_at', 'updated_at'] order by l.id)
            from public.document_labels l where l.document_id = d.id
          ), '[]'::jsonb),
          'summaries', coalesce((
            select jsonb_agg(to_jsonb(s) - array['owner_id', 'created_at', 'updated_at'] order by s.id)
            from public.document_summaries s where s.document_id = d.id
          ), '[]'::jsonb),
          'sections', coalesce((
            select jsonb_agg(to_jsonb(s) - array['owner_id', 'created_at', 'updated_at'] order by s.section_index, s.id)
            from public.document_sections s
            where s.document_id = d.id
              and public.is_committed_artifact_generation(s.metadata, d.metadata)
          ), '[]'::jsonb),
          'memory_cards', coalesce((
            select jsonb_agg(
              to_jsonb(m) - array['owner_id', 'embedding', 'search_tsv', 'created_at', 'updated_at']
              order by m.id
            )
            from public.document_memory_cards m
            where m.document_id = d.id
              and (
                nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '') is null
                or public.is_committed_artifact_generation(m.metadata, d.metadata)
              )
          ), '[]'::jsonb),
          'chunks', coalesce((
            select jsonb_agg(to_jsonb(c) - array['embedding', 'search_tsv', 'created_at'] order by c.chunk_index, c.id)
            from public.document_chunks c
            where c.document_id = d.id
              and (
                public.is_committed_document_generation(c.index_generation_id, d.index_generation_id)
                or nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '') is null
                or public.is_committed_artifact_generation(c.metadata, d.metadata)
              )
          ), '[]'::jsonb),
          'table_facts', coalesce((
            select jsonb_agg(to_jsonb(f) - array['owner_id', 'search_tsv', 'created_at'] order by f.id)
            from public.document_table_facts f
            where f.document_id = d.id
              and (
                nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '') is null
                or public.is_committed_artifact_generation(f.metadata, d.metadata)
              )
          ), '[]'::jsonb),
          'embedding_fields', coalesce((
            select jsonb_agg(
              to_jsonb(f) - array['owner_id', 'embedding', 'search_tsv', 'created_at']
              order by f.id
            )
            from public.document_embedding_fields f
            where f.document_id = d.id
              and public.is_committed_artifact_generation(f.metadata, d.metadata)
          ), '[]'::jsonb),
          'index_quality', coalesce((
            select to_jsonb(q) - array['owner_id', 'updated_at']
            from public.document_index_quality q where q.document_id = d.id
          ), '{}'::jsonb),
          'index_units', coalesce((
            select jsonb_agg(
              to_jsonb(u) - array['owner_id', 'embedding', 'search_tsv', 'created_at', 'updated_at']
              order by u.id
            )
            from public.document_index_units u
            where u.document_id = d.id
              and public.is_committed_artifact_generation(u.metadata, d.metadata)
          ), '[]'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.documents d
  where d.id = p_document_id
    and d.owner_id = p_expected_owner_id;
$$;

-- selected function public.fail_or_retry_ingestion_job
create or replace function public.fail_or_retry_ingestion_job(p_fence jsonb, p_batch_id uuid, p_retry boolean, p_stage text, p_error_message text, p_next_run_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_retry boolean; v_batch uuid; v_pending integer; v_processing integer; v_failed integer;
  v_generation uuid; c ingestion_generation_evidence.candidates; v_managed boolean := false;
  v_audit_status jsonb; v_audit_error text;
  v_unit jsonb; v_plan jsonb; v_audit jsonb; v_bytes bytea; v_hash text; v_manifest text;
  v_document_status text; v_job_status text; v_actual_document_status text; v_actual_job_status text; v_actual_next_run_at timestamptz;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  v_batch := (v_locked->'job'->>'batch_id')::uuid;
  if p_batch_id is not null and p_batch_id is distinct from v_batch then raise exception 'ingestion_batch_identity_mismatch'; end if;
  if v_batch is not null then perform 1 from public.import_batches where id=v_batch for update; end if;
  if p_retry is null then raise exception 'invalid_ingestion_retry'; end if;
  v_retry := p_retry and (v_locked->'job'->>'attempt_count')::integer < (v_locked->'job'->>'max_attempts')::integer;
  v_generation := (v_locked->'job'->>'lease_write_generation_id')::uuid;
  if exists(select 1 from ingestion_generation_evidence.candidates where document_id=v_document_id and generation_id=v_generation) then
    c := ingestion_generation_evidence.lock_candidate(p_fence,v_generation);
    if c is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
    begin
      -- Never adopt caller-populated repair evidence as this transition's observation.
      if exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='repair_audit_inputs')
        or exists(select 1 from ingestion_generation_evidence.outcomes where document_id=c.document_id and generation_id=c.generation_id and family='repair_audit_inputs')
        then raise exception 'ingestion_failure_audit_already_retained'; end if;
      if not exists(select 1 from ingestion_generation_evidence.retained_artifacts
        where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source'
          and representation='original_binary' and source_sha256=c.source_sha256 and sha256=c.source_sha256 and byte_length=c.source_byte_length)
        then raise exception 'ingestion_failure_audit_original_required'; end if;
      v_unit := jsonb_build_object('id',jsonb_build_object('family','repair_audit_inputs','key','failure_transition'),
        'groupKey','repair','required',true,'dependencies',jsonb_build_array(jsonb_build_object('family','private_objects','key','original-source')),
        'sourceEvidenceIds','[]'::jsonb,'qualification','derived_unverified','representation','provenance_json');
      v_manifest := 'sha256:'||encode(extensions.digest(convert_to(jsonb_build_array(v_unit)::text,'UTF8'),'sha256'),'hex');
      v_plan := jsonb_build_object('version',1,'groups',jsonb_build_array(jsonb_build_object('family','repair_audit_inputs','groupKey','repair',
        'declaration',jsonb_build_object('producer',jsonb_build_object('name','fenced_failure_transition','version','ingestion-failure-audit-v1','outputManifestDigest',v_manifest),
          'artifactGenerationId',null,'population',jsonb_build_object('tag','known','expectedUnits',jsonb_build_array(v_unit->'id'),
            'basis',jsonb_build_array(jsonb_build_object('reference','locked_failed_attempt_transition','sha256',c.source_sha256)),'reason',null)))),
        'units',jsonb_build_array(v_unit));
      -- The complete one-event plan is immutable before any artifact or failure effect.
      perform ingestion_generation_evidence.declare_groups(c,v_plan);
      v_document_status := case when v_locked->'document'->>'index_generation_id' is not null then 'indexed' when v_retry then 'queued' else 'failed' end;
      v_job_status := case when v_retry then 'pending' else 'failed' end;
      v_audit := jsonb_build_object(
        'version','ingestion-failure-audit-v1','phase','failed_attempt_transition','scope','observed_failure_transition_only','qualification','derived_unverified',
        'documentId',c.document_id,'generationId',c.generation_id,'jobId',c.job_id,
        'attemptNumber',(v_locked->'job'->>'attempt_count')::integer,'maxAttempts',(v_locked->'job'->>'max_attempts')::integer,
        'batchId',v_batch,'authorityDigest',c.authority_digest,'predecessorGenerationId',c.predecessor_generation_id,
        'sourceSha256',c.source_sha256,'sourceByteLength',c.source_byte_length,'sourceExpectationDigest',c.source_expectation_digest,
        'requestedRetry',p_retry,'retryScheduled',v_retry,'jobStatus',v_job_status,'documentStatus',v_document_status,
        'nextRunAt',case when v_retry then p_next_run_at else null end
      );
      v_bytes := convert_to(v_audit::text,'UTF8');
      v_hash := 'sha256:'||encode(extensions.digest(v_bytes,'sha256'),'hex');
      perform ingestion_generation_evidence.retain(c,jsonb_build_array(jsonb_build_object('unitId',v_unit->'id','groupKey','repair',
        'representation','provenance_json','bytesHex',encode(v_bytes,'hex'),'sha256',v_hash,'byteLength',octet_length(v_bytes),'locator','repair:failed_attempt_transition')));
      -- Fixed server-derived outcome, conditional on the real transition succeeding in this same transaction.
      insert into ingestion_generation_evidence.outcomes values(c.document_id,c.generation_id,'repair_audit_inputs','failure_transition','repair',
        jsonb_build_object('unitId',v_unit->'id','groupKey','repair','disposition','retained','artifactSha256',v_hash,'limitation',null));
      v_managed := true;
      v_audit_status := jsonb_build_object('status','retained','reason',null);
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_audit_error = message_text;
      if v_audit_error is null or v_audit_error not in (
        'ingestion_failure_audit_already_retained','ingestion_failure_audit_original_required','immutable_generation_declaration','generation_producer_group_collision','generation_inventory_already_frozen'
      ) then raise; end if;
      -- The audit subtransaction is rolled back; prior evidence and the fenced failure owner are preserved.
      v_managed := false;
      v_audit_status := jsonb_build_object('status','unavailable','reason',v_audit_error);
    end;
  end if;
  update public.documents set status=case when index_generation_id is not null then 'indexed' when v_retry then 'queued' else 'failed' end,
    error_message=p_error_message, updated_at=pg_catalog.clock_timestamp() where id=v_document_id
    returning status into v_actual_document_status;
  update public.ingestion_jobs set status=case when v_retry then 'pending' else 'failed' end,stage=p_stage,error_message=p_error_message,
    next_run_at=case when v_retry then p_next_run_at else null end,locked_by=null,locked_at=null,
    completed_at=case when v_retry then null else pg_catalog.clock_timestamp() end where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='node'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp()
    returning status,next_run_at into v_actual_job_status,v_actual_next_run_at;
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  if v_managed and (v_actual_document_status is distinct from v_document_status or v_actual_job_status is distinct from v_job_status
    or coalesce(to_jsonb(v_actual_next_run_at),'null'::jsonb) is distinct from v_audit->'nextRunAt') then raise exception 'ingestion_failure_audit_disposition_mismatch'; end if;
  if v_batch is not null then
    select count(*) filter(where status='pending'),count(*) filter(where status='processing'),count(*) filter(where status='failed')
      into v_pending,v_processing,v_failed from public.ingestion_jobs where batch_id=v_batch;
    update public.import_batches set status=case when v_pending+v_processing>0 then 'processing' when v_failed>0 then 'completed_with_errors' else 'completed' end,
      failed_files=v_failed, completed_at=case when v_pending+v_processing>0 then null else pg_catalog.clock_timestamp() end where id=v_batch;
  end if;
  if v_audit_status is not null then
    return jsonb_build_object('ok',true,'retry',v_retry,'failureAudit',v_audit_status);
  end if;
  return jsonb_build_object('ok',true,'retry',v_retry);
end $$;

-- selected function public.finish_ingestion_job_stage
create or replace function public.finish_ingestion_job_stage(p_fence jsonb, p_stage_id uuid, p_ok boolean, p_counts jsonb, p_error text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_stage_id is null or p_ok is null or jsonb_typeof(p_counts) is distinct from 'object' or octet_length(p_counts::text)>65536 then raise exception 'invalid_ingestion_stage'; end if;
  update public.ingestion_job_stages set stage_status=case when p_ok then 'completed' else 'failed' end,
    finished_at=pg_catalog.clock_timestamp(),artifact_counts=p_counts,error_message=p_error
  where id=p_stage_id and job_id=(p_fence->>'job_id')::uuid and document_id=v_document_id
    and job_kind=p_fence->>'job_kind' and lease_token=(p_fence->>'lease_token')::uuid
    and index_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid and stage_status='started';
  if not found then raise exception 'ingestion_stage_identity_mismatch'; end if;
  return jsonb_build_object('ok',true);
end $$;

-- selected function public.heartbeat_indexing_v3_agent_job
create or replace function public.heartbeat_indexing_v3_agent_job(p_fence jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  update public.indexing_v3_agent_jobs set locked_at = pg_catalog.clock_timestamp(),
    lease_expires_at = pg_catalog.clock_timestamp() + make_interval(secs => lease_duration_seconds)
  where id = (p_fence->>'job_id')::uuid and document_id = v_document_id
    and p_fence->>'job_kind' = 'indexing_v3' and locked_by = p_fence->>'worker_id'
    and lease_token = (p_fence->>'lease_token')::uuid and status = 'processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest = p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  return jsonb_build_object('ok',true);
end $$;

-- selected function public.heartbeat_ingestion_job
create or replace function public.heartbeat_ingestion_job(p_fence jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  update public.ingestion_jobs set locked_at = pg_catalog.clock_timestamp(),
    lease_expires_at = pg_catalog.clock_timestamp() + make_interval(secs => lease_duration_seconds)
  where id = (p_fence->>'job_id')::uuid and document_id = v_document_id
    and p_fence->>'job_kind' = 'node' and locked_by = p_fence->>'worker_id'
    and lease_token = (p_fence->>'lease_token')::uuid and status = 'processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest = p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  return jsonb_build_object('ok',true);
end $$;

-- selected function public.persist_ingestion_index_quality
create or replace function public.persist_ingestion_index_quality(p_fence jsonb, p_quality jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if exists(select 1 from ingestion_generation_evidence.candidates where document_id=(p_fence->>'document_id')::uuid and job_id=(p_fence->>'job_id')::uuid) then return jsonb_build_object('ok',false,'reason','technical_supplier_not_implemented'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  insert into public.document_index_quality(document_id,owner_id,quality_score,extraction_quality,metrics,issues,updated_at)
  values(v_document_id,(v_locked->'document'->>'owner_id')::uuid,(p_quality->>'quality_score')::real,p_quality->>'extraction_quality',
    p_quality->'metrics',array(select jsonb_array_elements_text(p_quality->'issues')),pg_catalog.clock_timestamp())
  on conflict(document_id) do update set
    quality_score=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.quality_score else excluded.quality_score end,
    extraction_quality=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.extraction_quality else excluded.extraction_quality end,
    metrics=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.metrics || excluded.metrics else excluded.metrics end,
    issues=case when p_fence->>'job_kind'='indexing_v3' then array(select distinct x from unnest(public.document_index_quality.issues || excluded.issues) x) else excluded.issues end,
    updated_at=excluded.updated_at;
  return jsonb_build_object('ok',true);
end $$;

-- selected function public.persist_ingestion_summary_projection
create or replace function public.persist_ingestion_summary_projection(p_fence jsonb, p_summary jsonb, p_labels jsonb, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_owner uuid; v_summary public.document_summaries%rowtype; v_payload jsonb; v_label jsonb;
begin
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if exists(select 1 from ingestion_generation_evidence.candidates where document_id=(p_fence->>'document_id')::uuid and job_id=(p_fence->>'job_id')::uuid) then return jsonb_build_object('ok',false,'reason','technical_supplier_not_implemented'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  v_owner := (v_locked->'document'->>'owner_id')::uuid;
  v_payload := p_summary->'metadata'->'source_anchored_summary_v1';
  if jsonb_typeof(p_summary) is distinct from 'object' or jsonb_typeof(p_labels) is distinct from 'array'
    or jsonb_typeof(p_metadata) is distinct from 'object' or jsonb_typeof(p_summary->'metadata') is distinct from 'object'
    or jsonb_typeof(v_payload) is distinct from 'object'
    or jsonb_typeof(p_summary->'source_chunk_ids') is distinct from 'array' or jsonb_typeof(p_summary->'source_image_ids') is distinct from 'array'
    or jsonb_array_length(p_labels) > 100 or v_payload->>'document_id' is distinct from v_document_id::text
    or v_payload->>'index_generation_id' is distinct from p_fence->>'expected_generation_id'
    or coalesce(v_payload->>'summary_kind','') not in ('structured','heuristic_fallback')
    or p_summary->>'summary' is distinct from v_payload->>'summary'
    or p_summary->'clinical_specifics' is distinct from v_payload->'clinical_specifics'
    or p_summary->'source_chunk_ids' is distinct from v_payload->'source_chunk_ids'
    or p_summary->'source_image_ids' is distinct from v_payload->'source_image_ids'
    or (v_payload->>'summary_kind' <> 'structured' and jsonb_array_length(p_labels) <> 0)
    or p_summary->>'model' is distinct from v_payload->>'model'
    or p_summary->>'generated_at' is distinct from v_payload->>'generated_at'
    or jsonb_typeof(v_payload->'labels') is distinct from 'array' or jsonb_array_length(v_payload->'labels') <> jsonb_array_length(p_labels)
    or exists(select 1 from jsonb_object_keys(p_summary->'metadata') k where k <> all(array[
      'generated_by','index_generation_id','rag_enrichment_version','rag_indexing_version','rag_memory_version','clinical_profile_version',
      'coverage_profile','enrichment_prompt_strategy','enrichment_prompt_chunk_ids','label_count','source_anchored_summary_v1','source_anchored_summary_projection_complete_v1']))
    or exists (select 1 from jsonb_object_keys(p_metadata) k where k <> all(array[
      'rag_enrichment_version','rag_indexing_version','rag_memory_version','rag_enrichment_updated_at','generated_label_count']))
    then raise exception 'invalid_ingestion_summary_projection'; end if;
  perform public.assert_ingestion_artifact_sources(p_summary,v_document_id,(p_fence->>'expected_generation_id')::uuid,null);
  select * into v_summary from public.document_summaries where document_id = v_document_id for update;
  if v_payload->>'summary_kind' <> 'structured'
    and v_summary.metadata->'source_anchored_summary_v1'->>'summary_kind' = 'structured'
    -- Kind is not evidence of validity. Refuse under the current row lock; a
    -- rejected/concurrently replaced structured row needs governed structured repair.
    then raise exception 'ingestion_summary_requires_structured_repair'; end if;
  perform 1 from public.document_labels where document_id = v_document_id order by id for update;
  insert into public.document_summaries(document_id,owner_id,summary,clinical_specifics,source_chunk_ids,source_image_ids,model,metadata,generated_at,updated_at)
  values(v_document_id,v_owner,p_summary->>'summary',p_summary->'clinical_specifics',
    array(select jsonb_array_elements_text(p_summary->'source_chunk_ids'))::uuid[],
    array(select jsonb_array_elements_text(p_summary->'source_image_ids'))::uuid[], p_summary->>'model',
    coalesce(v_summary.metadata,'{}'::jsonb) || p_summary->'metadata' || jsonb_build_object('source_anchored_summary_projection_complete_v1', v_payload->>'summary_kind' = 'structured','index_generation_id',p_fence->>'expected_generation_id','ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'),
    (p_summary->>'generated_at')::timestamptz, pg_catalog.clock_timestamp())
  on conflict(document_id) do update set summary=excluded.summary, clinical_specifics=excluded.clinical_specifics,
    source_chunk_ids=excluded.source_chunk_ids, source_image_ids=excluded.source_image_ids, model=excluded.model,
    metadata=excluded.metadata, generated_at=excluded.generated_at, updated_at=excluded.updated_at
  returning * into v_summary;
  delete from public.document_labels where document_id = v_document_id and source = 'generated';
  for v_label in select value from jsonb_array_elements(p_labels) loop
    if v_label->>'document_id' is distinct from v_document_id::text or v_label->>'source' is distinct from 'generated'
      or v_label->'metadata'->>'index_generation_id' is distinct from p_fence->>'expected_generation_id'
      or not exists(select 1 from jsonb_array_elements(v_payload->'labels') label
        where label->>'label'=v_label->>'label' and label->>'label_type'=v_label->>'label_type'
          and label->'confidence'=v_label->'confidence')
      then raise exception 'invalid_ingestion_summary_label'; end if;
    perform public.assert_ingestion_artifact_sources(v_label->'metadata',v_document_id,(p_fence->>'expected_generation_id')::uuid,null);
    insert into public.document_labels(document_id,owner_id,label,label_type,confidence,source,metadata)
    values(v_document_id,v_owner,v_label->>'label',v_label->>'label_type',(v_label->>'confidence')::real,'generated',v_label->'metadata');
  end loop;
  update public.documents set metadata = public.jsonb_merge_deep(metadata,p_metadata), updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  return jsonb_build_object('ok',true,'summary',to_jsonb(v_summary));
end $$;

-- selected function public.prepare_completed_admin_text_reference
-- Service-only operation: callers must freshly authenticate an administrator on the server.
-- A service-role UUID is not itself authentication; the role lookup is an additional refusal gate.
create function public.prepare_completed_admin_text_reference(p_operator_id uuid,p_document_id uuid,p_generation uuid,p_expected_completed_state_digest text,p_change_observation jsonb,p_read_only boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare core jsonb; context jsonb; ids uuid[]; receipt jsonb; baseline_state text; checked jsonb;
begin
 if p_operator_id is null or p_operator_id='00000000-0000-0000-0000-000000000000'::uuid
   or not exists(select 1 from auth.users where id=p_operator_id and raw_app_meta_data->>'site_role'='administrator' and deleted_at is null)
   or p_expected_completed_state_digest is null or p_expected_completed_state_digest !~ '^[0-9a-f]{64}$' or p_read_only is null
   then raise exception 'admin_reference_administrator_required';end if;
 context:=ingestion_generation_evidence.admin_reference_context(p_document_id,p_generation,'private',null);
 select array_agg(id order by chunk_index,id) into ids from ingestion_generation_evidence.candidate_chunk_rows where document_id=p_document_id and index_generation_id=p_generation;
 core:=ingestion_generation_evidence.admin_reference_core(p_document_id,p_generation,ids,'private',null); context:=core->'context';
 baseline_state:=public.document_publication_state_digest(p_document_id,(context->>'provenanceOwnerId')::uuid);
 if baseline_state is distinct from p_expected_completed_state_digest then raise exception 'admin_reference_compare_before_update';end if;
 receipt:=ingestion_generation_evidence.admin_reference_receipt(context,p_change_observation);
 if not p_read_only then
   update public.documents set metadata=context->'preparedMetadata',updated_at=clock_timestamp() where id=p_document_id and owner_id=(context->>'provenanceOwnerId')::uuid and index_generation_id=p_generation;
   if not found then raise exception 'admin_reference_compare_before_update';end if;
   checked:=ingestion_generation_evidence.admin_reference_core(p_document_id,p_generation,ids,'prepared',null);
   if ingestion_generation_evidence.admin_reference_receipt(checked->'context',p_change_observation) is distinct from receipt
     or public.document_publication_state_digest(p_document_id,(context->>'provenanceOwnerId')::uuid) is distinct from receipt->>'preparedReviewedStateDigest'
     then raise exception 'admin_reference_preparation_readback';end if;
 end if;
 return jsonb_build_object('version','admin-text-reference-prepared-v1','documentId',p_document_id,'generationId',p_generation,'ownerId',context->'provenanceOwnerId',
   'receipt',jsonb_build_object('bytesHex',encode(convert_to(receipt::text,'UTF8'),'hex'),'sha256',ingestion_generation_evidence.admin_reference_digest(receipt),'byteLength',octet_length(convert_to(receipt::text,'UTF8'))),
   'evidenceReferences',to_jsonb(ingestion_generation_evidence.admin_reference_evidence(receipt)||array[context->'baseline'->'metadata'->>'rights_evidence_ref',p_change_observation->>'evidenceReference']),'preparedReviewedStateDigest',receipt->>'preparedReviewedStateDigest',
   'preparedMetadata',context->'preparedMetadata','readOnly',p_read_only,'publicationApproval','not_granted');
end $$;

-- selected function public.read_completed_admin_text_source_layout
-- Existing function signatures, ownership and ACLs remain unchanged.

create or replace function public.read_completed_admin_text_source_layout(p_owner_id uuid,p_document_id uuid,p_generation uuid,p_chunk_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 a jsonb; c ingestion_generation_evidence.candidates; j public.ingestion_jobs;
 ad public.document_admission_events; seal ingestion_generation_evidence.prerequisite_accounting;
 original ingestion_generation_evidence.retained_artifacts; witness ingestion_generation_evidence.retained_artifacts;
 prepared ingestion_generation_evidence.retained_artifacts; final ingestion_generation_evidence.retained_artifacts;
 cr ingestion_generation_evidence.candidate_chunk_rows; pr public.document_chunks;
 packet jsonb; identity jsonb; actual jsonb; body jsonb; prepared_body jsonb; commitment jsonb; inventory jsonb; result jsonb;
 rows jsonb:='[]'::jsonb; population_digest text; total integer; cursor_byte integer:=0; ordinal integer:=0;
begin
 if p_owner_id is null or p_document_id is null or p_generation is null or p_chunk_ids is null
   or cardinality(p_chunk_ids) not between 1 and 2000
   or array_ndims(p_chunk_ids) is distinct from 1
   or exists(select 1 from unnest(p_chunk_ids) id where id is null)
   or (select count(distinct id) from unnest(p_chunk_ids) id)<>cardinality(p_chunk_ids)
   then raise exception 'completed_admin_text_invalid_request';end if;
 -- Preserve governance -> document -> both sorted job sets -> candidate lock order.
 a:=public.lock_ingestion_document_authority(p_document_id,false);
 if a is null or a->'document'->>'owner_id' is distinct from p_owner_id::text
   or (a->'document'->>'index_generation_id')::uuid is distinct from p_generation
   or a->'document'->>'status' is distinct from 'indexed'
   then raise exception 'completed_admin_text_owner_generation_mismatch';end if;
 perform 1 from public.ingestion_jobs where document_id=p_document_id order by id for update;
 perform 1 from public.indexing_v3_agent_jobs where document_id=p_document_id order by id for update;
 select * into c from ingestion_generation_evidence.candidates
   where document_id=p_document_id and generation_id=p_generation for update;
 if not found then raise exception 'completed_admin_text_candidate_missing';end if;
 select * into j from public.ingestion_jobs where id=c.job_id;
 if not found or j.document_id is distinct from c.document_id or j.status is distinct from 'completed'
   or j.stage is distinct from 'admin_text_completed' or j.completed_at is null
   or j.locked_by is not null or j.locked_at is not null or j.lease_expires_at is not null or j.next_run_at is not null
   or j.lease_token is distinct from c.first_lease_token or j.lease_write_generation_id is distinct from c.generation_id
   or j.lease_expected_generation_id is distinct from c.generation_id or j.lease_authority_digest is distinct from c.authority_digest
   or c.authority_digest is distinct from a->>'authority_digest'
   or c.source_snapshot->>'owner_id' is distinct from p_owner_id::text
   or c.source_sha256 is distinct from 'sha256:'||(a->'document'->>'content_hash')
   or c.source_byte_length is distinct from (a->'document'->>'file_size')::bigint
   or c.source_byte_length not between 1 and 2097152
   or a->'document'->>'file_type' is distinct from 'text/plain'
   or a->'document'->'metadata'->>'corpus_scope' is distinct from 'uploaded_local'
   or a->'document'->'metadata'->>'content_mode' is distinct from 'indexed_content'
   or a->'document'->'metadata'->>'confidentiality_scope' is distinct from 'guidelines-only'
   or exists(select 1 from public.ingestion_jobs other where other.document_id=c.document_id and other.id<>j.id
     and (other.created_at>j.created_at or other.status in ('pending','processing')))
   or exists(select 1 from public.indexing_v3_agent_jobs other where other.document_id=c.document_id
     and other.status in ('pending','processing'))
   then raise exception 'completed_admin_text_identity_mismatch';end if;
 select * into ad from public.document_admission_events where id=(a->'document'->'metadata'->>'admission_event_id')::uuid;
 if not found or ad.actor_kind is distinct from 'administrator' or ad.source_channel is distinct from 'admin_api'
   or ad.document_id is distinct from c.document_id or ad.staging_owner_id is distinct from p_owner_id
   or ad.content_sha256 is distinct from c.source_sha256 or ad.byte_count is distinct from c.source_byte_length
   or ad.mime_type is distinct from 'text/plain' or ad.admission_policy_version is distinct from 'trusted-document-admission-v1'
   or a->'document'->'metadata'->>'admission_policy_version' is distinct from ad.admission_policy_version
   or ad.file_name_sha256 is distinct from 'sha256:'||encode(extensions.digest(convert_to(a->'document'->>'file_name','UTF8'),'sha256'),'hex')
   or ad.storage_path_sha256 is distinct from 'sha256:'||encode(extensions.digest(convert_to(a->'document'->>'storage_path','UTF8'),'sha256'),'hex')
   or ad.authority is distinct from a->'document'->'metadata'->'authority'
   or c.source_snapshot->'metadata'->'admission_event_id' is distinct from a->'document'->'metadata'->'admission_event_id'
   or ad.authority->>'authorityBasis' is distinct from 'administrator_template'
   or ad.authority->>'licencePolicy' is distinct from 'public_index_permitted'
   or ad.authority->>'providerProcessing' is distinct from 'permitted'
   or ad.authority->>'purpose' is distinct from 'clinical_retrieval'
   or ad.authority->>'currentness' is distinct from 'current' or ad.authority->'supportedFeatures' is distinct from '["text"]'::jsonb
   or (ad.authority->>'effectiveDate')::date>current_date or (ad.authority->>'expiryDate')::date<=current_date
   or (ad.authority->>'reviewDate')::date<=current_date
   then raise exception 'completed_admin_text_admission_mismatch';end if;
 select * into seal from ingestion_generation_evidence.prerequisite_accounting
   where document_id=c.document_id and generation_id=c.generation_id and snapshot->>'version'='managed-admin-text-seal-v1';
 if not found or seal.snapshot_digest is distinct from 'sha256:'||encode(extensions.digest(convert_to(seal.snapshot::text,'UTF8'),'sha256'),'hex')
   or seal.snapshot->>'scope' is distinct from 'whole_retained_utf8_txt' or seal.snapshot->'activated' is distinct from 'true'::jsonb
   or seal.snapshot->>'nativeFidelity' is distinct from 'whole_original_extracted_persisted_utf8_bytes_equal'
   or seal.snapshot->>'sourceCompleteness' is distinct from 'whole_original_byte_domain_covered'
   or seal.snapshot->>'clinicalApproval' is distinct from 'not_assessed' or seal.snapshot->>'publicationApproval' is distinct from 'not_granted'
   then raise exception 'completed_admin_text_seal_mismatch';end if;
 packet:=seal.snapshot->'packet';
 identity:=jsonb_build_object('documentId',c.document_id,'generationId',c.generation_id,'jobId',c.job_id,
   'workerId',packet->'identity'->>'workerId','firstLeaseToken',c.first_lease_token,'attemptNumber',j.attempt_count,
   'batchId',j.batch_id,'authorityDigest',c.authority_digest,'predecessorGenerationId',c.predecessor_generation_id,
   'ownerId',p_owner_id,'sourceSha256',c.source_sha256,'sourceByteLength',c.source_byte_length,'sourceExpectationDigest',c.source_expectation_digest);
 if not ((packet->>'version'='managed-admin-text-complete-v1' and ingestion_generation_evidence.keys(packet,array['version','identity','chunks','quality']))
     or (packet->>'version'='managed-admin-text-complete-v2' and ingestion_generation_evidence.keys(packet,array['version','identity','chunks','sections','quality']) and seal.snapshot->>'sectionsVersion'='managed-admin-text-sections-v2')) or packet->'identity' is distinct from identity
   or coalesce(btrim(packet->'identity'->>'workerId'),'')='' or jsonb_typeof(packet->'chunks') is distinct from 'array'
   then raise exception 'completed_admin_text_seal_mismatch';end if;
 total:=jsonb_array_length(packet->'chunks');
 if total not between 1 and 2000 or (select count(distinct value->>'id') from jsonb_array_elements(packet->'chunks'))<>total
   or c.registration->'version' is distinct from '1'::jsonb
   or c.registration->>'profileVersion' is distinct from c.profile_version
   or c.registration->>'sourceSha256' is distinct from c.source_sha256
   or c.registration->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
   or c.registration->'sourceExpectation' is distinct from c.source_expectation
   or c.registration->>'sourceExpectationHex' is distinct from encode(c.source_expectation_bytes,'hex')
   or c.registration->>'sourceExpectationSha256' is distinct from c.source_expectation_digest
   or c.source_expectation->>'tag' is distinct from 'known'
   or c.source_expectation->>'sourceSha256' is distinct from c.source_sha256
   or convert_from(c.source_expectation_bytes,'UTF8')::jsonb is distinct from c.source_expectation
   or c.source_expectation_digest is distinct from 'sha256:'||encode(extensions.digest(c.source_expectation_bytes,'sha256'),'hex')
   then raise exception 'completed_admin_text_registration_mismatch';end if;
 select * into original from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id
   and family='private_objects' and unit_key='original-source';
 if not found or original.group_key is distinct from 'private_objects' or original.representation is distinct from 'original_binary'
   or original.sha256 is distinct from c.source_sha256 or original.source_sha256 is distinct from c.source_sha256
   or original.byte_length is distinct from c.source_byte_length
   or convert_to(convert_from(original.artifact_bytes,'UTF8'),'UTF8') is distinct from original.artifact_bytes
   then raise exception 'completed_admin_text_original_mismatch';end if;
 select * into witness from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id
   and family='private_objects' and unit_key='original-source-expectation-witness';
 if not found or witness.group_key is distinct from 'private_objects' or witness.representation is distinct from 'source_expectation_witness'
   or witness.source_sha256 is distinct from c.source_sha256 or witness.sha256 is distinct from c.source_expectation->'witness'->>'sha256'
   or seal.snapshot->>'sourceWitnessSha256' is distinct from witness.sha256
   or not exists(select 1 from jsonb_array_elements(c.registration->'declarations'->'units') u where
     u.value->'id'='{"family":"private_objects","key":"original-source-expectation-witness"}'::jsonb
     and u.value->>'groupKey'='private_objects' and u.value->>'representation'='source_expectation_witness')
   then raise exception 'completed_admin_text_witness_mismatch';end if;
 if exists(select 1 from ingestion_generation_evidence.retained_artifacts art where art.document_id=c.document_id and art.generation_id=c.generation_id
   and (art.source_sha256 is distinct from c.source_sha256 or art.byte_length is distinct from octet_length(art.artifact_bytes)::bigint
     or art.sha256 is distinct from 'sha256:'||encode(extensions.digest(art.artifact_bytes,'sha256'),'hex')))
   or exists(select 1 from ingestion_generation_evidence.unit_declarations declaration
     left join ingestion_generation_evidence.outcomes outcome using(document_id,generation_id,family,unit_key)
     left join ingestion_generation_evidence.retained_artifacts art using(document_id,generation_id,family,unit_key)
     where declaration.document_id=c.document_id and declaration.generation_id=c.generation_id and declaration.declaration->'required'='true'::jsonb
       and (outcome.outcome->>'disposition' is distinct from 'retained' or outcome.outcome->>'artifactSha256' is distinct from art.sha256 or art.sha256 is null))
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts art join ingestion_generation_evidence.outcomes o using(document_id,generation_id,family,unit_key)
     where art.document_id=c.document_id and art.generation_id=c.generation_id and art.family='attempt_control' and art.unit_key='preseal_checkpoint'
       and o.outcome->>'disposition'='retained' and o.outcome->>'artifactSha256'=art.sha256
       and (convert_from(art.artifact_bytes,'UTF8')::jsonb)->'terminalPacket'=packet)
   then raise exception 'completed_admin_text_artifact_mismatch';end if;
 if packet->>'version'='managed-admin-text-complete-v2' then
   -- Retain row stability until transaction end, including old-generation sections.
   perform 1 from public.document_sections where document_id=c.document_id order by id for share;
   perform 1 from public.document_index_quality where document_id=c.document_id order by document_id for share;
   perform ingestion_generation_evidence.assert_admin_text_sections(c,packet,true);
   perform ingestion_generation_evidence.assert_admin_text_quality_state(c,packet,seal.snapshot_digest);
 end if;
 -- Freeze the full committed population before checking or exposing selected rows.
 perform 1 from public.document_chunks where document_id=c.document_id and index_generation_id=c.generation_id order by id for share;
 if (select count(*) from public.document_chunks where document_id=c.document_id and index_generation_id=c.generation_id)<>total
   or (select count(*) from ingestion_generation_evidence.candidate_chunk_rows where document_id=c.document_id and index_generation_id=c.generation_id)<>total
   or (select count(*) from public.document_chunks where document_id=c.document_id and index_generation_id=c.generation_id and id=any(p_chunk_ids))<>cardinality(p_chunk_ids)
   or exists(select 1 from ingestion_generation_evidence.candidate_chunk_rows candidate left join public.document_chunks committed on committed.id=candidate.id
     where candidate.document_id=c.document_id and candidate.index_generation_id=c.generation_id
       and (committed.id is null or (to_jsonb(committed)-array['created_at','search_tsv']) is distinct from
         (to_jsonb(jsonb_populate_record(null::public.document_chunks,to_jsonb(candidate)))-array['created_at','search_tsv'])))
   then raise exception 'completed_admin_text_committed_population_mismatch';end if;
 select 'sha256:'||encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_object('key',unit_key,'sha256',sha256,'byteLength',byte_length) order by unit_key)::text,'UTF8'),'sha256'),'hex')
   into population_digest from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks';
 if seal.snapshot->>'chunkPopulationDigest' is distinct from population_digest then raise exception 'completed_admin_text_seal_mismatch';end if;
 -- Validate all final/prepared/source commitments, not just selected rows.
 for commitment in select value from jsonb_array_elements(packet->'chunks') loop
   select * into cr from ingestion_generation_evidence.candidate_chunk_rows where id=(commitment->>'id')::uuid and document_id=c.document_id and index_generation_id=c.generation_id;
   if not found then raise exception 'completed_admin_text_row_mismatch';end if;
   select * into pr from public.document_chunks where id=cr.id and document_id=c.document_id and index_generation_id=c.generation_id;
   select * into prepared from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=cr.id::text||':prepared';
   if not found then raise exception 'completed_admin_text_row_mismatch';end if;
   select * into final from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=cr.id::text||':final';
   if not found then raise exception 'completed_admin_text_row_mismatch';end if;
   actual:=(to_jsonb(pr)-array['created_at','search_tsv','embedding'])||jsonb_build_object('embedding',(pr.embedding::text)::jsonb);
   body:=convert_from(final.artifact_bytes,'UTF8')::jsonb;
   prepared_body:=convert_from(prepared.artifact_bytes,'UTF8')::jsonb;
   if not ingestion_generation_evidence.keys(commitment,array['id','chunkIndex','start','end','sha256'])
     or commitment->'chunkIndex' is distinct from to_jsonb(ordinal) or commitment->'start' is distinct from to_jsonb(cursor_byte)
     or (commitment->>'end')::integer<=cursor_byte or (commitment->>'end')::integer>c.source_byte_length
     or cr.chunk_index is distinct from ordinal or cr.page_number is distinct from 1
     or cr.candidate_owner_id is distinct from p_owner_id or cr.candidate_job_id is distinct from c.job_id
     or cr.candidate_lease_token is distinct from c.first_lease_token or cr.candidate_authority_digest is distinct from c.authority_digest
     or cr.candidate_source_sha256 is distinct from c.source_sha256 or cr.candidate_source_expectation_digest is distinct from c.source_expectation_digest
     or cr.candidate_prepared_sha256 is distinct from prepared.sha256
     or prepared.group_key is distinct from 'worker_core' or prepared.representation is distinct from 'provenance_json'
     or final.group_key is distinct from 'worker_core' or final.representation is distinct from 'provenance_json'
     or body->>'version' is distinct from 'ingestion-persisted-chunk-v1' or body->>'qualification' is distinct from 'derived_unverified'
     or body->>'documentId' is distinct from c.document_id::text or body->>'generationId' is distinct from c.generation_id::text
     or body->>'sourceSha256' is distinct from c.source_sha256 or body->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
     or body->>'chunkId' is distinct from cr.id::text or body->'chunkIndex' is distinct from to_jsonb(cr.chunk_index)
     or prepared_body->>'version' is distinct from 'ingestion-prepared-chunk-v1' or prepared_body->>'qualification' is distinct from 'derived_unverified'
     or prepared_body->>'documentId' is distinct from c.document_id::text or prepared_body->>'generationId' is distinct from c.generation_id::text
     or prepared_body->>'sourceSha256' is distinct from c.source_sha256 or prepared_body->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
     or prepared_body->>'chunkId' is distinct from cr.id::text or prepared_body->'chunkIndex' is distinct from to_jsonb(cr.chunk_index)
     or body->'row' is distinct from actual or body->>'preparedSha256' is distinct from prepared.sha256
     or prepared_body->'row' is distinct from
       (actual-'embedding')||jsonb_build_object('metadata',(actual->'metadata')-array['ingestion_job_id','ingestion_job_kind','ingestion_lease_token'])
     or convert_to(pr.content,'UTF8') is distinct from substring(original.artifact_bytes from cursor_byte+1 for (commitment->>'end')::integer-cursor_byte)
     or commitment->>'sha256' is distinct from 'sha256:'||encode(extensions.digest(convert_to(pr.content,'UTF8'),'sha256'),'hex')
     then raise exception 'completed_admin_text_row_mismatch';end if;
   if pr.id=any(p_chunk_ids) then rows:=rows||jsonb_build_array(actual-'embedding');end if;
   cursor_byte:=(commitment->>'end')::integer;ordinal:=ordinal+1;
 end loop;
 if cursor_byte<>c.source_byte_length or jsonb_array_length(rows)<>cardinality(p_chunk_ids)
   then raise exception 'completed_admin_text_row_mismatch';end if;
 inventory:=ingestion_generation_evidence.inventory(c)||jsonb_build_object('retainedOriginalWitness',jsonb_build_object(
   'status','retained','documentId',c.document_id,'generationId',c.generation_id,'sourceSha256',c.source_sha256,
   'sourceByteLength',c.source_byte_length,'sourceExpectationDigest',c.source_expectation_digest,
   'unitId',jsonb_build_object('family','private_objects','key','original-source-expectation-witness'),
   'representation','source_expectation_witness','bytesHex',encode(witness.artifact_bytes,'hex'),'sha256',witness.sha256,'byteLength',witness.byte_length));
 result:=jsonb_build_object('version',1,'documentId',c.document_id,'generationId',c.generation_id,'ownerId',p_owner_id,
   'original',jsonb_build_object('bytesHex',encode(original.artifact_bytes,'hex'),'sha256',original.sha256,'byteLength',original.byte_length),
   'inventory',inventory,'rows',rows);
 if octet_length(convert_to(result::text,'UTF8'))>8388608 then raise exception 'completed_admin_text_response_limit';end if;
 return result;
end $$;

-- selected function public.read_ingestion_generation_inventory
-- Facts-only current trusted admission read. No provider permission, safety verdict or new grant.
create or replace function public.read_ingestion_generation_inventory(p_fence jsonb,p_generation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c ingestion_generation_evidence.candidates;a jsonb;w ingestion_generation_evidence.retained_artifacts;v_witness jsonb;pa_document jsonb;pa_metadata jsonb;pa_authority jsonb;pa_event public.document_admission_events;pa_pair record;
begin
  -- PROVIDER AUTHORITY INTERCEPTION BEGIN: existing read modes below are unchanged.
  if p_fence->>'version'='ingestion-provider-authority-read-v1' then
    if p_generation is null or not coalesce(
      ingestion_generation_evidence.keys(p_fence,array['version','fence'])
      and ingestion_generation_evidence.keys(p_fence->'fence',array['job_kind','job_id','document_id','worker_id','lease_token','expected_generation_id','authority_digest'])
      and p_fence->'fence'->'job_kind' in ('"node"'::jsonb,'"indexing_v3"'::jsonb)
      and jsonb_typeof(p_fence->'fence'->'worker_id')='string' and btrim(p_fence->'fence'->>'worker_id')<>''
      and jsonb_typeof(p_fence->'fence'->'authority_digest')='string' and p_fence->'fence'->>'authority_digest' ~ '^sha256:[0-9a-f]{64}$'
      and jsonb_typeof(p_fence->'fence'->'job_id')='string' and p_fence->'fence'->>'job_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and jsonb_typeof(p_fence->'fence'->'document_id')='string' and p_fence->'fence'->>'document_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and jsonb_typeof(p_fence->'fence'->'lease_token')='string' and p_fence->'fence'->>'lease_token' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and (p_fence->'fence'->'expected_generation_id'='null'::jsonb or (jsonb_typeof(p_fence->'fence'->'expected_generation_id')='string'
        and p_fence->'fence'->>'expected_generation_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
      and (p_fence->'fence'->>'job_kind'<>'indexing_v3' or p_fence->'fence'->'expected_generation_id'<>'null'::jsonb),false)
      then raise exception 'provider_authority_identity_mismatch';end if;
    a:=public.assert_current_ingestion_attempt(p_fence->'fence',p_generation);
    if a is null then raise exception 'provider_authority_current_attempt_required';end if;
    pa_document:=a->'document';pa_metadata:=pa_document->'metadata';
    if pa_metadata->>'corpus_scope' is distinct from 'uploaded_local'
      or pa_metadata->>'content_mode' is distinct from 'indexed_content'
      or pa_metadata->>'admission_policy_version' is distinct from 'trusted-document-admission-v1'
      or jsonb_typeof(pa_metadata->'admission_event_id') is distinct from 'string'
      or coalesce(pa_metadata->>'admission_event_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then raise exception 'provider_authority_admission_mismatch';end if;
    select event_row.* into pa_event from public.document_admission_events as event_row
      where event_row.id=(pa_metadata->>'admission_event_id')::uuid;
    if not found then raise exception 'provider_authority_admission_mismatch';end if;
    -- The immutable admission's original job need not equal this current reindex job.
    if pa_event.document_id::text is distinct from pa_document->>'id'
      or pa_event.staging_owner_id::text is distinct from pa_document->>'owner_id'
      or pa_event.admission_policy_version is distinct from 'trusted-document-admission-v1'
      or pa_event.content_sha256 is distinct from 'sha256:'||(pa_document->>'content_hash')
      or pa_event.mime_type is distinct from pa_document->>'file_type'
      or to_jsonb(pa_event.byte_count) is distinct from pa_document->'file_size'
      or jsonb_typeof(pa_document->'file_name') is distinct from 'string'
      or jsonb_typeof(pa_document->'storage_path') is distinct from 'string'
      or pa_event.file_name_sha256 is distinct from 'sha256:'||encode(extensions.digest(convert_to(pa_document->>'file_name','UTF8'),'sha256'),'hex')
      or pa_event.storage_path_sha256 is distinct from 'sha256:'||encode(extensions.digest(convert_to(pa_document->>'storage_path','UTF8'),'sha256'),'hex')
      or pa_event.authority is distinct from pa_metadata->'authority'
      or pa_metadata->>'content_hash' is distinct from pa_document->>'content_hash'
      or pa_metadata->>'confidentiality_scope' is distinct from 'guidelines-only'
      then raise exception 'provider_authority_admission_mismatch';end if;
    pa_authority:=pa_event.authority;
    -- This observes the already admitted declaration; it does not establish current rights.
    if not ingestion_generation_evidence.keys(pa_authority,array['version','sourceRole','authorityBasis','licencePolicy','rightsEvidenceRef','publisher','jurisdiction','publicationDate','effectiveDate','reviewDate','expiryDate','currentness','supersedesDocumentId','purpose','supportedFeatures','providerProcessing'])
      or pa_authority->'version' is distinct from '1'::jsonb
      or pa_authority->>'authorityBasis' is distinct from (case pa_event.actor_kind when 'administrator' then 'administrator_template' else 'backend_manifest' end)
      or (pa_event.actor_kind='administrator' and pa_event.source_channel<>'admin_api')
      or (pa_event.actor_kind='trusted_backend' and pa_event.source_channel<>'backend_import')
      or pa_authority->>'jurisdiction' is distinct from 'Australia'
      or pa_authority->>'purpose' is distinct from 'clinical_retrieval'
      or pa_authority->>'providerProcessing' is distinct from 'permitted'
      then raise exception 'provider_authority_admission_mismatch';end if;
    for pa_pair in select * from (values
      ('source_role','sourceRole'),('authority_basis','authorityBasis'),('licence_policy','licencePolicy'),
      ('rights_evidence_ref','rightsEvidenceRef'),('publisher','publisher'),('jurisdiction','jurisdiction'),
      ('publication_date','publicationDate'),('effective_date','effectiveDate'),('review_date','reviewDate'),
      ('expiry_date','expiryDate'),('document_status','currentness'),('supersedes_document_id','supersedesDocumentId'),
      ('purpose','purpose'),('supported_features','supportedFeatures'),('provider_processing','providerProcessing')
    ) as pairs(metadata_key,authority_key) loop
      if pa_metadata->pa_pair.metadata_key is distinct from pa_authority->pa_pair.authority_key
        then raise exception 'provider_authority_admission_mismatch';end if;
    end loop;
    return jsonb_build_object('ok',true,'providerAuthority',jsonb_build_object(
      'version','ingestion-provider-authority-facts-v1','status','observed',
      'documentId',pa_event.document_id,'ownerId',pa_event.staging_owner_id,
      'jobKind',p_fence->'fence'->>'job_kind','jobId',p_fence->'fence'->>'job_id',
      'generationId',p_generation,'expectedGenerationId',p_fence->'fence'->'expected_generation_id',
      'authorityDigest',a->>'authority_digest','sourceSha256',pa_event.content_sha256,'sourceByteLength',pa_event.byte_count,
      'mimeType',pa_event.mime_type,'fileNameSha256',pa_event.file_name_sha256,'storagePathSha256',pa_event.storage_path_sha256,
      'admissionEventId',pa_event.id,'admissionPolicyVersion',pa_event.admission_policy_version,'admissionDigest',pa_event.admission_digest,
      'declaredAuthority',pa_authority,'currentRightsEvidence','unavailable','safetyEvidence','unavailable'));
  end if;
  -- PROVIDER AUTHORITY INTERCEPTION END
  if p_fence ?| array['version','fence','projectionId'] then
    raise exception 'main_txt_forward_unsupported_read_mode';
  end if;
  a:=public.assert_current_ingestion_attempt(p_fence,p_generation);
  if a is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if not exists(select 1 from ingestion_generation_evidence.candidates where document_id=(p_fence->>'document_id')::uuid and generation_id=p_generation) then return jsonb_build_object('ok',true,'managed',false,'inventory',null); end if;
  c:=ingestion_generation_evidence.lock_candidate(p_fence,p_generation);
  if c is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  select * into w from ingestion_generation_evidence.retained_artifacts
    where document_id=c.document_id and generation_id=c.generation_id
      and family='private_objects' and unit_key='original-source-expectation-witness';
  if c.source_expectation->>'tag' is distinct from 'known' then
    if found then raise exception 'retained_original_witness_identity_mismatch'; end if;
    v_witness:=jsonb_build_object('status','unavailable','reason','source_expectation_unavailable');
  elsif not found then
    v_witness:=jsonb_build_object('status','unavailable','reason','witness_not_retained');
  else
    if w.group_key is distinct from 'private_objects' or w.representation is distinct from 'source_expectation_witness'
      or w.source_sha256 is distinct from c.source_sha256
      or w.sha256 is distinct from c.source_expectation->'witness'->>'sha256'
      or w.byte_length is distinct from octet_length(w.artifact_bytes)::bigint
      or w.sha256 is distinct from 'sha256:'||encode(extensions.digest(w.artifact_bytes,'sha256'),'hex')
      then raise exception 'retained_original_witness_identity_mismatch'; end if;
    v_witness:=jsonb_build_object('status','retained','documentId',c.document_id,'generationId',c.generation_id,
      'sourceSha256',c.source_sha256,'sourceByteLength',c.source_byte_length,'sourceExpectationDigest',c.source_expectation_digest,
      'unitId',jsonb_build_object('family','private_objects','key','original-source-expectation-witness'),
      'representation','source_expectation_witness','bytesHex',encode(w.artifact_bytes,'hex'),'sha256',w.sha256,'byteLength',w.byte_length);
  end if;
  return jsonb_build_object('ok',true,'managed',true,'inventory',
    ingestion_generation_evidence.inventory(c)||jsonb_build_object('retainedOriginalWitness',v_witness),
    'candidateEnrichmentInputs',ingestion_generation_evidence.candidate_enrichment_inputs(c,a->'document'));
end $$;

-- selected function public.read_ingestion_prepared_supplier_artifacts
create function public.read_ingestion_prepared_supplier_artifacts(p_fence jsonb, p_generation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c ingestion_generation_evidence.candidates;
  result jsonb;
  transport_limit constant bigint := 16777216;
begin
  if p_generation is null
    or not ingestion_generation_evidence.keys(p_fence, array['job_kind','job_id','document_id','worker_id','lease_token','expected_generation_id','authority_digest'])
    or p_fence->>'job_kind' is distinct from 'node'
    or coalesce(p_fence->>'worker_id','') = ''
    or coalesce(p_fence->>'authority_digest','') !~ '^sha256:[0-9a-f]{64}$'
    then raise exception 'prepared_supplier_readback_invalid_fence'; end if;
  -- lock_candidate checks current attempt/source authority and the candidate's FIRST lease.
  c := ingestion_generation_evidence.lock_candidate(p_fence, p_generation);
  if c is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if coalesce((select sum(octet_length(a.artifact_bytes)::bigint)*2
      from ingestion_generation_evidence.retained_artifacts a
      where a.document_id=c.document_id and a.generation_id=c.generation_id),0) > transport_limit
    then raise exception 'prepared_supplier_readback_transport_limit_exceeded'; end if;
  if exists (
    select 1 from ingestion_generation_evidence.retained_artifacts a
    left join ingestion_generation_evidence.unit_declarations u
      on u.document_id=a.document_id and u.generation_id=a.generation_id
      and u.family=a.family and u.unit_key=a.unit_key
    where a.document_id=c.document_id and a.generation_id=c.generation_id and (
      u.declaration is null or a.group_key is distinct from u.declaration->>'groupKey'
      or a.representation is distinct from u.declaration->>'representation'
      or a.source_sha256 is distinct from c.source_sha256
      or a.byte_length is distinct from octet_length(a.artifact_bytes)::bigint
      or a.sha256 is distinct from 'sha256:'||encode(extensions.digest(a.artifact_bytes,'sha256'),'hex'))
  ) then raise exception 'prepared_supplier_readback_artifact_identity_mismatch'; end if;
  result := jsonb_build_object('ok',true,'managed',true,'preparedSupplierArtifacts',jsonb_build_object(
    'version','ingestion-prepared-supplier-artifacts-v1',
    'identity',jsonb_build_object('documentId',c.document_id,'ownerId',c.source_snapshot->>'owner_id',
      'generationId',c.generation_id,'jobId',c.job_id,'firstLeaseToken',c.first_lease_token,
      'authorityDigest',c.authority_digest,'sourceSha256',c.source_sha256,
      'sourceByteLength',c.source_byte_length,'sourceExpectationDigest',c.source_expectation_digest),
    'inventory',ingestion_generation_evidence.inventory(c),
    'artifacts',coalesce((select jsonb_agg(jsonb_build_object(
      'unitId',jsonb_build_object('family',a.family,'key',a.unit_key),
      'groupKey',a.group_key,'representation',a.representation,
      'sha256',a.sha256,'byteLength',a.byte_length,'locator',a.locator,
      'bytesHex',encode(a.artifact_bytes,'hex')) order by a.family,a.unit_key)
      from ingestion_generation_evidence.retained_artifacts a
      where a.document_id=c.document_id and a.generation_id=c.generation_id),'[]'::jsonb)));
  if octet_length(convert_to(result::text,'UTF8'))::bigint > transport_limit
    then raise exception 'prepared_supplier_readback_transport_limit_exceeded'; end if;
  return result;
end $$;

-- selected function public.read_published_admin_text_source_layout
create function public.read_published_admin_text_source_layout(p_requester_id uuid,p_document_id uuid,p_generation uuid,p_publication_approval_id uuid,p_chunk_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare approval public.document_publication_approvals; d public.documents; publication_metadata jsonb; decoded jsonb; core jsonb; receipt jsonb; result jsonb; publication jsonb;
begin
 if p_requester_id is null or p_requester_id='00000000-0000-0000-0000-000000000000'::uuid or p_document_id is null or p_generation is null or p_publication_approval_id is null
   or not exists(select 1 from auth.users where id=p_requester_id and deleted_at is null)
   then raise exception 'published_admin_reference_authenticated_requester_required';end if;
 -- Match governance -> latest event -> document order, including absent activation history.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nhmrc',0));
 perform 1 from public.public_source_activation_events where source_catalogue_key='nhmrc' order by activation_sequence desc limit 1 for update;
 select * into d from public.documents where id=p_document_id for update;
 if not found or d.owner_id is not null or d.index_generation_id is distinct from p_generation or d.metadata->'public_corpus' is distinct from 'true'::jsonb
   or d.metadata->'private'='true'::jsonb or d.metadata->'is_private'='true'::jsonb or d.metadata->>'visibility'='private'
   then raise exception 'published_admin_reference_document_refused';end if;
 select * into approval from public.document_publication_approvals where id=p_publication_approval_id for share;
 if not found or approval.document_id is distinct from p_document_id or approval.decision is distinct from 'approved'
   or approval.expected_prior_owner_id is null or approval.approving_operator_id is null or approval.approved_at is null
   or char_length(btrim(approval.reason)) not between 3 and 2000 or approval.manifest_digest !~ '^[0-9a-f]{64}$'
   or approval.reviewed_state_digest is null or approval.reviewed_state_digest !~ '^[0-9a-f]{64}$' or approval.reviewed_index_generation_id is distinct from p_generation
   or approval.source_catalogue_key is distinct from 'nhmrc' or approval.source_policy_version is distinct from 'australian-source-policy-v1'
   or d.metadata->'publication_manifest_version' is distinct from '2'::jsonb
   or d.metadata->>'publication_approval_id' is distinct from approval.id::text or d.metadata->>'publication_manifest_digest' is distinct from approval.manifest_digest
   or d.metadata->>'publication_reviewed_state_digest' is distinct from approval.reviewed_state_digest
   or d.metadata->>'publication_reviewed_index_generation_id' is distinct from approval.reviewed_index_generation_id::text
   or d.metadata->>'publication_source_policy_version' is distinct from approval.source_policy_version
   or jsonb_typeof(d.metadata->'published_at') is distinct from 'string' or (d.metadata->>'published_at')::timestamptz<approval.approved_at
   then raise exception 'published_admin_reference_approval_refused';end if;
 publication_metadata:=jsonb_build_object('public_corpus',true,'publication_approval_id',approval.id,'publication_manifest_digest',approval.manifest_digest,
   'publication_reviewed_state_digest',approval.reviewed_state_digest,'published_at',d.metadata->'published_at','publication_manifest_version',2,
   'publication_source_policy_version',approval.source_policy_version,'publication_reviewed_index_generation_id',approval.reviewed_index_generation_id);
 core:=ingestion_generation_evidence.admin_reference_core(p_document_id,p_generation,p_chunk_ids,'published',publication_metadata);
 if core->>'ownerId' is distinct from approval.expected_prior_owner_id::text then raise exception 'published_admin_reference_provenance_refused';end if;
 decoded:=ingestion_generation_evidence.admin_reference_decode(approval.evidence_references);
 receipt:=ingestion_generation_evidence.admin_reference_receipt(core->'context',decoded->'receipt'->'comparison');
 if decoded->'receipt' is distinct from receipt or receipt->>'preparedReviewedStateDigest' is distinct from approval.reviewed_state_digest
   or not ((core->'context'->'baseline'->'metadata'->>'rights_evidence_ref')=any(approval.evidence_references))
   or not ((receipt->'comparison'->>'evidenceReference')=any(approval.evidence_references))
   then raise exception 'published_admin_reference_preparation_refused';end if;
 publication:=jsonb_build_object('approvalId',approval.id,'manifestVersion',2,'manifestDigest',approval.manifest_digest,'reviewedStateDigest',approval.reviewed_state_digest,
   'reviewedIndexGenerationId',approval.reviewed_index_generation_id,'sourceCatalogueKey',approval.source_catalogue_key,'sourcePolicyVersion',approval.source_policy_version,
   'approvingOperatorId',approval.approving_operator_id,'approvedAt',approval.approved_at,'preparationReceiptSha256',decoded->>'sha256');
 result:=jsonb_build_object('version','published-admin-text-source-layout-v1','requesterId',p_requester_id,'documentId',p_document_id,'generationId',p_generation,'provenanceOwnerId',core->'ownerId',
   'document',jsonb_build_object('owner_id',d.owner_id,'status',d.status,'index_generation_id',d.index_generation_id,'metadata',d.metadata),
   'publication',publication,'evidenceReferences',to_jsonb(approval.evidence_references),'preparationReceipt',decoded-'receipt',
   'original',core->'original','inventory',core->'inventory','rows',core->'rows');
 if octet_length(convert_to(result::text,'UTF8'))>8388608 then raise exception 'published_admin_reference_response_limit';end if;
 return result;
exception when invalid_text_representation or character_not_in_repertoire or numeric_value_out_of_range then raise exception 'published_admin_reference_invalid_source';
end $$;

-- selected function public.record_ingestion_generation_accounting
create function public.record_ingestion_generation_accounting(p_fence jsonb,p_generation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c ingestion_generation_evidence.candidates; i jsonb;s jsonb;h text;missing jsonb;dependencies jsonb;original_missing jsonb;
begin
  c:=ingestion_generation_evidence.lock_candidate(p_fence,p_generation);
  if c is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  i:=ingestion_generation_evidence.inventory(c);
  select coalesce(jsonb_agg(u.declaration->'id' order by u.family,u.unit_key),'[]'::jsonb) into missing
    from ingestion_generation_evidence.unit_declarations u left join ingestion_generation_evidence.outcomes o using(document_id,generation_id,family,unit_key)
    where u.document_id=c.document_id and u.generation_id=c.generation_id and u.declaration->'required'='true'::jsonb and (o.outcome is null or o.outcome->>'disposition'<>'retained');
  select coalesce(jsonb_agg(dep.value order by u.family,u.unit_key),'[]'::jsonb) into dependencies
    from ingestion_generation_evidence.unit_declarations u cross join lateral jsonb_array_elements(u.declaration->'dependencies') dep
    where u.document_id=c.document_id and u.generation_id=c.generation_id and not exists(select 1 from ingestion_generation_evidence.outcomes o where o.document_id=c.document_id and o.generation_id=c.generation_id and o.family=dep.value->>'family' and o.unit_key=dep.value->>'key' and o.outcome->>'disposition'='retained');
  select coalesce(jsonb_agg(su.value->>'id'),'[]'::jsonb) into original_missing from jsonb_array_elements(case when c.source_expectation->>'tag'='known' then c.source_expectation->'units' else '[]'::jsonb end) su
    where su.value->'required'='true'::jsonb and not exists(select 1 from ingestion_generation_evidence.unit_declarations u join ingestion_generation_evidence.outcomes o using(document_id,generation_id,family,unit_key) where u.document_id=c.document_id and u.generation_id=c.generation_id and u.declaration->'sourceEvidenceIds' @> jsonb_build_array(su.value->>'id') and o.outcome->>'disposition'='retained');
  s:=jsonb_build_object('version',1,'result','unavailable','reason','technical_supplier_not_implemented','inventory',i,
    'missingRequiredUnits',missing,'unresolvedDependencies',dependencies,'unrepresentedOriginalRequiredIds',original_missing,
    'originalExpectationState',c.source_expectation->>'tag','terminalSeal',null,'technicalEligibility','unavailable',
    'limitations',jsonb_build_array('original_expectation_and_native_fidelity_not_certified','whole_logical_unit_anchors_only','normalization_fidelity_unverified','not_public_or_clinical_approval'));
  h:='sha256:'||encode(extensions.digest(convert_to(s::text,'UTF8'),'sha256'),'hex');
  insert into ingestion_generation_evidence.prerequisite_accounting values(c.document_id,c.generation_id,h,s,clock_timestamp()) on conflict do nothing;
  return jsonb_build_object('ok',true,'accounting',s,'snapshotDigest',h);
end $$;

-- selected function public.register_admin_text_source_section_layout
create function public.register_admin_text_source_section_layout(p_fence jsonb,p_generation uuid,p_source_expectation_digest text,p_layout jsonb,p_layout_hex text,p_layout_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c ingestion_generation_evidence.candidates; bytes bytea;
begin
 c:=ingestion_generation_evidence.lock_candidate(p_fence,p_generation);
 if c is null then return jsonb_build_object('ok',false,'reason','lease_lost');end if;
 if p_source_expectation_digest is distinct from c.source_expectation_digest or p_layout_hex is null
   or char_length(p_layout_hex) not between 2 and 2097152 or p_layout_hex !~ '^([0-9a-f]{2})+$'
   or p_layout_sha256 is null or p_layout_sha256 !~ '^sha256:[0-9a-f]{64}$'
   then raise exception 'admin_text_registered_layout_registration_invalid';end if;
 bytes:=decode(p_layout_hex,'hex');
 if c.source_section_layout is not null then
   if c.source_section_layout is distinct from p_layout or c.source_section_layout_bytes is distinct from bytes
     or c.source_section_layout_digest is distinct from p_layout_sha256 then raise exception 'admin_text_registered_layout_immutable';end if;
   perform ingestion_generation_evidence.assert_admin_text_source_section_layout(c);
   return jsonb_build_object('ok',true,'sourceSectionLayoutDigest',c.source_section_layout_digest);
 else
   c.source_section_layout:=p_layout;c.source_section_layout_bytes:=bytes;c.source_section_layout_digest:=p_layout_sha256;
 end if;
 perform ingestion_generation_evidence.assert_admin_text_source_section_layout(c);
 update ingestion_generation_evidence.candidates set source_section_layout=c.source_section_layout,
   source_section_layout_bytes=c.source_section_layout_bytes,source_section_layout_digest=c.source_section_layout_digest
   where document_id=c.document_id and generation_id=c.generation_id;
 return jsonb_build_object('ok',true,'sourceSectionLayoutDigest',c.source_section_layout_digest);
exception when invalid_text_representation or character_not_in_repertoire or numeric_value_out_of_range then raise exception 'admin_text_registered_layout_invalid';
end $$;

-- selected function public.reject_document_admission_event_mutation
create or replace function public.reject_document_admission_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'document_admission_events_append_only' using errcode = '55000';
end;
$$;

-- selected function public.replace_indexing_v3_core_embeddings
create or replace function public.replace_indexing_v3_core_embeddings(p_fence jsonb, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_generation uuid; v_row jsonb;
begin
  v_locked:=public.assert_current_ingestion_attempt(p_fence,(p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'job_kind'<>'indexing_v3' then raise exception 'indexing_v3_attempt_required'; end if;
  v_document_id:=(p_fence->>'document_id')::uuid; v_generation:=(p_fence->>'expected_generation_id')::uuid;
  if p_fields is not null and p_fields<>'null'::jsonb then
    if jsonb_typeof(p_fields)<>'array' or jsonb_array_length(p_fields)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_embedding_fields where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    delete from public.document_embedding_fields where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (field_type in ('document_title','document_summary'));
    for v_row in select value from jsonb_array_elements(p_fields) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));
      v_row:=v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
      insert into public.document_embedding_fields(id,owner_id,document_id,source_chunk_id,field_type,content,content_hash,embedding,index_generation_id,metadata) select r.id,r.owner_id,r.document_id,r.source_chunk_id,r.field_type,r.content,r.content_hash,r.embedding,r.index_generation_id,r.metadata from jsonb_populate_record(null::public.document_embedding_fields,v_row) r;
    end loop;
  end if;

  return jsonb_build_object('ok',true);
end $$;

-- selected function public.replace_indexing_v3_memory_cards
create or replace function public.replace_indexing_v3_memory_cards(p_fence jsonb, p_cards jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_generation uuid; v_row jsonb;
begin
  v_locked:=public.assert_current_ingestion_attempt(p_fence,(p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'job_kind'<>'indexing_v3' then raise exception 'indexing_v3_attempt_required'; end if;
  v_document_id:=(p_fence->>'document_id')::uuid; v_generation:=(p_fence->>'expected_generation_id')::uuid;
  if p_cards is not null and p_cards<>'null'::jsonb then
    if jsonb_typeof(p_cards)<>'array' or jsonb_array_length(p_cards)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_memory_cards where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    delete from public.document_memory_cards where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (metadata->>'source'='document_sections');
    for v_row in select value from jsonb_array_elements(p_cards) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));
      v_row:=v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
      insert into public.document_memory_cards(id,document_id,owner_id,section_id,card_type,title,content,normalized_terms,page_number,source_chunk_ids,source_image_ids,confidence,index_generation_id,producer,artifact_generation_id,metadata,embedding) select r.id,r.document_id,r.owner_id,r.section_id,r.card_type,r.title,r.content,r.normalized_terms,r.page_number,r.source_chunk_ids,r.source_image_ids,r.confidence,r.index_generation_id,r.producer,r.artifact_generation_id,r.metadata,r.embedding from jsonb_populate_record(null::public.document_memory_cards,v_row) r;
    end loop;
  end if;

  return jsonb_build_object('ok',true);
end $$;

-- selected function public.replace_indexing_v3_sections
create or replace function public.replace_indexing_v3_sections(p_fence jsonb, p_sections jsonb, p_units jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_generation uuid; v_row jsonb;
begin
  v_locked:=public.assert_current_ingestion_attempt(p_fence,(p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'job_kind'<>'indexing_v3' then raise exception 'indexing_v3_attempt_required'; end if;
  v_document_id:=(p_fence->>'document_id')::uuid; v_generation:=(p_fence->>'expected_generation_id')::uuid;
  if p_sections is not null and p_sections<>'null'::jsonb then
    if jsonb_typeof(p_sections)<>'array' or jsonb_array_length(p_sections)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_sections where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    if exists(select 1 from public.document_memory_cards c join public.document_sections x on x.id=c.section_id
      where x.document_id=v_document_id and x.index_generation_id=v_generation and x.metadata->>'generated_by'='indexing-v3-agent') then raise exception 'indexing_v3_section_still_referenced'; end if;
    delete from public.document_sections where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (true);
    for v_row in select value from jsonb_array_elements(p_sections) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));

      insert into public.document_sections(id,document_id,owner_id,section_index,heading,heading_path,page_start,page_end,chunk_ids,summary,tags,extraction_quality,index_generation_id,producer,artifact_generation_id,metadata) select r.id,r.document_id,r.owner_id,r.section_index,r.heading,r.heading_path,r.page_start,r.page_end,r.chunk_ids,r.summary,r.tags,r.extraction_quality,r.index_generation_id,r.producer,r.artifact_generation_id,r.metadata from jsonb_populate_record(null::public.document_sections,v_row) r;
    end loop;
  end if;
  if p_units is not null and p_units<>'null'::jsonb then
    if jsonb_typeof(p_units)<>'array' or jsonb_array_length(p_units)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_index_units where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    delete from public.document_index_units where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (unit_type='section_summary');
    for v_row in select value from jsonb_array_elements(p_units) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));
      v_row:=v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
      insert into public.document_index_units(id,owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,producer,artifact_generation_id,embedding,metadata) select r.id,r.owner_id,r.document_id,r.unit_type,r.source_chunk_id,r.source_image_id,r.page_start,r.page_end,r.heading_path,r.title,r.content,r.normalized_terms,r.source_span,r.quality_score,r.extraction_mode,r.index_generation_id,r.producer,r.artifact_generation_id,r.embedding,r.metadata from jsonb_populate_record(null::public.document_index_units,v_row) r;
    end loop;
  end if;

  return jsonb_build_object('ok',true);
end $$;

-- selected function public.replace_indexing_v3_visual_artifacts
create or replace function public.replace_indexing_v3_visual_artifacts(p_fence jsonb, p_images jsonb, p_units jsonb, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_generation uuid; v_row jsonb;
begin
  v_locked:=public.assert_current_ingestion_attempt(p_fence,(p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'job_kind'<>'indexing_v3' then raise exception 'indexing_v3_attempt_required'; end if;
  v_document_id:=(p_fence->>'document_id')::uuid; v_generation:=(p_fence->>'expected_generation_id')::uuid;
  if jsonb_typeof(p_images) is distinct from 'array' or jsonb_array_length(p_images)>500 then raise exception 'invalid_indexing_v3_images'; end if;
  for v_row in select value from jsonb_array_elements(p_images) loop
    if jsonb_typeof(v_row) is distinct from 'object' or jsonb_typeof(v_row->'metadata') is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_row->'metadata') k where k not in ('v3_structured_visual','v3_visual_metrics')) then raise exception 'invalid_indexing_v3_image_metadata'; end if;
    update public.document_images set metadata=metadata || v_row->'metadata' where id=(v_row->>'id')::uuid and document_id=v_document_id and index_generation_id=v_generation;
    if not found then raise exception 'indexing_v3_image_identity_mismatch'; end if;
  end loop;
  if p_units is not null and p_units<>'null'::jsonb then
    if jsonb_typeof(p_units)<>'array' or jsonb_array_length(p_units)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_index_units where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    delete from public.document_index_units where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (unit_type<>'section_summary');
    for v_row in select value from jsonb_array_elements(p_units) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));
      v_row:=v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
      insert into public.document_index_units(id,owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,producer,artifact_generation_id,embedding,metadata) select r.id,r.owner_id,r.document_id,r.unit_type,r.source_chunk_id,r.source_image_id,r.page_start,r.page_end,r.heading_path,r.title,r.content,r.normalized_terms,r.source_span,r.quality_score,r.extraction_mode,r.index_generation_id,r.producer,r.artifact_generation_id,r.embedding,r.metadata from jsonb_populate_record(null::public.document_index_units,v_row) r;
    end loop;
  end if;
  if p_fields is not null and p_fields<>'null'::jsonb then
    if jsonb_typeof(p_fields)<>'array' or jsonb_array_length(p_fields)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_embedding_fields where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    delete from public.document_embedding_fields where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (field_type not in ('document_title','document_summary'));
    for v_row in select value from jsonb_array_elements(p_fields) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));
      v_row:=v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
      insert into public.document_embedding_fields(id,owner_id,document_id,source_chunk_id,field_type,content,content_hash,embedding,index_generation_id,metadata) select r.id,r.owner_id,r.document_id,r.source_chunk_id,r.field_type,r.content,r.content_hash,r.embedding,r.index_generation_id,r.metadata from jsonb_populate_record(null::public.document_embedding_fields,v_row) r;
    end loop;
  end if;

  return jsonb_build_object('ok',true);
end $$;

-- selected function public.resolve_registered_published_admin_source_plan
create function public.resolve_registered_published_admin_source_plan(p_requester_id uuid,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.documents;c ingestion_generation_evidence.candidates;reader jsonb;chunk_ids uuid[];approval_id uuid;
begin
 if p_requester_id is null or p_requester_id='00000000-0000-0000-0000-000000000000'::uuid
   or p_document_id is null or not exists(select 1 from auth.users where id=p_requester_id and deleted_at is null)
   then raise exception 'registered_admin_source_authenticated_requester_required';end if;
 -- Discovery supplies no authority: the existing published reader validates and locks the current tuple below.
 select * into d from public.documents where id=p_document_id;
 if not found then return null;end if;
 select * into c from ingestion_generation_evidence.candidates where document_id=d.id and generation_id=d.index_generation_id;
 if not found or (c.source_section_layout is null and c.source_section_layout_bytes is null and c.source_section_layout_digest is null) then return null;end if;
 if d.owner_id is not null then return null;end if;
 perform ingestion_generation_evidence.assert_admin_text_source_section_layout(c);
 if jsonb_array_length(c.source_section_layout->'units')<>6 then return null;end if;
 approval_id:=(d.metadata->>'publication_approval_id')::uuid;
 select array_agg(id order by chunk_index,id) into chunk_ids from ingestion_generation_evidence.candidate_chunk_rows
   where document_id=d.id and index_generation_id=d.index_generation_id;
 reader:=public.read_published_admin_text_source_layout(p_requester_id,d.id,d.index_generation_id,approval_id,chunk_ids);
 -- Re-read the immutable registered plan after the reader holds its established locks.
 select * into strict c from ingestion_generation_evidence.candidates where document_id=d.id and generation_id=d.index_generation_id;
 perform ingestion_generation_evidence.assert_admin_text_source_section_layout(c);
 if reader->'inventory'->'sourceExpectation' is distinct from c.source_expectation then raise exception 'registered_admin_source_expectation_mismatch';end if;
 return jsonb_build_object('version','registered-published-admin-source-plan-v1','requesterId',p_requester_id,
   'documentId',d.id,'generationId',d.index_generation_id,'publicationApprovalId',reader->'publication'->'approvalId',
   'sourceExpectation',c.source_expectation,'sourceExpectationBytesHex',encode(c.source_expectation_bytes,'hex'),
   'sourceSectionLayout',c.source_section_layout,'sourceSectionLayoutBytesHex',encode(c.source_section_layout_bytes,'hex'),
   'registrationEvidence',jsonb_build_object('sourceSha256',c.source_sha256,'sourceExpectationDigest',c.source_expectation_digest,
     'sourceSectionLayoutDigest',c.source_section_layout_digest,'registrationDigest',ingestion_generation_evidence.admin_reference_digest(c.registration)));
exception when invalid_text_representation or character_not_in_repertoire or numeric_value_out_of_range then raise exception 'registered_admin_source_invalid';
end $$;

-- selected function public.retain_ingestion_generation_artifacts
create function public.retain_ingestion_generation_artifacts(p_fence jsonb,p_generation uuid,p_artifacts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c ingestion_generation_evidence.candidates;begin
  c:=ingestion_generation_evidence.lock_candidate(p_fence,p_generation);
  if c is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  perform ingestion_generation_evidence.retain(c,p_artifacts);
  return jsonb_build_object('ok',true);
end $$;

-- selected function public.start_ingestion_job_stage
create or replace function public.start_ingestion_job_stage(p_fence jsonb, p_stage text, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_stage uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_stage is null or length(p_stage) not between 1 and 240 or jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text)>65536 then raise exception 'invalid_ingestion_stage'; end if;
  insert into public.ingestion_job_stages(job_id,document_id,job_kind,lease_token,index_generation_id,stage_name,metadata)
  values((p_fence->>'job_id')::uuid,v_document_id,p_fence->>'job_kind',(p_fence->>'lease_token')::uuid,
    (p_fence->>'expected_generation_id')::uuid,p_stage,p_metadata) returning id into v_stage;
  return jsonb_build_object('ok',true,'stage_id',v_stage);
end $$;

-- selected function public.update_ingestion_job_progress
create or replace function public.update_ingestion_job_progress(p_fence jsonb, p_stage text, p_progress integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_progress is null or p_progress not between 0 and 100 or p_stage is null or length(p_stage) > 500 then raise exception 'invalid_ingestion_progress'; end if;
  update public.ingestion_jobs set stage=p_stage, progress=p_progress, locked_at=pg_catalog.clock_timestamp(),
    lease_expires_at=pg_catalog.clock_timestamp()+make_interval(secs=>lease_duration_seconds)
  where id = (p_fence->>'job_id')::uuid and document_id = v_document_id
    and p_fence->>'job_kind' = 'node' and locked_by = p_fence->>'worker_id'
    and lease_token = (p_fence->>'lease_token')::uuid and status = 'processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest = p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  return jsonb_build_object('ok',true);
end $$;

-- selected function public.write_ingestion_base_artifacts
create or replace function public.write_ingestion_base_artifacts(p_fence jsonb, p_generation uuid, p_chunks jsonb, p_images jsonb, p_table_facts jsonb, p_embedding_fields jsonb, p_index_units jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_row jsonb;
begin
  if p_generation is null or p_fence->>'job_kind' is distinct from 'node' then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  if exists(select 1 from ingestion_generation_evidence.candidates where document_id=(p_fence->>'document_id')::uuid and job_id=(p_fence->>'job_id')::uuid) then
    if jsonb_typeof(p_images) is distinct from 'array' or p_images<>'[]'::jsonb
      or jsonb_typeof(p_table_facts) is distinct from 'array' or p_table_facts<>'[]'::jsonb
      or jsonb_typeof(p_embedding_fields) is distinct from 'array' or p_embedding_fields<>'[]'::jsonb
      or jsonb_typeof(p_index_units) is distinct from 'array' or p_index_units<>'[]'::jsonb
      then return jsonb_build_object('ok',false,'reason','technical_supplier_not_implemented'); end if;
    return ingestion_generation_evidence.persist_candidate_chunks(p_fence,p_generation,p_chunks);
  end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_chunks) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_chunks(id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,retrieval_synopsis,content_hash,index_generation_id,token_estimate,image_ids,metadata,embedding) select r.id,r.document_id,r.page_number,r.chunk_index,r.section_heading,r.section_path,r.heading_level,r.parent_heading,r.anchor_id,r.content,r.retrieval_synopsis,r.content_hash,r.index_generation_id,r.token_estimate,r.image_ids,r.metadata,r.embedding
      from jsonb_populate_record(null::public.document_chunks,v_row) r;
  end loop;
  if jsonb_typeof(p_images) is distinct from 'array' or jsonb_array_length(p_images) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_images) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);
    if coalesce(v_row->>'storage_path','') !~ ('^' || v_document_id::text || '/' || (p_fence->>'lease_token') || '/' || p_generation::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then raise exception 'ingestion_image_path_mismatch'; end if;
    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));

    insert into public.document_images(id,document_id,page_number,storage_path,mime_type,caption,bbox,image_type,searchable,clinical_relevance_score,skip_reason,source_kind,width,height,image_hash,perceptual_hash,labels,index_generation_id,caption_confidence,clinical_priority_score,crop_completeness,image_quality_score,ocr_text_density,structured_extraction_confidence,visual_duplicate_group,metadata) select r.id,r.document_id,r.page_number,r.storage_path,r.mime_type,r.caption,r.bbox,r.image_type,r.searchable,r.clinical_relevance_score,r.skip_reason,r.source_kind,r.width,r.height,r.image_hash,r.perceptual_hash,r.labels,r.index_generation_id,r.caption_confidence,r.clinical_priority_score,r.crop_completeness,r.image_quality_score,r.ocr_text_density,r.structured_extraction_confidence,r.visual_duplicate_group,r.metadata
      from jsonb_populate_record(null::public.document_images,v_row) r;
  end loop;
  if jsonb_typeof(p_table_facts) is distinct from 'array' or jsonb_array_length(p_table_facts) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_table_facts) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));

    insert into public.document_table_facts(id,owner_id,document_id,source_chunk_id,source_image_id,page_number,table_title,row_label,clinical_parameter,threshold_value,action,normalized_terms,index_generation_id,metadata) select r.id,r.owner_id,r.document_id,r.source_chunk_id,r.source_image_id,r.page_number,r.table_title,r.row_label,r.clinical_parameter,r.threshold_value,r.action,r.normalized_terms,r.index_generation_id,r.metadata
      from jsonb_populate_record(null::public.document_table_facts,v_row) r;
  end loop;
  if jsonb_typeof(p_embedding_fields) is distinct from 'array' or jsonb_array_length(p_embedding_fields) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_embedding_fields) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_embedding_fields(id,owner_id,document_id,source_chunk_id,field_type,content,content_hash,embedding,index_generation_id,metadata) select r.id,r.owner_id,r.document_id,r.source_chunk_id,r.field_type,r.content,r.content_hash,r.embedding,r.index_generation_id,r.metadata
      from jsonb_populate_record(null::public.document_embedding_fields,v_row) r;
  end loop;
  if jsonb_typeof(p_index_units) is distinct from 'array' or jsonb_array_length(p_index_units) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_index_units) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',p_generation,'producer','local-worker','artifact_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_index_units(id,owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,producer,artifact_generation_id,embedding,metadata) select r.id,r.owner_id,r.document_id,r.unit_type,r.source_chunk_id,r.source_image_id,r.page_start,r.page_end,r.heading_path,r.title,r.content,r.normalized_terms,r.source_span,r.quality_score,r.extraction_mode,r.index_generation_id,r.producer,r.artifact_generation_id,r.embedding,r.metadata
      from jsonb_populate_record(null::public.document_index_units,v_row) r;
  end loop;
  return jsonb_build_object('ok',true);
end $$;

-- selected typed-page uniqueness/RLS/read view
create unique index document_pages_legacy_unique on public.document_pages(document_id,page_number) where index_generation_id is null;

-- selected typed-page uniqueness/RLS/read view
create unique index document_pages_generation_unique on public.document_pages(document_id,index_generation_id,page_number) where index_generation_id is not null;

-- selected typed-page uniqueness/RLS/read view
drop policy "pages owner read" on public.document_pages;

-- selected typed-page uniqueness/RLS/read view
create policy "pages owner read" on public.document_pages for select to authenticated using (
 exists(select 1 from public.documents d where d.id=public.document_pages.document_id and d.owner_id=(select auth.uid()) and public.is_visible_document_page(public.document_pages.index_generation_id,d.index_generation_id,d.page_storage_mode))
);

-- selected typed-page uniqueness/RLS/read view
create view public.document_current_pages with(security_invoker=true) as
select p.*,d.page_storage_mode,d.index_generation_id as committed_generation_id
from public.document_pages p join public.documents d on d.id=p.document_id
where public.is_visible_document_page(p.index_generation_id,d.index_generation_id,d.page_storage_mode);

-- selected committed-generation strict gate view
-- Completion observes only artifacts from the document's exact active
-- generation, or positively identified legacy rows when no generation metadata
-- exists. This is the accepted U01 gate required by the fenced completion RPCs.
create or replace view public.document_strict_gate_status
with (security_invoker = true)
as
with artifact_counts as (
  select
    d.id as document_id,
    d.owner_id,
    d.status as document_status,
    d.updated_at as document_updated_at,
    coalesce(d.metadata->>'enrichment_status', 'pending') as enrichment_status,
    coalesce(d.metadata->>'indexing_v3_agent_status', 'pending') as indexing_v3_agent_status,
    coalesce(q.extraction_quality, 'unknown') as quality_extraction_quality,
    coalesce(q.quality_score, 0)::real as quality_score,
    (
      select count(*)::integer
      from public.document_sections s
      where s.document_id = d.id
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and s.index_generation_id = d.index_generation_id
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and s.index_generation_id is null
          )
        )
    ) as sections,
    (
      select count(*)::integer
      from public.document_memory_cards m
      where m.document_id = d.id
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and m.index_generation_id = d.index_generation_id
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and m.index_generation_id is null
          )
        )
    ) as memory_cards,
    (
      select count(*)::integer
      from public.document_labels l
      where l.document_id = d.id
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and l.metadata->>'index_generation_id' = d.index_generation_id::text
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and l.metadata->>'index_generation_id' is null
          )
        )
        and (
          lower(l.source) = 'generated'
          or l.metadata->>'source' = 'generated'
          or l.metadata->>'generated_by' = 'indexing-v3-agent'
          or lower(coalesce(l.metadata->>'generation_source', '')) = 'indexing_v3_agent_parsed_artifacts'
        )
    ) as generated_labels,
    (
      select count(*)::integer
      from public.document_index_units u
      where u.document_id = d.id
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and u.index_generation_id = d.index_generation_id
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and u.index_generation_id is null
          )
        )
    ) as index_units,
    exists (
      select 1
      from public.document_embedding_fields f
      where f.document_id = d.id
        and f.field_type = 'document_title'
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and f.index_generation_id = d.index_generation_id
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and f.index_generation_id is null
          )
        )
      limit 1
    ) as title_embedding,
    exists (
      select 1
      from public.document_embedding_fields f
      where f.document_id = d.id
        and f.field_type = 'document_summary'
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and f.index_generation_id = d.index_generation_id
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and f.index_generation_id is null
          )
        )
      limit 1
    ) as summary_embedding
  from public.documents d
  left join public.document_index_quality q on q.document_id = d.id
),
gate as (
  select
    artifact_counts.*,
    array_remove(array[
      case when sections > 0 then null else 'sections' end,
      case when memory_cards > 0 then null else 'memory_cards' end,
      case when generated_labels > 0 then null else 'generated_labels' end,
      case when index_units > 0 then null else 'index_units' end,
      case when title_embedding then null else 'title_embedding' end,
      case when summary_embedding then null else 'summary_embedding' end
    ], null)::text[] as missing
  from artifact_counts
)
select
  document_id,
  owner_id,
  document_status,
  document_updated_at,
  enrichment_status,
  indexing_v3_agent_status,
  quality_extraction_quality,
  quality_score,
  sections,
  memory_cards,
  generated_labels,
  index_units,
  title_embedding,
  summary_embedding,
  missing,
  cardinality(missing) = 0 as gate_passed,
  jsonb_build_object(
    'sections', sections,
    'memory_cards', memory_cards,
    'generated_labels', generated_labels,
    'index_units', index_units
  ) as counts,
  jsonb_build_object(
    'title_embedding', title_embedding,
    'summary_embedding', summary_embedding
  ) as presence
from gate;

-- selected original function authority
revoke all on function public.claim_ingestion_jobs(text, integer, integer) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.claim_ingestion_jobs(text, integer, integer) to service_role;

-- selected original function authority
revoke all on function public.claim_indexing_v3_agent_jobs(text, integer, integer) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.claim_indexing_v3_agent_jobs(text, integer, integer) to service_role;

-- selected original function authority
revoke all on function public.lock_ingestion_document_authority(uuid, boolean) from public, anon, authenticated, service_role;

-- selected original function authority
revoke all on function public.assert_current_ingestion_attempt(jsonb, uuid) from public, anon, authenticated, service_role;

-- selected original function authority
alter function public.assert_ingestion_artifact_sources(jsonb,uuid,uuid,uuid) owner to postgres;

-- selected original function authority
revoke all on function public.assert_ingestion_artifact_sources(jsonb,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function public.persist_ingestion_summary_projection(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.persist_ingestion_summary_projection(jsonb,jsonb,jsonb,jsonb) to service_role;

-- selected original function authority
alter function public.heartbeat_ingestion_job(jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.heartbeat_ingestion_job(jsonb) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.heartbeat_ingestion_job(jsonb) to service_role;

-- selected original function authority
alter function public.heartbeat_indexing_v3_agent_job(jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.heartbeat_indexing_v3_agent_job(jsonb) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.heartbeat_indexing_v3_agent_job(jsonb) to service_role;

-- selected original function authority
alter function public.update_ingestion_job_progress(jsonb, text, integer) owner to postgres;

-- selected original function authority
revoke all on function public.update_ingestion_job_progress(jsonb, text, integer) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.update_ingestion_job_progress(jsonb, text, integer) to service_role;

-- selected original function authority
alter function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) to service_role;

-- selected original function authority
alter function public.start_ingestion_job_stage(jsonb, text, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.start_ingestion_job_stage(jsonb, text, jsonb) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.start_ingestion_job_stage(jsonb, text, jsonb) to service_role;

-- selected original function authority
alter function public.finish_ingestion_job_stage(jsonb, uuid, boolean, jsonb, text) owner to postgres;

-- selected original function authority
revoke all on function public.finish_ingestion_job_stage(jsonb, uuid, boolean, jsonb, text) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.finish_ingestion_job_stage(jsonb, uuid, boolean, jsonb, text) to service_role;

-- selected original function authority
alter function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- selected original function authority
alter function public.persist_ingestion_index_quality(jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.persist_ingestion_index_quality(jsonb, jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.persist_ingestion_index_quality(jsonb, jsonb) to service_role;

-- selected original function authority
alter function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) to service_role;

-- selected original function authority
alter function public.complete_ingestion_job(jsonb, uuid, text) owner to postgres;

-- selected original function authority
revoke all on function public.complete_ingestion_job(jsonb, uuid, text) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.complete_ingestion_job(jsonb, uuid, text) to service_role;

-- selected original function authority
alter function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) owner to postgres;

-- selected original function authority
revoke all on function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) to service_role;

-- selected original function authority
alter function public.complete_strict_enrichment_job(jsonb, text, text, text) owner to postgres;

-- selected original function authority
revoke all on function public.complete_strict_enrichment_job(jsonb, text, text, text) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.complete_strict_enrichment_job(jsonb, text, text, text) to service_role;

-- selected original function authority
alter function public.update_indexing_v3_agent_job_status(jsonb, text, text, timestamptz, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.update_indexing_v3_agent_job_status(jsonb, text, text, timestamptz, jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.update_indexing_v3_agent_job_status(jsonb, text, text, timestamptz, jsonb) to service_role;

-- selected original function authority
revoke all on function public.commit_document_index_generation(uuid,text,uuid,uuid,text,integer,integer,integer,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function public.complete_ingestion_job(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function public.complete_strict_enrichment_job(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;

-- selected original function authority
alter function public.replace_indexing_v3_sections(jsonb, jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.replace_indexing_v3_sections(jsonb, jsonb, jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.replace_indexing_v3_sections(jsonb, jsonb, jsonb) to service_role;

-- selected original function authority
alter function public.replace_indexing_v3_memory_cards(jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.replace_indexing_v3_memory_cards(jsonb, jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.replace_indexing_v3_memory_cards(jsonb, jsonb) to service_role;

-- selected original function authority
alter function public.replace_indexing_v3_core_embeddings(jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.replace_indexing_v3_core_embeddings(jsonb, jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.replace_indexing_v3_core_embeddings(jsonb, jsonb) to service_role;

-- selected original function authority
alter function public.replace_indexing_v3_visual_artifacts(jsonb, jsonb, jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.replace_indexing_v3_visual_artifacts(jsonb, jsonb, jsonb, jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.replace_indexing_v3_visual_artifacts(jsonb, jsonb, jsonb, jsonb) to service_role;

-- selected original function authority
revoke all on function public.commit_document_index_generation(uuid,uuid,text,integer,integer,integer,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function public.fail_or_retry_ingestion_job(uuid,uuid,uuid,boolean,text,text,text,timestamptz,text) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function public.update_indexing_v3_agent_job_status(uuid,text,text,timestamptz) from public,anon,authenticated,service_role;

-- selected original function authority
alter function public.lock_ingestion_document_authority(uuid,boolean) owner to postgres;

-- selected original function authority
alter function public.assert_current_ingestion_attempt(jsonb,uuid) owner to postgres;

-- selected original function authority
alter function public.claim_ingestion_jobs(text,integer,integer) owner to postgres;

-- selected original function authority
alter function public.claim_indexing_v3_agent_jobs(text,integer,integer) owner to postgres;

-- selected original function authority
alter function public.persist_ingestion_summary_projection(jsonb,jsonb,jsonb,jsonb) owner to postgres;

-- selected original function authority
alter function public.trusted_document_admission_core(jsonb, jsonb, boolean, text, uuid, text)
  owner to postgres;

-- selected original function authority
revoke all on function public.trusted_document_admission_core(jsonb, jsonb, boolean, text, uuid, text)
  from public, anon, authenticated, service_role;

-- selected original function authority
alter function public.admit_administrator_document(jsonb, jsonb, boolean) owner to postgres;

-- selected original function authority
revoke all on function public.admit_administrator_document(jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role;

-- selected original function authority
grant execute on function public.admit_administrator_document(jsonb, jsonb, boolean)
  to authenticated;

-- selected original function authority
revoke all on function public.reject_document_admission_event_mutation()
  from public, anon, authenticated, service_role;

-- selected original function authority
revoke execute on function public.begin_ingestion_generation_evidence(jsonb,uuid,jsonb,text) from public,anon,authenticated;

-- selected original function authority
revoke execute on function public.declare_ingestion_generation_evidence(jsonb,uuid,jsonb) from public,anon,authenticated;

-- selected original function authority
revoke execute on function public.retain_ingestion_generation_artifacts(jsonb,uuid,jsonb) from public,anon,authenticated;

-- selected original function authority
revoke execute on function public.record_ingestion_generation_outcomes(jsonb,uuid,jsonb) from public,anon,authenticated;

-- selected original function authority
revoke execute on function public.record_ingestion_generation_accounting(jsonb,uuid) from public,anon,authenticated;

-- selected original function authority
revoke execute on function public.read_ingestion_generation_inventory(jsonb,uuid) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.begin_ingestion_generation_evidence(jsonb,uuid,jsonb,text), public.declare_ingestion_generation_evidence(jsonb,uuid,jsonb), public.retain_ingestion_generation_artifacts(jsonb,uuid,jsonb), public.record_ingestion_generation_outcomes(jsonb,uuid,jsonb), public.record_ingestion_generation_accounting(jsonb,uuid), public.read_ingestion_generation_inventory(jsonb,uuid) to service_role;

-- selected original function authority
revoke all on function public.is_visible_document_page(uuid,uuid,text) from public;

-- selected original function authority
grant execute on function public.is_visible_document_page(uuid,uuid,text) to authenticated,service_role;

-- selected original function authority
revoke all on function ingestion_generation_evidence.guard_page_mode() from public,anon,authenticated,service_role;

-- selected original function authority
alter function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) to service_role;

-- selected original function authority
revoke all on function public.document_publication_state_digest(uuid, uuid) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.document_publication_state_digest(uuid, uuid) to service_role;

-- selected original function authority
alter function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- selected original function authority
alter function public.persist_ingestion_index_quality(jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.persist_ingestion_index_quality(jsonb, jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.persist_ingestion_index_quality(jsonb, jsonb) to service_role;

-- selected original function authority
revoke all on function public.persist_ingestion_summary_projection(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.persist_ingestion_summary_projection(jsonb,jsonb,jsonb,jsonb) to service_role;

-- selected original function authority
alter function public.complete_ingestion_job(jsonb, uuid, text) owner to postgres;

-- selected original function authority
revoke all on function public.complete_ingestion_job(jsonb, uuid, text) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.complete_ingestion_job(jsonb, uuid, text) to service_role;

-- selected original function authority
alter function public.complete_strict_enrichment_job(jsonb, text, text, text) owner to postgres;

-- selected original function authority
revoke all on function public.complete_strict_enrichment_job(jsonb, text, text, text) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.complete_strict_enrichment_job(jsonb, text, text, text) to service_role;

-- selected original function authority
alter function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) to service_role;

-- selected original function authority
alter function ingestion_generation_evidence.declare_groups(ingestion_generation_evidence.candidates,jsonb) owner to postgres;

-- selected original function authority
alter function ingestion_generation_evidence.retain(ingestion_generation_evidence.candidates,jsonb) owner to postgres;

-- selected original function authority
alter function public.begin_ingestion_generation_evidence(jsonb,uuid,jsonb,text) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.declare_groups(ingestion_generation_evidence.candidates,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function ingestion_generation_evidence.retain(ingestion_generation_evidence.candidates,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
revoke execute on function public.begin_ingestion_generation_evidence(jsonb,uuid,jsonb,text) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.begin_ingestion_generation_evidence(jsonb,uuid,jsonb,text) to service_role;

-- selected original function authority
-- Preserve the existing owner and role closure; no API role receives new authority.
alter function ingestion_generation_evidence.declare_groups(ingestion_generation_evidence.candidates,jsonb) owner to postgres;

-- selected original function authority
alter function ingestion_generation_evidence.retain(ingestion_generation_evidence.candidates,jsonb) owner to postgres;

-- selected original function authority
alter function public.record_ingestion_generation_outcomes(jsonb,uuid,jsonb) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.declare_groups(ingestion_generation_evidence.candidates,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function ingestion_generation_evidence.retain(ingestion_generation_evidence.candidates,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function public.record_ingestion_generation_outcomes(jsonb,uuid,jsonb) from public,anon,authenticated;

-- selected original function authority
-- Preserve existing private helper ownership/closure. No API role receives new authority.
alter function ingestion_generation_evidence.declare_groups(ingestion_generation_evidence.candidates,jsonb) owner to postgres;

-- selected original function authority
alter function ingestion_generation_evidence.retain(ingestion_generation_evidence.candidates,jsonb) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.declare_groups(ingestion_generation_evidence.candidates,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function ingestion_generation_evidence.retain(ingestion_generation_evidence.candidates,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
alter function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) owner to postgres;

-- selected original function authority
revoke all on function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) to service_role;

-- selected original function authority
alter function public.read_ingestion_generation_inventory(jsonb,uuid) owner to postgres;

-- selected original function authority
revoke all on function public.read_ingestion_generation_inventory(jsonb,uuid) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.read_ingestion_generation_inventory(jsonb,uuid) to service_role;

-- selected original function authority
alter function ingestion_generation_evidence.persist_candidate_chunks(jsonb,uuid,jsonb) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.persist_candidate_chunks(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
alter function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) owner to postgres;

-- selected original function authority
revoke all on function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- selected original function authority
grant execute on function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- selected original function authority
alter function ingestion_generation_evidence.candidate_enrichment_inputs(ingestion_generation_evidence.candidates,jsonb) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.candidate_enrichment_inputs(ingestion_generation_evidence.candidates,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
alter function public.read_ingestion_generation_inventory(jsonb,uuid) owner to postgres;

-- selected original function authority
revoke all on function public.read_ingestion_generation_inventory(jsonb,uuid) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.read_ingestion_generation_inventory(jsonb,uuid) to service_role;

-- selected original function authority
alter function public.begin_ingestion_generation_evidence(jsonb,uuid,jsonb,text) owner to postgres;

-- selected original function authority
alter function public.retain_ingestion_generation_artifacts(jsonb,uuid,jsonb) owner to postgres;

-- selected original function authority
alter function public.read_ingestion_generation_inventory(jsonb,uuid) owner to postgres;

-- selected original function authority
alter function ingestion_generation_evidence.visual_unit_fence(jsonb) owner to postgres;

-- selected original function authority
alter function public.begin_ingestion_generation_evidence(jsonb,uuid,jsonb,text) owner to postgres;

-- selected original function authority
alter function public.retain_ingestion_generation_artifacts(jsonb,uuid,jsonb) owner to postgres;

-- selected original function authority
alter function public.read_ingestion_generation_inventory(jsonb,uuid) owner to postgres;

-- selected original function authority
alter function public.read_ingestion_generation_inventory(jsonb,uuid) owner to postgres;

-- selected original function authority
alter function public.read_ingestion_prepared_supplier_artifacts(jsonb,uuid) owner to postgres;

-- selected original function authority
revoke all on function public.read_ingestion_prepared_supplier_artifacts(jsonb,uuid) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.read_ingestion_prepared_supplier_artifacts(jsonb,uuid) to service_role;

-- selected original function authority
alter function ingestion_generation_evidence.admin_text_commit_allowed(jsonb,uuid) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.admin_text_commit_allowed(jsonb,uuid) from public,anon,authenticated,service_role;

-- selected original function authority
alter function public.complete_managed_admin_text(jsonb,uuid,jsonb,boolean) owner to postgres;

-- selected original function authority
revoke all on function public.complete_managed_admin_text(jsonb,uuid,jsonb,boolean) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.complete_managed_admin_text(jsonb,uuid,jsonb,boolean) to service_role;

-- selected original function authority
alter function public.read_completed_admin_text_source_layout(uuid,uuid,uuid,uuid[]) owner to postgres;

-- selected original function authority
revoke all on function public.read_completed_admin_text_source_layout(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.read_completed_admin_text_source_layout(uuid,uuid,uuid,uuid[]) to service_role;

-- selected original function authority
alter function ingestion_generation_evidence.admin_text_utf16_length(text) owner to postgres;

-- selected original function authority
alter function ingestion_generation_evidence.admin_text_quality(ingestion_generation_evidence.candidates,integer) owner to postgres;

-- selected original function authority
alter function ingestion_generation_evidence.assert_admin_text_sections(ingestion_generation_evidence.candidates,jsonb,boolean) owner to postgres;

-- selected original function authority
alter function ingestion_generation_evidence.assert_admin_text_quality_state(ingestion_generation_evidence.candidates,jsonb,text) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.admin_text_utf16_length(text) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function ingestion_generation_evidence.admin_text_quality(ingestion_generation_evidence.candidates,integer) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function ingestion_generation_evidence.assert_admin_text_sections(ingestion_generation_evidence.candidates,jsonb,boolean) from public,anon,authenticated,service_role;

-- selected original function authority
revoke all on function ingestion_generation_evidence.assert_admin_text_quality_state(ingestion_generation_evidence.candidates,jsonb,text) from public,anon,authenticated,service_role;

-- selected original function authority
alter function public.complete_managed_admin_text(jsonb,uuid,jsonb,boolean) owner to postgres;

-- selected original function authority
revoke all on function public.complete_managed_admin_text(jsonb,uuid,jsonb,boolean) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.complete_managed_admin_text(jsonb,uuid,jsonb,boolean) to service_role;

-- selected original function authority
alter function public.read_completed_admin_text_source_layout(uuid,uuid,uuid,uuid[]) owner to postgres;

-- selected original function authority
revoke all on function public.read_completed_admin_text_source_layout(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.read_completed_admin_text_source_layout(uuid,uuid,uuid,uuid[]) to service_role;

-- selected original function authority
alter function ingestion_generation_evidence.assert_admin_text_sections(ingestion_generation_evidence.candidates,jsonb,boolean) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.assert_admin_text_sections(ingestion_generation_evidence.candidates,jsonb,boolean) from public,anon,authenticated,service_role;

-- selected original function authority
alter function public.complete_managed_admin_text(jsonb,uuid,jsonb,boolean) owner to postgres;

-- selected original function authority
revoke all on function public.complete_managed_admin_text(jsonb,uuid,jsonb,boolean) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.complete_managed_admin_text(jsonb,uuid,jsonb,boolean) to service_role;

-- selected original function authority
alter function ingestion_generation_evidence.admin_reference_digest(jsonb) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.admin_reference_digest(jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
alter function ingestion_generation_evidence.admin_reference_context(uuid,uuid,text,jsonb) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.admin_reference_context(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
alter function ingestion_generation_evidence.assert_admin_reference_sections(ingestion_generation_evidence.candidates,jsonb,boolean,uuid) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.assert_admin_reference_sections(ingestion_generation_evidence.candidates,jsonb,boolean,uuid) from public,anon,authenticated,service_role;

-- selected original function authority
alter function ingestion_generation_evidence.admin_reference_core(uuid,uuid,uuid[],text,jsonb) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.admin_reference_core(uuid,uuid,uuid[],text,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
alter function ingestion_generation_evidence.admin_reference_reviewed_state(uuid,jsonb) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.admin_reference_reviewed_state(uuid,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
alter function ingestion_generation_evidence.admin_reference_receipt(jsonb,jsonb) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.admin_reference_receipt(jsonb,jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
alter function ingestion_generation_evidence.admin_reference_evidence(jsonb) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.admin_reference_evidence(jsonb) from public,anon,authenticated,service_role;

-- selected original function authority
alter function ingestion_generation_evidence.admin_reference_decode(text[]) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.admin_reference_decode(text[]) from public,anon,authenticated,service_role;

-- selected original function authority
alter function public.prepare_completed_admin_text_reference(uuid,uuid,uuid,text,jsonb,boolean) owner to postgres;

-- selected original function authority
revoke all on function public.prepare_completed_admin_text_reference(uuid,uuid,uuid,text,jsonb,boolean) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.prepare_completed_admin_text_reference(uuid,uuid,uuid,text,jsonb,boolean) to service_role;

-- selected original function authority
alter function public.read_published_admin_text_source_layout(uuid,uuid,uuid,uuid,uuid[]) owner to postgres;

-- selected original function authority
revoke all on function public.read_published_admin_text_source_layout(uuid,uuid,uuid,uuid,uuid[]) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.read_published_admin_text_source_layout(uuid,uuid,uuid,uuid,uuid[]) to service_role;

-- selected original function authority
alter function public.trusted_document_admission_core(jsonb, jsonb, boolean, text, uuid, text)
  owner to postgres;

-- selected original function authority
revoke all on function public.trusted_document_admission_core(jsonb, jsonb, boolean, text, uuid, text)
  from public, anon, authenticated, service_role;

-- selected original function authority
alter function ingestion_generation_evidence.assert_admin_text_source_section_layout(ingestion_generation_evidence.candidates) owner to postgres;

-- selected original function authority
revoke all on function ingestion_generation_evidence.assert_admin_text_source_section_layout(ingestion_generation_evidence.candidates) from public,anon,authenticated,service_role;

-- selected original function authority
alter function ingestion_generation_evidence.immutable() owner to postgres;

-- selected original function authority
alter function public.register_admin_text_source_section_layout(jsonb,uuid,text,jsonb,text,text) owner to postgres;

-- selected original function authority
revoke all on function public.register_admin_text_source_section_layout(jsonb,uuid,text,jsonb,text,text) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.register_admin_text_source_section_layout(jsonb,uuid,text,jsonb,text,text) to service_role;

-- selected original function authority
alter function public.resolve_registered_published_admin_source_plan(uuid,uuid) owner to postgres;

-- selected original function authority
revoke all on function public.resolve_registered_published_admin_source_plan(uuid,uuid) from public,anon,authenticated;

-- selected original function authority
grant execute on function public.resolve_registered_published_admin_source_plan(uuid,uuid) to service_role;

-- private helper authority
revoke all on all functions in schema ingestion_generation_evidence from public,anon,authenticated,service_role;
revoke all on all tables in schema ingestion_generation_evidence from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema ingestion_generation_evidence revoke execute on functions from public;

-- new table authority
alter table ingestion_generation_evidence.candidate_chunk_rows owner to postgres;
alter table ingestion_generation_evidence.candidate_chunk_rows enable row level security;
revoke all on table ingestion_generation_evidence.candidate_chunk_rows from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.candidate_chunk_rows for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.candidate_chunk_rows for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.candidates owner to postgres;
alter table ingestion_generation_evidence.candidates enable row level security;
revoke all on table ingestion_generation_evidence.candidates from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.candidates for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.candidates for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.managed_vector_packets owner to postgres;
alter table ingestion_generation_evidence.managed_vector_packets enable row level security;
revoke all on table ingestion_generation_evidence.managed_vector_packets from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.managed_vector_packets for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.managed_vector_packets for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.outcomes owner to postgres;
alter table ingestion_generation_evidence.outcomes enable row level security;
revoke all on table ingestion_generation_evidence.outcomes from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.outcomes for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.outcomes for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.prerequisite_accounting owner to postgres;
alter table ingestion_generation_evidence.prerequisite_accounting enable row level security;
revoke all on table ingestion_generation_evidence.prerequisite_accounting from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.prerequisite_accounting for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.prerequisite_accounting for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.producer_declarations owner to postgres;
alter table ingestion_generation_evidence.producer_declarations enable row level security;
revoke all on table ingestion_generation_evidence.producer_declarations from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.producer_declarations for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.producer_declarations for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.retained_artifacts owner to postgres;
alter table ingestion_generation_evidence.retained_artifacts enable row level security;
revoke all on table ingestion_generation_evidence.retained_artifacts from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.retained_artifacts for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.retained_artifacts for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.scoped_projection_expectations owner to postgres;
alter table ingestion_generation_evidence.scoped_projection_expectations enable row level security;
revoke all on table ingestion_generation_evidence.scoped_projection_expectations from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.scoped_projection_expectations for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.scoped_projection_expectations for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.scoped_projection_rows owner to postgres;
alter table ingestion_generation_evidence.scoped_projection_rows enable row level security;
revoke all on table ingestion_generation_evidence.scoped_projection_rows from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.scoped_projection_rows for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.scoped_projection_rows for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.unit_declarations owner to postgres;
alter table ingestion_generation_evidence.unit_declarations enable row level security;
revoke all on table ingestion_generation_evidence.unit_declarations from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.unit_declarations for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.unit_declarations for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.visual_unit_expectations owner to postgres;
alter table ingestion_generation_evidence.visual_unit_expectations enable row level security;
revoke all on table ingestion_generation_evidence.visual_unit_expectations from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.visual_unit_expectations for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.visual_unit_expectations for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table ingestion_generation_evidence.visual_unit_rows owner to postgres;
alter table ingestion_generation_evidence.visual_unit_rows enable row level security;
revoke all on table ingestion_generation_evidence.visual_unit_rows from public,anon,authenticated,service_role;

-- immutable evidence
create trigger evidence_immutable before update or delete on ingestion_generation_evidence.visual_unit_rows for each row execute function ingestion_generation_evidence.immutable();
create trigger evidence_no_truncate before truncate on ingestion_generation_evidence.visual_unit_rows for each statement execute function ingestion_generation_evidence.immutable();

-- new table authority
alter table public.document_admission_events owner to postgres;
alter table public.document_admission_events enable row level security;
revoke all on table public.document_admission_events from public,anon,authenticated,service_role;

-- typed-page sole-writer guard
create trigger documents_page_storage_mode_owner before insert or update on public.documents for each row execute function ingestion_generation_evidence.guard_page_mode();

-- immutable administrator admission
create trigger reject_document_admission_event_update before update on public.document_admission_events for each row execute function public.reject_document_admission_event_mutation();
create trigger reject_document_admission_event_delete before delete on public.document_admission_events for each row execute function public.reject_document_admission_event_mutation();

-- old unfenced overload denied after caller cutover
revoke all on function public.commit_document_index_generation(p_document_id uuid, p_index_generation_id uuid, p_status text, p_page_count integer, p_chunk_count integer, p_image_count integer, p_metadata jsonb, p_pages jsonb, p_quality jsonb) from public,anon,authenticated,service_role;

-- old unfenced overload denied after caller cutover
revoke all on function public.commit_document_index_generation(p_job_id uuid, p_worker_id text, p_document_id uuid, p_index_generation_id uuid, p_status text, p_page_count integer, p_chunk_count integer, p_image_count integer, p_metadata jsonb, p_pages jsonb, p_quality jsonb) from public,anon,authenticated,service_role;

-- old unfenced overload denied after caller cutover
revoke all on function public.complete_ingestion_job(p_job_id uuid, p_document_id uuid, p_batch_id uuid, p_stage text, p_worker_id text) from public,anon,authenticated,service_role;

-- old unfenced overload denied after caller cutover
revoke all on function public.complete_strict_enrichment_job(p_document_id uuid, p_job_id uuid, p_stage text, p_agent_version text, p_visual_indexing_version text) from public,anon,authenticated,service_role;

-- old unfenced overload denied after caller cutover
revoke all on function public.fail_or_retry_ingestion_job(p_job_id uuid, p_document_id uuid, p_batch_id uuid, p_retry boolean, p_document_status text, p_stage text, p_error_message text, p_next_run_at timestamp with time zone, p_worker_id text) from public,anon,authenticated,service_role;

-- old unfenced overload denied after caller cutover
revoke all on function public.update_indexing_v3_agent_job_status(p_document_id uuid, p_status text, p_error text, p_next_run_at timestamp with time zone) from public,anon,authenticated,service_role;

-- legacy generic admission denial
-- Preserve the old signature only as an explicit denial.  Possession of a
-- generic service credential no longer confers document-admission authority.
create or replace function public.create_uploaded_document_with_ingestion_job(
  p_document jsonb,
  p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'trusted_document_admission_required' using errcode = '42501';
end;
$$;

-- legacy generic admission denial authority
alter function public.create_uploaded_document_with_ingestion_job(jsonb,integer) owner to postgres;
revoke all on function public.create_uploaded_document_with_ingestion_job(jsonb,integer) from public,anon,authenticated,service_role;

commit;
