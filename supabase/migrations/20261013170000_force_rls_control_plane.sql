-- Forward migration to apply FORCE ROW LEVEL SECURITY on six control-plane tables (#AD3F5B)
-- and promote site_content_release_records_immutable trigger to ENABLE ALWAYS (#4W704K).
--
-- Ledger issues: #AD3F5B, #4W704K
--
-- 1. FORCE ROW LEVEL SECURITY on six control-plane tables (#AD3F5B):
--    - clinical_quality_feedback_triage
--    - clinical_quality_feedback_triage_events
--    - document_corpus_access_snapshots
--    - document_corpus_access_state
--    - public_source_activation_guards
--    - public_source_cleanup_mutation_guards
--    Ref: docs/supabase-remediation-closeout-notes.md § 1.3 / § 2
--
-- 2. ENABLE ALWAYS TRIGGER on site_content_release_records_immutable (#4W704K):
--    Ensures session_replication_role = replica cannot bypass the table's freeze protection.
--    Ref: supabase/migrations/20260916190000_seal_bootstrap_release_and_drop_per_read_digest.sql

set local lock_timeout = '10s';
set local statement_timeout = '30s';

alter table public.clinical_quality_feedback_triage force row level security;
alter table public.clinical_quality_feedback_triage_events force row level security;
alter table public.document_corpus_access_snapshots force row level security;
alter table public.document_corpus_access_state force row level security;
alter table public.public_source_activation_guards force row level security;
alter table public.public_source_cleanup_mutation_guards force row level security;

alter table public.site_content_release_records
  enable always trigger site_content_release_records_immutable;
