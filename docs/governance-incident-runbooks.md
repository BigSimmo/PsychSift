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
   SELECT id, interaction_id, created_at, feedback_category, cited_source_ids, source_ids, route, model, owner_id
   FROM public.rag_answer_feedback
   WHERE interaction_id = '<interaction-uuid>'::uuid;
   -- or, with only the feedback row: WHERE id = '<feedback-uuid>'::uuid
   ```
   The table stores an answer hash, not answer prose. There is no configuration-posture column; record the active release from `/api/health` (`deploymentCommitSha`) instead.
2. If harm is plausible, disable the affected answer mode or narrow its source scope; keep direct source browsing available:
   ```bash
   # Switch answer generation to deterministic offline/source-only mode immediately
   railway variables --environment production --service PsychSift --set "RAG_PROVIDER_MODE=offline"
   # Pause background worker ingestion/enrichment claims if source mutation is in flight
   railway variables --environment production --service worker --set "WORKER_PAUSED=true"
   ```
3. Quarantine an implicated source through a `decommissioned` or `superseded` source-review event when appropriate. Follow step 1 of [Source quarantine, recall, or replacement](#source-quarantine-recall-or-replacement); never update `documents` directly.
4. Reproduce with a synthetic or minimised fixture, add a regression test, and identify whether retrieval, generation, rendering, or copy caused the defect:
   ```bash
   npm run eval:rag:offline
   npm run check:clinical-hazard-controls
   ```
5. Restore the feature only after the narrow regression and production-readiness checks pass and the clinical owner reviews material clinical-policy changes (if the primary clinical owner is unavailable, keep `RAG_PROVIDER_MODE=offline` active under backup-operator containment until clinical review completes).

## Source quarantine, recall, or replacement

1. Record an evidence-bearing review event with a reason and replacement document where applicable. There is no `source_review_status` column and no `document_governance_events` table. Review events live in `source_review_events`, and the only supported writer is `record_source_review_v2`, which writes the event and updates `documents.metadata` (`document_status = 'outdated'`, `governance_disposition = '<decision>'`) in one transaction.
   - Preferred: the signed-in owner records the decision in the app (it calls `POST /api/documents/<document-uuid>/reviews` with `decision`, `reason`, `evidenceReferences` and, for `superseded`, `replacementDocumentId`).
   - If the app is unavailable, run the same function in the Supabase SQL editor (it is granted to `service_role` only). `superseded` requires `p_replacement_document_id`; `decommissioned` does not:
   ```sql
   SELECT public.record_source_review_v2(
     p_document_id => '<document-uuid>'::uuid,
     p_reviewer_id => '<document-owner-reviewer-uuid>'::uuid,
     p_decision => 'decommissioned',
     p_reason => '<ticket-or-incident-ref>',
     p_evidence_references => ARRAY['<ticket-or-incident-ref>'],
     p_replacement_document_id => NULL
   );
   ```
2. If immediate containment is required, disable the affected answer mode or narrow its source scope; do not treat review status alone as a retrieval exclusion:
   ```bash
   railway variables --environment production --service PsychSift --set "RAG_PROVIDER_MODE=offline"
   railway variables --environment production --service worker --set "WORKER_PAUSED=true"
   ```
3. Confirm answer caches for the owner are invalidated after the transaction commits:
   ```sql
   DELETE FROM public.rag_response_cache
   WHERE owner_id = '<owner-uuid>'
      OR payload::text LIKE '%<document-uuid>%';
   ```
4. Before declaring containment, verify the review event is recorded and the source remains directly browsable (`metadata->>'governance_disposition'` is `decommissioned` or `superseded`), that retrieval exclusion is active (`RAG_PROVIDER_MODE=offline` or zero active retrieval chunks for the quarantined `document_id`), and that `rag_response_cache` contains zero entries referencing the quarantined document:
   ```sql
   SELECT d.id,
          d.title,
          d.metadata->>'document_status' AS document_status,
          d.metadata->>'governance_disposition' AS governance_disposition,
          (SELECT max(e.created_at) FROM public.source_review_events e WHERE e.document_id = d.id AND e.decision IN ('decommissioned', 'superseded')) AS last_quarantine_event_at,
          d.metadata->>'rag_indexed' AS rag_indexed,
          (SELECT count(*) FROM public.document_chunks c WHERE c.document_id = d.id) AS chunk_count,
          (SELECT count(*) FROM public.rag_response_cache r WHERE r.payload::text LIKE '%' || d.id::text || '%') AS cached_answer_count
   FROM public.documents d
   WHERE d.id = '<document-uuid>';
   ```
   Before lifting `RAG_PROVIDER_MODE=offline`, require retrieval evidence rather than the containment setting itself: `chunk_count` above must be `0`, or the restored retrieval path must be shown to exclude the quarantined `document_id` from the `sources` it returns (a non-offline staging probe; the answer's `citations` are not enough, because retrieved results reach answer generation whether or not they are cited). An `/api/answer` probe made while offline, or reading the Railway variable, only confirms the temporary containment. To read that one setting, print only it (`railway variables --environment production --service PsychSift --kv | grep '^RAG_PROVIDER_MODE='`), never the whole service environment, which contains credentials.
5. Re-run source-governance and focused answer tests. Live data repair or migration requires explicit approval (if the primary owner is unavailable, the backup operator must leave the source quarantined and `rag_response_cache` purged until explicit approval is obtained):
   ```bash
   npm run audit:source-governance        # reads the live database: needs the owner's explicit approval
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
   railway variables --environment production --service PsychSift --set "RAG_PROVIDER_MODE=offline"
   railway variables --environment production --service worker --set "WORKER_PAUSED=true"
   ```
3. If raw query persistence, answer persistence, or provider response storage is enabled, disable the affected path. Verify all three controls are off before proceeding:
   ```bash
   railway variables --environment production --service PsychSift \
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
5. Escalate notification and breach decisions to the privacy owner (see [Notifiable data breach (Australia)](#notifiable-data-breach-australia)); this runbook does not make that legal determination. If the primary privacy owner is unavailable, the backup operator must complete steps 1–4 immediately, seal the audit metadata snapshot, and page the secondary governance contact.

## Notifiable data breach (Australia)

> **Draft for the owner to confirm.** This section summarises the Office of the Australian Information Commissioner (OAIC) Notifiable Data Breaches scheme under Part IIIC of the _Privacy Act 1988_. It is not legal advice, and the owner has not yet confirmed it.

1. Treat any unauthorised access to, disclosure of, or loss of personal or health information as a suspected eligible data breach. Contain it first with the [privacy or provider incident](#privacy-or-provider-incident) steps.
2. Start a written assessment straight away. Record the date the suspicion arose, what information was involved, whose information it was, and what containment was done. The assessment must be reasonable, quick, and finished within **30 days** of becoming aware of the suspected breach.
3. Decide whether serious harm is likely for any affected person. Health information is high risk. If remedial action taken before any harm occurs means serious harm is no longer likely, the breach is not notifiable, but keep the record.
4. If serious harm is likely, notify **as soon as practicable**:
   - the OAIC, using the Notifiable Data Breach form on the OAIC website, with the organisation's contact details, a description of the breach, the kinds of information involved, and recommended steps for affected people; and
   - each affected person (or, if that is not practicable, publish the statement and take reasonable steps to bring it to their attention).
5. Keep the assessment, decision, notifications, and evidence with the incident record. Do not put patient-identifying prose in tickets or chat.
6. The owner makes the notification decision. This runbook does not make that legal determination.

## Answer-pipeline rollback

1. Revert or disable the smallest affected generation or ranking feature while retaining source browsing and deterministic source-only answers:
   ```bash
   railway variables --environment production --service PsychSift --set "RAG_PROVIDER_MODE=offline"
   railway variables --environment production --service worker --set "WORKER_PAUSED=true"
   ```
   Verify `/api/health` (`deploymentCommitSha`) and worker `/health` (`claimLoopPaused: true`, `deploymentCommitSha`) confirm the active release and paused worker loop:
   ```bash
   curl -fsS https://<app-host>/api/health | jq '{status, version, deploymentCommitSha}'
   # The worker has no public domain; it binds /health on Railway's PORT (or WORKER_HEALTH_PORT).
   # Check it from inside the service, or confirm the pause in `railway logs --service worker`.
   # The worker image has no curl, so use the Node runtime it ships with.
   railway ssh --environment production --service worker -- node -e 'fetch("http://127.0.0.1:"+(process.env.WORKER_HEALTH_PORT||process.env.PORT)+"/health").then(r=>r.text()).then(t=>console.log(t))'
   ```
   Expect `claimLoopPaused: true` and the expected `deploymentCommitSha` in the worker output. Changing a Railway variable redeploys that service, so wait for the new deployment to finish before checking.
2. Do not weaken danger-source exclusion, query and answer minimisation, or private-document access to restore availability.
3. Run the focused regression, offline RAG evaluation, production-readiness CI check, and local PR mirror before release (backup operators may roll back to the previous known-good release image immediately, then hold forward promotion until these checks pass):
   ```bash
   npm run eval:rag:offline
   npm run check:production-readiness:ci
   npm run verify:pr-local
   ```
