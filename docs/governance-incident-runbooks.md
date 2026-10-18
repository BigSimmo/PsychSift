# Clinical governance incident runbooks

Last reviewed: 2026-10-18 (repository contracts; not live execution)

These are short operator checklists. Preserve evidence and identifiers, but do not copy patient-identifying question or answer prose into tickets or chat.

## Escalation and backup-operator authority

- **Primary clinical governance owner:** Clinical Lead (`Josh` / designated clinical governance reviewer).
- **Backup operator when primary owner is unavailable (> 15 minutes for P0/P1 clinical safety or privacy containment):** Any on-call platform operator with Railway and Supabase production access is authorised to execute immediate **containment actions** (setting `RAG_PROVIDER_MODE=offline`, setting `WORKER_PAUSED=true`, quarantining an implicated source, and purging `rag_response_cache`) without waiting for clinical sign-off.
- **Unblocking / restoration gate:** Backup operators may **contain and roll back** immediately, but **re-enabling** generative answer modes or lifting a `decommissioned` / `superseded` source quarantine still requires explicit review from the primary clinical owner or designated clinical deputy.

## Adverse clinical output

1. Record the answer interaction ID, feedback category, cited source IDs, time, and affected workflow:
   ```sql
   SELECT id, interaction_id, created_at, feedback_category, cited_source_ids, source_ids
   FROM public.rag_answer_feedback
   WHERE interaction_id = '<interaction-uuid>'::uuid;
   ```
2. If harm is plausible, disable the affected answer mode or narrow its source scope; keep direct source browsing available:
   ```bash
   # Switch answer generation to deterministic offline/source-only mode immediately
   railway variables --service PsychSift --set "RAG_PROVIDER_MODE=offline"
   # Pause background worker ingestion/enrichment claims if source mutation is in flight
   railway variables --service worker --set "WORKER_PAUSED=true"
   ```
3. Quarantine an implicated source through a `decommissioned` or `superseded` source-review event when appropriate:
   ```sql
   -- The reviewer must own the document. This existing RPC locks the row,
   -- appends source_review_events, and updates its governance metadata atomically.
   SELECT public.record_source_review(
     p_document_id => '<document-uuid>'::uuid,
     p_reviewer_id => '<document-owner-reviewer-uuid>'::uuid,
     p_decision => 'decommissioned',
     p_reason => '<ticket-or-incident-ref>',
     p_evidence_references => ARRAY['<evidence-reference>']
   );
   ```
4. Reproduce with a synthetic or minimised fixture, add a regression test, and identify whether retrieval, generation, rendering, or copy caused the defect:
   ```bash
   npm run eval:rag:offline
   npm run check:clinical-hazard-controls
   ```
5. Restore the feature only after the narrow regression and production-readiness checks pass and the clinical owner reviews material clinical-policy changes (if the primary clinical owner is unavailable, keep `RAG_PROVIDER_MODE=offline` active under backup-operator containment until clinical review completes).

## Source quarantine, recall, or replacement

1. Record an evidence-bearing review event with a reason and replacement document where applicable:
   ```sql
   BEGIN;

   -- The reviewer must own the document. This existing RPC locks the row,
   -- appends source_review_events, and updates its governance metadata atomically.
   SELECT public.record_source_review(
     p_document_id => '<document-uuid>'::uuid,
     p_reviewer_id => '<document-owner-reviewer-uuid>'::uuid,
     p_decision => 'decommissioned',
     p_reason => '<ticket-or-incident-ref>',
     p_evidence_references => ARRAY['<evidence-reference>']
   );
   COMMIT;
   ```
2. If immediate containment is required, disable the affected answer mode or narrow its source scope; do not treat review status alone as a retrieval exclusion:
   ```bash
   railway variables --service PsychSift --set "RAG_PROVIDER_MODE=offline"
   railway variables --service worker --set "WORKER_PAUSED=true"
   ```
3. Confirm answer caches for the owner are invalidated after the transaction commits:
   ```sql
   DELETE FROM public.rag_response_cache
   WHERE owner_id = '<owner-uuid>'
      OR payload::text LIKE '%<document-uuid>%';
   ```
4. Before declaring containment, verify the source remains directly browsable (`metadata->>'governance_disposition' = 'decommissioned'`), that retrieval exclusion is active (`RAG_PROVIDER_MODE=offline` or zero active retrieval chunks for the quarantined `document_id`), and that `rag_response_cache` contains zero entries referencing the quarantined document:
   ```sql
   SELECT d.id,
          d.title,
          d.metadata->>'governance_disposition' AS governance_disposition,
          d.metadata->>'rag_indexed' AS rag_indexed,
          (SELECT count(*) FROM public.document_chunks c WHERE c.document_id = d.id) AS chunk_count,
          (SELECT count(*) FROM public.rag_response_cache r WHERE r.payload::text LIKE '%' || d.id::text || '%') AS cached_answer_count
   FROM public.documents d
   WHERE d.id = '<document-uuid>';
   ```
   Before lifting `RAG_PROVIDER_MODE=offline`, require retrieval evidence rather than the containment setting itself: `chunk_count` above must be `0`, or the restored retrieval path must be shown to exclude the quarantined `document_id` from the `sources` it returns (a non-offline staging probe; the answer's `citations` are not enough, because retrieved results reach answer generation whether or not they are cited). An `/api/ask` probe made while offline, or reading the Railway variable, only confirms the temporary containment. To read that one setting, print only it (`railway variables --service PsychSift --kv | grep '^RAG_PROVIDER_MODE='`), never the whole service environment, which contains credentials.
5. Re-run source-governance and focused answer tests. Live data repair or migration requires explicit approval (if the primary owner is unavailable, the backup operator must leave the source quarantined and `rag_response_cache` purged until explicit approval is obtained):
   ```bash
   npm run audit:source-governance
   npm run check:clinical-hazard-controls
   ```

## Privacy or provider incident

1. Preserve interaction IDs, hashes, timestamps, configuration-posture versions, and provider request IDs; do not preserve raw clinical prose unless an authorised incident process requires it:
   ```sql
   SELECT id, created_at, metadata
   FROM public.rag_queries
   WHERE created_at >= timezone('utc', now()) - interval '24 hours'
   ORDER BY created_at DESC;
   ```
2. Disable provider generation or switch to the source-only path if external processing must stop:
   ```bash
   railway variables --service PsychSift --set "RAG_PROVIDER_MODE=offline"
   railway variables --service worker --set "WORKER_PAUSED=true"
   ```
3. If raw query persistence, answer persistence, or provider response storage is enabled, disable the affected path. Verify all three controls are off before proceeding:
   ```bash
   railway variables --service PsychSift \
     --set "RAG_PERSIST_RAW_QUERY_TEXT=false" \
     --set "RAG_PERSIST_ANSWER_TEXT=false" \
     --set "OPENAI_STORE_RESPONSES=false"
   ```
4. Inspect affected answer copies in `rag_response_cache.payload`; invalidate affected owners and purge incident-related rows where appropriate, then verify the bounded retention purge before assessing other cache and telemetry retention:
   ```sql
   DELETE FROM public.rag_response_cache
   WHERE owner_id = '<owner-uuid>'
      OR created_at >= '<incident-window-start-iso>';

   SELECT public.purge_expired_rag_response_cache();
   ```
5. Escalate notification and breach decisions to the privacy owner; this runbook does not make that legal determination. If the primary privacy owner is unavailable, the backup operator must complete steps 1–4 immediately, seal the audit metadata snapshot, and page the secondary governance contact.

## Answer-pipeline rollback

1. Revert or disable the smallest affected generation or ranking feature while retaining source browsing and deterministic source-only answers:
   ```bash
   railway variables --service PsychSift --set "RAG_PROVIDER_MODE=offline"
   railway variables --service worker --set "WORKER_PAUSED=true"
   ```
   Verify `/api/health` (`deploymentCommitSha`) and worker `/health` (`claimLoopPaused: true`, `deploymentCommitSha`) confirm the active release and paused worker loop:
   ```bash
   curl -fsS https://<app-host>/api/health | jq '{status, version, deploymentCommitSha}'
   curl -fsS http://<worker-host>:8080/health | jq '{ok, claimLoopPaused, deploymentCommitSha}'
   ```
2. Do not weaken danger-source exclusion, query and answer minimisation, or private-document access to restore availability.
3. Run the focused regression, offline RAG evaluation, production-readiness CI check, and local PR mirror before release (backup operators may roll back to the previous known-good release image immediately, then hold forward promotion until these checks pass):
   ```bash
   npm run eval:rag:offline
   npm run check:production-readiness:ci
   npm run verify:pr-local
   ```
