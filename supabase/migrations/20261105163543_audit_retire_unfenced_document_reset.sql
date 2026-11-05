-- Retire the confirmed destructive, unfenced reset authority after first-party callers
-- moved to generation-preserving enqueue/maintenance. Historical migration text and
-- validators remain immutable. Old maintenance tooling must be quiesced before rollout.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- RESTRICT intentionally refuses an undiscovered catalog dependency; never cascade.
-- The fenced worker reset_ingestion_attempt_artifacts(jsonb,uuid) is unchanged.
drop function public.reset_document_index(uuid) restrict;
