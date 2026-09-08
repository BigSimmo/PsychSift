# U03 schema and transaction contract recommendation

Status: selected design for independent frozen-document review. This is a bounded design contribution, not implementation, a branch audit, U03 acceptance, SQL proof, or permission to operate a provider.

## Frozen evidence and scope

- Worktree: C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database.
- Branch: codex/rag-local-build-20260822.
- Observed HEAD: fd043b262ebd9b20315c2e46bc4838265787fa80. Tracked status was empty using git status --short --untracked-files=no.
- Execution authority: docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/2026-09-07-execution-authority.md at that HEAD.
- Read first: U03-frozen-task-context.md, SHA-256 f19c9a082edf068d9700e09401badfbcd270694abecb4ef8a0c4a6e62d3cdcea; U03-frozen-owner-preparation.md, SHA-256 74bf1c4d4960feaf87787f187f1de474b9680b98b8e8b7594da324a256e78ec7.
- Preparation source base: ae500cafc661d9a06536d09d73d827726f057ffa. Reused its writer inventory. The subsequent product correction is 876cb09405d81d9c4a8a4931b3d735fd252934ba, in supabase/functions/_shared/source-anchored-summary.ts and its test; the inspected worker, enrichment, deep-memory and SQL owners are unchanged. The current full frozen HEAD remains the reference for every source location below.
- Applicable tracked instructions: root AGENTS.md. No deeper applicable tracked AGENTS.md exists in the named owners. The frozen root embeds review throttling; its later extracted docs/agents/codex-review-throttling.md does not exist at this HEAD. Read docs/codex-review-protocol.md. No ledger command was run because this is contract preparation, not a completed branch/PR review.
- Migration reservation: no tracked path matches supabase/migrations/20260831101000*; the exact proposed filepath supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql does not exist. The tracked immediate predecessor 20260831100000_retire_ingestion_worker.sql retires only the duplicate Edge ingestion-worker, preserves Node plus indexing-v3-agent, and tightens exact-generation strict-gate reads. Retain the proposed U03 name. This observation is not a reservation against future concurrent writes; recheck the same tracked prefix and exact path immediately before creation.

## Selected design

Add durable attempt identity to BOTH job tables, route the inventoried writers through a small set of named domain RPCs, and take source/document/job locks inside each RPC before its first write. Reuse the existing P05 authority tables and exact catalogue advisory-lock namespace. Do not introduce an arbitrary table, SQL text, column name, callback, or unrestricted patch RPC.

The common internal helper is assert_current_ingestion_attempt. It is not a public mutation endpoint. It has two explicit branches for job kind node and indexing_v3, referencing ingestion_jobs and indexing_v3_agent_jobs statically. Public domain functions use fixed SQL and a fixed payload schema for their own artifacts.

The protection claim is about the complete inventoried Node/Edge execution paths. It is not a sandbox against a database owner or an arbitrary service-role client. Do not pretend the Edge database-owner connection becomes unprivileged merely by moving its SQL into functions. Old processors must be stopped before eventual rollout; current task authority does not permit that operational action. No new role or all-table DML revocation is proposed because those tables also have independent application and governance owners.

### Durable tuple and generation handoff

Both job tables receive lease_token UUID, lease_expected_generation_id UUID nullable, lease_write_generation_id UUID, lease_authority_digest text, lease_expires_at timestamptz, and lease_duration_seconds integer. Duration is bounded by the claim RPC, persisted, and used by heartbeat; callers cannot extend an expired lease by choosing a new threshold.

Add table CHECK constraints requiring a complete lease tuple whenever status is processing, canonical digest syntax and a bounded positive duration. No artifact-table trigger or caller-set GUC grants mutation authority. Keep the existing source identity/publication triggers; the new repair audit has the explicit immutable triggers described below. A future caller bypassing these wrappers is a coverage failure, not an implicitly supported alternate ingestion API.

Every claim/reclaim generates a new UUID token, including reclaim by the same worker ID. It records worker, expected current generation, write generation, authority digest and expiry in the same transaction. Existing processing rows cannot be assigned a fabricated valid token by a data backfill: eventual application must fail with a drain-required precondition if live processing rows remain. Pending/completed historical rows may retain null lease fields.

Every domain call carries this required, non-defaulted Fence:

    job_kind, job_id, document_id, worker_id, lease_token,
    expected_generation_id, authority_digest

The SQL helper matches the supplied values against the durable row, processing status, unexpired lease, and current locked document/source authority. A supplied target generation must equal lease_write_generation_id. No worker-only, null-worker, missing-token, missing-digest or generation-only branch is allowed.

Node claim reserves a fresh write generation G1 while recording the current committed generation G0. Before core commit, every staged row must belong to G1 and the live document must still be G0. Only the guarded core commit changes the pointer to G1 and advances that same job's lease_expected_generation_id to G1 in its transaction; the caller adopts the returned Fence. Post-core summary, quality and deep-memory writes require G1. A stale caller holding G0 cannot invent the handoff.

Edge claims require an exact non-null committed generation and use it as both expected and write generation. This retains U02's refusal of unknown/mismatched generation authority. The Node initial-ingestion exception permits expected_generation_id = null only when the typed generation is null AND generation metadata is absent, not malformed or contradictory. In this schema documents.index_generation_id is generated from metadata; do not write that generated column directly.

Keep the document's committed pointer and existing sound artifacts until the existing non-empty core commit succeeds. Replace the worker's document-wide reset path with reset_ingestion_attempt_artifacts, which can remove only this attempt's unpublished write generation. Never reset prior committed or identifiable legacy evidence simply because document.status is not indexed.

Claims recheck both queues under the document lock. A Node claim cannot overlap a live Edge attempt for the same document, and vice versa. The two job IDs may coincide without being the same authority: job_kind is part of identity.

### Source and policy authority

For a catalogue-tagged document, require exactly one public_source_versions row linked by staging_document_id. Read the latest public_source_activation_events row by source_sequence under the existing source lock. Require the version's activation_event_id to match that latest activating decision; matching policy version/digest; permitted shadow or approved lifecycle in both the relevant version/document authority; matching exact URL/version, hashes, licence evidence, staging owner and content-identity clearance. Retain the P05 accepted Australian policy digest and excluded/protected-identity behavior. A null version, missing metadata, conflicting marker, non-activating latest event, unsupported policy or changed identity fails closed. Active publication is not a new U03 processing exception.

Build the durable authority digest from the existing public_source_acquisition_identity_digest(version_id), version ID/lifecycle, and latest event ID/source_sequence/decision/policy fields. Recompute after locking on every mutation. The acquisition digest is the existing P05 definition; it is not a caller's assertion or a new source registry. It excludes changing worker progress and index-generation state; generation is checked separately.

For a non-catalogue document, bind its actual owner, source/storage paths, file identity/content hash and governance/content-identity fields from the locked document. Use explicit null representation in the digest. A linked P05 version or any public-source marker forbids falling into this branch. Private/public ownership is an exact value comparison, not a truthiness test. U03 does not reinterpret the public sentinel or modify retrieval owner scope.

The shared TypeScript protected-content scan stays in place. A SQL digest does not establish that a provider-visible image, OCR result, or native payload was scanned. Complete pre-egress and content-classification proof belongs to U07/U08.

### Lock order and atomic refusal

Use this order in all new claims and domain functions:

1. For a P05 source, pg_advisory_xact_lock(pg_catalog.hashtextextended('public_source:' || catalogue_key, 0)).
2. Latest source event, then the exact source version row.
3. documents row for the document.
4. ingestion_jobs then indexing_v3_agent_jobs, IDs ordered within each table; acquire only the rows the operation needs and recheck cross-queue eligibility.
5. Owned artifact rows in fixed family order, stable row-key order within each family.
6. Affected import_batches rows in sorted UUID order, before recomputing their aggregates.

The pre-lock lookup of a catalogue key is routing only. After acquiring the document lock, require that the live link/key still equals the routed key; otherwise refuse without acquiring a second differently ordered source lock. Claims can select candidate IDs without locks, then use try-advisory-lock and FOR UPDATE SKIP LOCKED in this order, rechecking eligibility after locks. Do not retain the existing unordered FOR UPDATE OF j,d as the sole ordering rule.

The actual P05 event writer takes that same 'public_source:' advisory lock at 20260824123000_harden_public_source_lifecycle_authority.sql:95. Its transition, activation, stage/fetch and tombstone entry points use the same namespace. Thus a newer event cannot be inserted while an already-authorized U03 mutation holds that lock. If the policy transaction commits first, the next U03 mutation observes the changed event and refuses. make_public_source_version_ineligible is an internal helper reached beneath those entry points; do not grant it to workers. Existing lifecycle code takes document before artifacts and checks jobs NOWAIT; source serialization plus U03 document-before-job ordering preserves the relevant boundary. Do not add a worker path that locks a job and then waits for a document/source.

Keep transactions short; no provider, native extraction, Storage HTTP or user callback inside them. Each SQL DML operates on the guarded row/key set, and each job UPDATE repeats job/document/status/worker/token plus expected generation/authority predicates. The held locks prevent a separate-statement authority read from becoming a preflight-only fence. Any unexpected row-count mismatch rolls back all writes in that function, including metadata, siblings, stages and batch summaries.

Exactly return {"ok":false,"reason":"lease_lost"} on missing/mismatched job, token, worker, expiry, generation or current authority, with zero database side effects. This intentionally coalesces stale identity reasons at the transport boundary. Successful responses may include updated Fence or artifacts. Strict-gate refusal is a separate typed non-success result, e.g. reason = completion_gate_blocked; do not misreport it as lease loss. Invalid input, missing RPC, permission or database errors are hard failures, never successful no-ops.

Use a transaction-local exception/subtransaction boundary so discovering a failed final predicate cannot commit earlier writes merely because the function returns false. All callable wrappers use SECURITY DEFINER only where required, owner postgres, empty search_path, qualified names, revoke PUBLIC/anon/authenticated execution and grant only the explicit service-role entry points. Revoke worker execution of obsolete unfenced overloads; internal unfenced helpers must also be inaccessible to service_role.

## Named owners and persistence contracts

| Owner / existing seam | Chosen fenced operation |
| --- | --- |
| worker/main.ts:104–177 progress, heartbeat, document status and metadata | update_ingestion_job_progress and heartbeat_ingestion_job accept Fence; patch_ingestion_document_state accepts only explicitly enumerated worker-owned fields and is not a general document patch. Rejected-claim failure requires a fully parseable Fence; missing identity gets no terminal mutation. |
| worker/main.ts:547–600 and 1436–1660 base rows, pages, embeddings, quality | reset_ingestion_attempt_artifacts; write_ingestion_base_artifacts with separately named bounded arrays for chunks/images/table facts/embedding fields/index units; existing commit_document_index_generation extended with Fence; persist_ingestion_index_quality. Pages remain in the core commit. No arbitrary table argument. |
| src/lib/document-enrichment.ts:807–997; Edge index.ts:700–777 | persist_ingestion_summary_projection, shared by Node and Edge, atomically writes exact summary projection, generated labels, completion marker and the allowed enrichment-owned document metadata. No intermediate externally visible marker-false replacement, per-label delete race, or later unfenced metadata patch. |
| src/lib/deep-memory.ts:550–622, 668–878 | stage_ingestion_deep_memory with named sections/cards/index_units inputs and producer/artifact-generation identity; guarded cleanup_ingestion_deep_memory_staging; commit_document_deep_memory_generation extended with Fence, anchors/stamps and alias inputs in the same commit. |
| Edge index.ts:571–605 | start_ingestion_job_stage and finish_ingestion_job_stage. Persist job_kind, lease_token and generation with each stage. Finish matches stage ID AND full job/document/attempt identity, not stage ID alone. Historical stage rows do not become authority. |
| Edge index.ts:1000–1868 | Use persist_ingestion_summary_projection for all generated-label mutations. Dedicated replace_indexing_v3_sections, replace_indexing_v3_memory_cards, replace_indexing_v3_visual_artifacts and replace_indexing_v3_core_embeddings own their existing fixed families; persist_ingestion_index_quality owns quality. Include section index units, visual facts/units/embedding fields and image metadata updates in their corresponding transaction. |
| Node/Edge terminal, retry and defer paths | complete_ingestion_job, fail_or_retry_ingestion_job, complete_strict_enrichment_job and update_indexing_v3_agent_job_status each require Fence and own all related terminal metadata, job release and batch aggregation atomically. Add heartbeat_indexing_v3_agent_job. Edge completion must not clear its job in a separate later call. |
| worker/main.ts:841 caption cache writer | persist_ingestion_image_caption_cache requires Fence, derives the owner from the locked document and retains current cache validation. No stale-attempt cache publication. Full cache context/key identity remains U09/U13. |
| worker/main.ts:1215–1296 Storage and image attachment | See the bounded Storage contract below. The database image row is written only through the base-artifact wrapper. |

### U02 preservation

The summary wrapper consumes the accepted normalized SourceAnchoredSummaryPayload and exact projected labels. SQL validates document/generation/source row membership and exact persisted projection; it does not run models or invent a second normalization algorithm. Preserve byte-stable multi-item prose projection from 876cb094, source arrays/anchors, manual labels, organization_profile and organization_profile_version. Generated-label replacement only touches source = generated for this document. Lock its existing rows before merge, preserve unrelated live summary metadata, and keep retries idempotent/provider-free when the stored valid payload can be reused.

Only rag_enrichment_version, rag_indexing_version, rag_memory_version, rag_enrichment_updated_at and generated_label_count are this enrichment metadata patch's keys. The general worker-state wrapper has its own separate fixed allowlist; it cannot overwrite U02 provenance or organizational authority by passing a broad document snapshot.

An Edge fallback is provisional, carries zero generated labels and cannot satisfy structured-summary completion. The wrapper must preserve an existing valid structured payload rather than allow a later fallback to downgrade it. Current validation/projection failures remain failures; moving persistence into SQL is not permission to normalize unsupported text into acceptance.

### Deep-memory details

The frozen preparation omitted two concrete writes inside the already named deep-memory owner: repairMissingChunkAnchors (550) and stampDeepMemoryChunks (586). Include them. Prepare their bounded intended changes in memory, then apply to the exact current document/generation inside deep-memory commit; anchor repair uses a live anchor-is-null predicate and merges only owned metadata keys. Do not stamp all generations.

Keep typed producer and artifact_generation_id staging ownership and the existing producer-collision refusal. Add attempt token provenance; every staged batch is fenced. The commit validates all expected staged counts and source membership, performs producer-scoped replacement, anchor/stamp changes and document metadata as one transaction.

Move the current best-effort rag_aliases insert into that commit. Derive document/owner from Fence, attach producer/generation/attempt provenance, and touch only aliases created by that producer for that document. Do not overwrite shared/manual aliases or introduce a new retrieval eligibility rule. An alias DB error rolls back this commit instead of being silently ignored. Existing alias-serving lifecycle semantics remain an explicit U12/U13 dependency.

Persist the deep-memory commit identity in its owned metadata. An exact retry of that committed producer/artifact-generation identity may return its stored result only after the current Fence still passes, and must not insert a second alias set. A different token or generation cannot use that receipt to bypass the guard.

Preserve the deliberate no-cleanup-after-commit-invocation rule at deep-memory.ts:840–841. A timeout or lost response may mean success. After invocation, neither caller cleanup nor stale failure handling may delete the staging IDs. Pre-invocation cleanup is permitted only through its fenced wrapper, for the exact producer/artifact generation, and only while that generation has not committed. Lease loss means leave inert leftovers for later recovery.

### Terminal, sibling, batch and quality decisions

Release a lease only in the transaction that records its complete/fail/defer outcome. Retry limits come from the locked job, not an old claimed snapshot. A retry request at max_attempts becomes terminal under the existing budget rule. Preserve prior indexed pointer/artifacts on enrichment or retry failure.

Choose no sibling supersession in U03. Current sibling rows do not record enough request-generation/policy identity to prove that an older queued request is satisfied by this success. Remove both SQL's broad sibling completion and the JS fallback. Processing siblings are never touched, even if locked_by is null; pending/failed siblings remain for their own safe claim. This is a conservative removal of an optimization, not a new queue lifecycle. A future owner may add exact-request supersession when it has a durable equivalence contract.

Derive batch IDs from the matched job, reject a mismatching supplied batch, and refresh only those actual batches inside the same transaction. Acquire batch row locks before the aggregate query, so concurrent completions of other documents in one batch cannot leave the final aggregate based on an earlier snapshot.

Persist quality only behind Fence. Strict completion must not erase independent extraction issues or force quality to good merely because artifact counts are non-zero (current schema.sql:4880 onward does so). Limit its write to its own gate evidence; recomputed extraction quality belongs to the guarded quality payload. Do not redesign U10 hard-gate thresholds in U03.

Missing-RPC fallback is removed from every inventoried path, including metadata read/merge/write, completion/failure, quality, sibling and batch updates. The generic apply_document_metadata_patch has an independent webhook caller at src/app/api/webhooks/supabase/document-change/route.ts:177 clearing reindex_requested; do not globally revoke that unrelated capability without replacing its owner. Worker/enrichment calls must stop using it. Revoke the old repair_strict_enrichment_gate_batch(integer) mutator instead of invoking it as a compatibility fallback.

### Bounded Storage contract and cancellation

Keep existing private buckets. Use a new, immutable attempt-specific image path including document ID, lease token, write-generation ID and upload UUID. Use upsert:false; never reuse an older attempt's object path. A guarded prepare_ingestion_image_upload returns that exact path after checking Fence; attachment of the image row rechecks Fence atomically. No path is selected from a model payload.

The Storage HTTP object bytes cannot participate in the Postgres mutation transaction. A prepare check is not an atomic Storage fence. An upload already in flight may finish after cancellation/reclaim; its attempt-unique path is unreferenced and must not be attached to a newer generation. U03 must not claim zero stale physical blob writes or atomic Storage rollback.

Choose no worker physical deletion for an ambiguous attachment/commit response or after lease loss. Replace the current immediate compensation call on generic insert errors with conservative retention of the exact unreferenced attempt path and a structured, non-sensitive recovery signal. Fenced SQL cleanup may retire only still-unpublished DB staging rows. Physical disposal, durable orphan inventories, retention deadlines, crop/cache representation and authenticated serving belong to the relevant U04/U05/U09/U12/U13 owners. No generic garbage collector or bucket policy redesign is part of this unit.

Use one monotonic cancellation state per attempt in Node and Edge. Missing-RPC, failed renewal or lease_lost stops new provider/native/Storage work; pass AbortSignal to supported operations, check before each next batch and after any operation that cannot be interrupted. Drop the resulting payload after cancellation. Catch blocks must propagate cancellation and may not call failure/metadata/stage-finish as a new unguarded recovery path. Explicitly replace the shadow test's swallowed lease-error expectation; ordinary optional extraction failure may still be reported without demoting sound evidence.

This bounds further work at the next cancellation boundary; it does not prove an already-started provider request was unsent. U07/U08 own that egress contract, and runtime cancellation proof remains unrun.

## Exact P05 schema prerequisite

At the frozen HEAD, git grep for public_source_versions, public_source_acquisition_identity_digest and public_source: in supabase/schema.sql returned no matches (exit 1). The tracked migrations contain them. Therefore do not write a new U03 policy helper against an assumed complete snapshot.

The smallest direct dependency closure for the selected guard is:

1. From 20260820121000_create_public_source_control_plane.sql: effective public_source_activation_events and public_source_versions tables, their indexes/FKs/checks, RLS, SELECT-only service-role table grants, reject_public_source_activation_event_mutation and its immutable trigger, and the version immutable trigger.
2. From 20260824120000_consolidate_public_source_lifecycle_authority.sql: source_sequence NOT NULL plus its catalogue/sequence uniqueness; final version lifecycle enum including superseded; acquisition_identity_digest column/check; final guard_public_source_version_identity at lines 35–57. Compose final CREATE definitions for the snapshot; do not copy the historical data-numbering UPDATE or trigger-disabling backfill.
3. From 20260824123000_harden_public_source_lifecycle_authority.sql: final public_source_acquisition_identity_digest(uuid), lines 4–51, SECURITY DEFINER with empty search_path and no worker execute grant. Existing documents, document_publication_approvals, extensions.digest and UUID support are its prior schema dependencies.

For a snapshot to also reproduce the policy-writer concurrency schedules, mirror the effective writer closure, not an obsolete first definition: record_public_source_activation_event(jsonb); make_public_source_version_ineligible(uuid,text) and its uuid compatibility wrapper; public_source_serving_authority table/seed/RLS/SELECT-only grant plus bump_public_source_serving_authority(); and the final transition_public_source_version(uuid,text,text,text,text,text). The first/final sources are respectively 20260824120000 and 20260824123000. Do not reintroduce the dropped seven-argument transition overload. These writers depend on the existing document/artifact/job/cache tables. Keep make-ineligible/bump internal and grant only the authorized operator entry points as in the tracked migrations.

Other omitted P05 lifecycle/serving definitions are not silently satisfied by this direct closure: activate_public_source_version, create_public_source_fetch_manifest, stage_public_source_version, record_unchanged_public_source_check, tombstone_public_source_version_for_review, serving eligibility and publication guards/triggers. Their final definitions are in the same hardening migration; unchanged stamp/global-authority definitions and the document trigger registration come from consolidation. If a source comparison or existing offline contract requires those objects for relevant schema parity, include their exact transitive definitions as an explicitly named prerequisite increment. Do not copy historical quarantine/publication DML, change lifecycle behavior, or run broad drift regeneration.

Offline effective-schema parity has not been established by this read-only contribution. It is an unclosed U03 prerequisite gate, not accepted drift. Actual replay/concurrency proof remains separately unauthorized. The 20260822123000 publication migration is historical context for existing approval/transition owners, not authority to reactivate its superseded bulk-publication function.

## Repair plan and append-only audit

Keep the supplied versioned, dryRun:true IngestionRepairPlan. planIngestionRepairs accepts 1–100 unique lowercase canonical document UUIDs; a non-empty subset of the six specified reason codes per document; and exactly one lowercase sha256 state digest per document. Reject unknown fields/codes, duplicate IDs, malformed digests and empty reasons. Sort IDs and reasons deterministically.

Use one documented UTF-8 digest encoding shared by TypeScript and SQL: prefix "ingestion-repair-plan-v1\n", followed in ID order by documentId, tab, comma-joined sorted reason codes, tab, expectedStateDigest, newline. Only this fixed UUID/reason/digest vocabulary is serialized, so separators cannot be injected. Do not assume JSON.stringify output equals PostgreSQL jsonb::text.

Add ingestion_repair_plan_audit with audit UUID/time and the full canonical plan/digest, outcome fixed to planned. record_ingestion_repair_plan validates the bounded payload and recomputes the digest, then appends one row; it does not change jobs, quality, metadata, source lifecycle or documents. RLS on, service_role SELECT only on table, RPC-only insertion, no UPDATE/DELETE/TRUNCATE privileges; rejection triggers for UPDATE/DELETE and statement-level TRUNCATE. A database owner can still administer the table; do not call this cryptographic immutability.

The planner's state digest represents an exact observed snapshot including source/version/event authority, generation, summary/projection/label state and both queue states/attempt identities. This unit does not expose an apply RPC. U13 must re-read/compare under the appropriate locks before any later repair application; an audit row marked planned is never evidence of successful repair.

## Source increments and acceptance scenarios

Use one original U03 TASK_BASE and one corrected-range review. Implement serially: (a) exact P05 snapshot prerequisite plus token/guard/claim primitives; (b) Node core/control and Edge stages/terminal; (c) atomic summary/deep-memory/alias/family writers and Storage/cancellation call sites; (d) repair planner/audit, docs/types and final all-writer coverage. These are implementation increments, not independently accepted U03 units. Do not dispatch product work until this design is independently reviewed.

Add src/lib/document-enrichment.ts and src/lib/deep-memory.ts and their affected tests to the original file allowlist. Put the shared pure Fence/result parser in supabase/functions/_shared/ingestion-attempt.ts; wire worker/row-contracts.ts, worker/behavior.ts and supabase/functions/indexing-v3-agent/behavior.ts to it. Name any directly changed Storage helper/test in the implementation brief before editing. Preserve the frozen shared-summary producer; change its caller persistence, not its accepted normalization. Migration and schema/type changes travel together.

Required focused acceptance cases:

1. Node and Edge claim/reclaim rotate UUID tokens; same-worker old token, cross-table matching UUID, missing/malformed token and expired heartbeat all refuse.
2. Cross-queue simultaneous claims for one document yield only one live attempt.
3. G1 worker pauses; G2 commits; G1 summary, labels, metadata, image row, quality, stages, deep-memory batch/commit/aliases, heartbeat and terminal calls all return lease_lost and leave G2 unchanged.
4. Core G0-to-G1 handoff succeeds only for the reserved write generation and returns the new expected generation; old-Fence retries refuse.
5. A source-policy event or withdrawal wins before mutation: every side-effect family refuses. If mutation wins the source lock first, it completes before the event; the next operation refuses.
6. A generation/authority change after a caller's preflight but before its SQL mutation is detected. Mocked preflight results cannot authorize a write.
7. Summary/labels/owned metadata roll back together on injected DB failure; manual organization/labels survive; accepted multi-item projection and provisional zero-label fallback remain exact.
8. Deep-memory section/card/unit failures preserve committed evidence; anchor repairs/stamps affect only the exact generation; alias failure rolls back commit; foreign producer staging is untouched.
9. Lost deep-memory or image-attachment response never invokes destructive cleanup. A late upload uses a distinct attempt path and cannot attach after reclaim.
10. Stale stage finish cannot update the reclaimer's stage; an optional shadow error cannot swallow cancellation and proceed to metadata writes.
11. Terminal/retry/defer cannot release before metadata/gate outcome; max-attempt retries drain truthfully; prior indexed evidence remains.
12. Live and unowned siblings are unchanged by completion. Wrong supplied batch ID is rejected; concurrent same-batch completions leave a correct final aggregate.
13. Missing any required RPC or invalid RPC result causes fail-closed cancellation with no direct-update or compatibility fallback.
14. Repair plans are deterministic across input order, bounded and dry-run only; malformed/duplicate input fails; audit mutation/truncate fails; legacy repair mutator execution is revoked.
15. Strict completion preserves independently valid extraction metrics/issues and cannot upgrade a provisional/incomplete summary to structured completion.
16. Source/schema static coverage enumerates every inventory writer and rejects a remaining direct Node/Edge persistence path; effective P05/U03 schema signatures and grants match the tracked migration definitions.

Caller mocks prove argument/result handling only. Separately authorized disposable SQL schedules must prove locks, reclaim, expiry, cross-queue/sibling isolation, G1-after-G2 writes, policy-event interleavings, failure rollback, batch aggregation and audit grants. Schema text tests cannot close these. Real Storage/provider cancellation, native extraction, deployed role/grant behavior and clinical adjudication are also unproved.

The historical six-file test selector is insufficient after the all-writer expansion. Retain its focused owners and add document-enrichment, deep-memory, storage-upload-compensation, worker-visual-capture, worker-shadow-extraction and SQL contract owners actually changed. Select gates after the implementation diff; no test, edge check, migration validator, audit command or broad baseline was executed here.

U03 supplies mutation fences and dry-run repair authority. U04 owns shadow staging/evaluation, U05 activation/rollback/retention mechanisms, U07/U08 pre-egress clearance, U09 evidence/cache representation, U10 technical eligibility, U12 default-off public retrieval/withdrawal and U13 selective repair/recovery/cleanup integration. No clinical reviewer is assigned by this recommendation. No lifecycle activation or independent sound-evidence deletion is authorized by an accepted local source change.

## Observed execution route and limits

Selected local log: C:/Users/joshs/.codex/sessions/2026/09/07/rollout-2026-09-07T20-32-41-01a07bdb-3dd9-77d0-8f18-98742dbcc87f.jsonl.

Exact selected metadata: line 1 session_meta.id = 01a07bdb-3dd9-77d0-8f18-98742dbcc87f; originator = Codex Desktop; source.subagent.thread_spawn.parent_thread_id = 01a07b47-4623-7e90-825a-ec25116b8531; agent_path = /root/u03_schema_contract; agent_role = supabase-schema-guardian. Line 8 turn_context.model = gpt-6-astra; effort = xhigh; collaboration_mode.settings.reasoning_effort = xhigh. This reports observed local metadata, not inferred provider internals or evidence about another reviewer.

Only this outside-worktree recommendation was authored. No repository edit, migration creation/execution, SQL, test, provider, document processing, worker, server, commit, publication, other-task message, untracked-content enumeration or recursive agent was performed. Read-only shell inspection launched only the short commands required for the named frozen sources and selected local metadata. The contribution requires separate independent frozen-document review.

Final identity recheck: HEAD remains fd043b262ebd9b20315c2e46bc4838265787fa80. Tracked status now shows concurrent controller edits in docs/superpowers/plans/2026-08-31-ingestion-first-continuation.md, docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/rag-evidence-handoff.md and docs/superpowers/specs/2026-08-31-ingestion-first-continuation-design.md. They were not read as moving authority or modified by this contribution; all source/design citations above remain pinned to the frozen commit.

## Follow-up: independently callable enrichment and commit consumers

This is the requested bounded compatibility follow-up, appended without changing the recommendation above. Source references remain fd043b262ebd9b20315c2e46bc4838265787fa80. The original report hash before this append was 677faf8a84a806aed1a4fbff81faf96be922966cbbaf4eaa06409936a59babab.

Searched only the four named symbols in tracked TypeScript/JavaScript/SQL runtime files using git grep at the frozen commit. The pathspec excluded 1/** and protected1/** before searching, plus tests, the already inventoried worker/Edge owner and migration/schema definitions. No untracked enumeration, tests, repository edit or runtime operation occurred. Read only matching caller neighborhoods and their exact package/typecheck references.

| Independently callable owner | Exact calls and authority | Selected compatibility treatment |
| --- | --- | --- |
| scripts/backfill-smart-index.ts; package.json:163 index:backfill | Dynamic helper imports at 334–335; upsertDocumentEnrichment at 429; upsertDocumentDeepMemory at 436. It supplies a live-read generation, not a job/token. Its --write plus --confirm branch first calls upsertDocumentLevelEmbeddingFields before either helper; metadata-only has separate writes. | Add this script to reviewed U03 scope for an early, explicit refusal of all operational write modes without a genuine leased adapter. Preserve dry-run inspection. A late missing-Fence exception inside enrichment would leave earlier writes, so it is insufficient. |
| scripts/enrich-documents.ts; package.json:149 enrich:documents | Helper imports at 539–540; enrichment at 654; deep memory at 672. It carries generation authority but no job/worker/token. The same named call neighborhood classifies images and updates document counts/metadata before enrichment at 624–649, then marks completion at 679 onward. metadata-stamp is also a separately executable mutation mode. | Add this script to reviewed U03 scope for early refusal of mutation modes before provider imports/client creation or the first write. Preserve any existing read-only inspection. Do not create a default worker ID or derive a token from document/generation. |
| scripts/archive/backfill-enrichment.ts; package.json:150 enrich:backfill | Dynamic bindings at 13–14 and 456–458; enrichment at 399; deep memory at 407. updateDocumentStage runs before each helper. The existing enrichment call also lacks the already-required indexGenerationId. | Treat as callable historical tooling, not dead code. Add its executable mutation entry point to the same explicit refusal scope. Do not silently revive/fix its older backfill behavior. tsconfig.json:29 excludes scripts/archive/**, which explains why ordinary typecheck cannot establish its operational compatibility. |
| src/lib/deep-memory.ts:842 | The only additional direct runtime invocation found for commit_document_deep_memory_generation. | Already an explicit U03 owner; require Fence and preserve the no-cleanup-after-invocation invariant. |
| Existing core commit RPC | No additional direct runtime call to commit_document_index_generation was found outside worker/main.ts. scripts/archive/check-m13-migration.ts:5,73,81–82 only names health/signature markers and messages; database.types.ts entries are generated type declarations. | No new runtime owner or operational behavior change is needed for these references. Do not alter a health inspector because it mentions the RPC name. |

Chosen treatment: reviewed extra-owner scope, rather than a parallel ingestion-only export that leaves the existing exported persistence functions unfenced. Both existing persistence exports continue to require a real Fence. The three operator scripts must fail with a stable explanatory error such as ingestion_attempt_required at their mutation entry point, before effects; a write request must not silently become a successful dry-run. Update the directly affected imports/call sites coherently so typecheck does not rely on casts, a dummy Fence, an optional-Fence bypass or a hidden legacy RPC. A replacement operational adapter may be explicitly unavailable; it must not claim that an operator has acquired a lease.

This intentionally withholds those unleased write modes until U13 supplies the reviewed reprocessing/lease-acquisition adapter. It does not authorize running, deleting or redesigning the scripts, changing their owner selection, consuming providers, or submitting new operational jobs. Their existing read-only planning mode is retained where one exists; it remains provider-gated when it reads hosted data.

This is a real compatibility decision for the controller's U03 brief and independent review. The original narrow worker/library allowlist alone is insufficient. If that refusal scope is not adopted, stop the relevant shared-export/API change and record the independently owned callers as unresolved; do not accept all-writer fencing while preserving an unfenced backfill path.

Acceptance additions: each of these three command entry points rejects an unleased write request before client/provider setup and before its earlier document/artifact writes; the refusal is non-successful and explicit; read-only modes stay read-only; no direct helper invocation or old commit overload remains as a bypass. These are future focused source/mock tests, not tests run in this contribution.
