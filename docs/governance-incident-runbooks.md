# Clinical governance incident runbooks

Procedure checked against repository contracts: 2026-10-21. This is an operator reference, not a live containment rehearsal or clinical sign-off.

Preserve interaction IDs, source IDs, timestamps, hashes and provider request IDs. Do not copy patient-identifying question or answer prose into tickets or chat.

## Escalation, authority and target identity

- **Primary clinical governance owner:** Clinical Lead (`Josh` / designated clinical governance reviewer).
- **Backup operator when the primary owner is unavailable (> 15 minutes for P0/P1 containment):** the on-call platform operator follows the existing incident authority for containment and rollback. Access alone does not authorise a new live database change; the [owner's specific-change permission rule](decisions/2026-10-15-database-changes-need-owner-permission.md) and the AGENTS.md provider/spending boundaries still apply. Escalate a blocked action and keep its containment status explicit.
- **Restoration:** re-enabling generative modes or lifting a source's `decommissioned` / `superseded` disposition requires the primary clinical owner or designated clinical deputy's review. Clinical sign-off remains owner-only where required by project policy.
- **Before any provider read or mutation:** confirm the exact target using [deployment architecture](deployment-architecture.md). Production is Railway project `PsychSift` (`5deaad0b-675a-4c13-978e-5ca2b5b877f9`), environment `production` (`6aa16f7b-d3e8-4aa2-9854-ee9ead9fcbd4`), app service `PsychSift` and worker service `worker`; Supabase is `PsychSift Production` (`sjrfecxgysukkwxsowpy`). Recheck these recorded identities in the authorised operator session and retain the selected service/deployment IDs. Stop on a mismatch. Use the explicitly selected service's supported variable editor; do not rely on a checkout's implicit CLI link or dump secret values into evidence.

## Adverse clinical output

1. Record the interaction ID, feedback category, cited source IDs, time and affected workflow. An approved, owner-scoped database read can use the supported feedback table; substitute real UUIDs before execution:
   ```sql
   SELECT id, interaction_id, created_at, feedback_category, cited_source_ids, provider_request_ids
   FROM public.rag_answer_feedback
   WHERE interaction_id = '<interaction-uuid>'::uuid
     AND owner_id = '<owner-uuid>'::uuid;
   ```
   For an anonymous interaction, separately agree the exact interaction scope; do not broaden this query to all owners.
2. If provider generation must stop, set `RAG_PROVIDER_MODE=offline` on the verified app service. If ingestion/enrichment must pause, set `WORKER_PAUSED=true` on the verified worker service. Apply through the authorised deployment/configuration procedure and record the resulting release IDs. Offline mode retains lexical retrieval and deterministic source-only answers: it is **not source exclusion**. A worker pause prevents new claims; it does not prove already-running work or every provider path has stopped.
3. Record the implicated source review through the supported procedure below. If the source must be excluded, use the source-exclusion acceptance below; do not declare recall complete from review metadata or offline mode.
4. Reproduce with a synthetic/minimised fixture and identify whether retrieval, generation, rendering or copy caused the defect. Focused offline checks include `npm run eval:rag:offline` and `npm run check:clinical-hazard-controls`. Inspect selected commands before execution; provider-backed reproduction requires its own bounded approval.
5. Restore only after the focused regression, applicable release checks and clinical review pass. Record unresolved source-exclusion or cache evidence as a blocker.

## Source review, recall or replacement

1. In the authenticated administrator workflow, submit `POST /api/documents/<document-uuid>/reviews` with an evidence-bearing reason. Example request body for decommissioning:
   ```json
   {
     "decision": "decommissioned",
     "reason": "Incident INC-SYNTHETIC-001: source withdrawn pending review",
     "evidenceReferences": ["INC-SYNTHETIC-001"],
     "replacementDocumentId": null
   }
   ```
   Replace synthetic references before a real review. The server requires an authenticated administrator and permits that reviewer's own documents or public-corpus documents (`owner_id IS NULL`); a private document belonging to another owner is rejected. Do not substitute another person's reviewer ID or use direct table writes to bypass this boundary. Escalate if the authorised reviewer cannot access the implicated source.
2. The route calls `record_source_review` for a private owned document and `record_source_review_v2` for a public document. These service-role RPCs atomically append `source_review_events` and update `documents.metadata.document_status` / `governance_disposition`; decommissioning or supersession sets `document_status=outdated`. A `superseded` review requires an accessible replacement in the RPC's permitted scope; v2 also rejects self-replacement and permits public-to-public, or owned-to-own/public. Public promotion has additional date/qualification requirements; it is a separate reviewed restoration action. Missing v2 support blocks public review; do not fall back to fabricated columns or manual event inserts.
3. Retain the successful response's review-event ID and verify the intended metadata/event with a separately approved read. The route requests local and shared cache invalidation for the owner, or all scopes for a public source. Shared cache deletion is asynchronous and best effort, so HTTP `201` does not prove it finished or that every app replica/browser copy was cleared. Agree affected owner/public scopes, inspect cache IDs/counts without exporting payload prose, and confirm invalidation before accepting containment. Any additional live cache purge needs the applicable specific-change authority.
4. **Source-exclusion acceptance:** the review operation records governance; this runbook establishes no proven source-specific retrieval exclusion operation. `RAG_PROVIDER_MODE=offline`, `document_status=outdated`, a cleared answer cache, and zero document chunks do not individually prove exclusion across all retrieval surfaces (including embedding fields, index units and memory cards). If exclusion is required, keep the affected answer workflow out of use under the authorised incident procedure until an approved exclusion mechanism is established and verified. Do not delete index artifacts or invent a database operation to fill this gap.
5. Before restoring the affected workflow, test the implicated queries against the exact deployed release, owner/public scopes and relevant retrieval modes. Inspect retrieved results and rendered citations as well as shared/local caches; require absence of the implicated document wherever exclusion is intended. Preserve direct source access only where authorised. Configuration readback is separate evidence from effective exclusion. Run focused source-governance/answer checks; `npm run audit:source-governance` can touch Supabase and requires confirmation before use.

## Privacy or provider incident

1. Preserve minimized identifiers and timing evidence. For an authorised bounded log read, select `id`, `created_at` and `model` from `public.rag_queries` for the approved owner/time window; raw query/answer columns and free-form metadata may contain sensitive content and must not be copied into diagnostic artifacts.
2. On the verified app service, use `RAG_PROVIDER_MODE=offline` to stop the answer path's OpenAI generation/embedding calls; on the worker, `WORKER_PAUSED=true` stops new ingestion claims. Identify and separately contain already-running work and other enabled provider paths (including voice/background processing). Verify effective egress cessation for the incident's scope; these two flags alone are not whole-system proof.
3. If enabled, turn off `RAG_PERSIST_RAW_QUERY_TEXT`, `RAG_PERSIST_ANSWER_TEXT` and `OPENAI_STORE_RESPONSES` on the affected app deployment through its supported configuration process. Verify effective values without exposing secrets. These controls do not delete existing server records, browser sessionStorage or provider-held copies. Follow the [PIA](privacy-impact-assessment.md) for each retention surface.
4. Identify affected `rag_response_cache` owner/public scopes and incident window. Arrange any approved purge through the existing cache/retention procedure, then verify bounded counts and expiry results; do not treat a purge request as proof. Preserve only the incident evidence required by the authorised process.
5. Escalate notification, retention and breach decisions to the privacy owner. If unavailable, page the secondary governance contact, report completed versus blocked containment, and preserve the minimized audit evidence. This runbook makes no legal determination.

## Answer-pipeline rollback and restoration evidence

1. Roll back or disable the smallest affected feature under the existing incident authority. Retain source browsing/source-only answers only if the incident permits them; source-only mode can still surface an implicated source.
2. Verify the app's `/api/health` `deploymentCommitSha` and the worker's `/health` `deploymentCommitSha` / `claimLoopPaused: true` on the verified target. Health and configuration readback do not prove cessation of in-flight work, provider egress, source exclusion or cache deletion; record those separately.
3. Do not weaken danger-source exclusion, query/answer minimisation or private-document access to restore availability. Hold forward promotion until focused regression and applicable release evidence pass. Local offline examples are `npm run eval:rag:offline`, `npm run check:clinical-hazard-controls` and `npm run check:production-readiness:ci`; select the required PR-local gate under the [verification policy](agents/verification-gates.md). Live acceptance and provider-backed release checks require their applicable approval and spend bound.
