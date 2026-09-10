# U04 state comparison contract 1

Design contribution only, resolving item 3 of `U04-schema-contract-recommendation-1.md`. Not product SQL, implementation permission, independent acceptance or a new audit of accepted U03. Sole output: this new outside file. No tests, provider/SQL execution, repository edits, commits, or delegation. Agent identity supplied by the team: `/root/u04_schema_contract_prep`, Supabase Schema Guardian role. No independently observed model/reasoning-effort/runtime selection is available; none is inferred.

Source checkout `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`; observed HEAD `3822cc1271b04dc85ec9d7c4afcf7afa26b06db2`. Read-only comparison from `b335cfbe5e9953a4d3c67ca40a3f1c1f4b41fa08` to this HEAD returned no changed paths under src/scripts/supabase/worker. All references below use this checkout. Other agents' files remain untouched.

## 1. Correction: there is no implemented P04 queue snapshot to normalize

The previous recommendation's statement that “P04 state includes queues” was too specific and must not be treated as a source fact. Current owners establish:

- `src/lib/ingestion-audit.ts:185-195` accepts `expectedStateDigest` as nullable **bare lowercase 64-hex**, not sha256-prefixed. `auditDocument` copies it into the result at 608-611. `assertAuditTargetState` at 635-642 checks presence and exact string equality only. There is no declared preimage, database snapshot encoder, queue collection or recomputation in this owner.
- The strict P04 input at 185-274 contains document identity, expected digest, active generation, lifecycle/governance metadata, expected/actual counts, quality/structure, embedding contract, reviewed provenance, chunk generations and must-pass cases. It has no Node/Edge job or batch fields.
- `scripts/lib/indexing-audit-adapter.ts:96-144` validates reviewed evidence and metadata/count consistency, then copies the evidence with measured page/chunk counts. It does not calculate the expected state digest. The CLI `scripts/audit-ingestion-corpus.ts:54-72` is provider-free and explicitly refuses live reads. The fixture's digests are repeated a/b/c at `tests/fixtures/ingestion/active-corpus-inventory.json:7,95,175`, not proof of a database preimage.
- The separate `document_publication_state_digest(uuid,uuid)` at `supabase/schema.sql:8204-8243` hashes a particular JSONB document/artifact projection; it omits queues/batches and uses owner equality that does not admit null owners. Its generation-sensitive artifact selections are not a safe U04 origin normalizer. Do not substitute it for P04 or change its publication semantics here.
- U03 execution-contract requirements for repair expected-state evidence name generation/summary/projection/labels and both queue states/attempts (`U03-execution-contract.md:169-177`). That is a required contract boundary, not an implemented P04 preimage encoder.

**Decision:** retain the P04 origin digest and reviewed audit bytes unchanged. Add a separately versioned U04 baseline/control binding. Do not manufacture a normalized “P04 digest,” append a prefix to the historical digest, or assert that a new U04 hash has P04's meaning. Connected enqueue must fail closed unless a reviewed origin-verification adapter can tie the supplied P04 digest to the locked pre-enqueue state. That missing adapter/preimage owner is an explicit remaining decision in section 9.

## 2. Minimum ownership choices

Choose a new Node shadow job per member, never reuse a pre-existing job. Bind it through the wave/member ledger, with immutable operation=shadow_reindex, requested C and plan identity. C's first token is assigned once; same-C reclaim remains refused after first claim.

**Use `batch_id = NULL` for new U04 shadow jobs.** The wave ledger owns the shadow population. Preserve `documents.import_batch_id` and all pre-existing import batches and jobs. This is an explicit proposed narrowing of the earlier schema recommendation's batch seam, not a change to standard ingestion. U03's actual terminal functions already do no aggregate update when their matched job's batch is null (`20260831101000_fence_ingestion_leases_and_repairs.sql:674-690,705-725`). No fake batch ID or source import-batch assignment is needed.

Why: `src/lib/ingestion-enqueue.ts:60-94` patches document status/error/counts and copies `document.import_batch_id` into a job. U04 cannot reuse that live enqueue helper. Reusing a historical import batch would couple unrelated sibling jobs' statuses/counts/timestamps to C and require a larger aggregate-transition contract. This v1 refuses any shadow job with non-null batch_id; it does not silently strip one supplied by a caller. No U04 transition is allowed to change batch status/count/time/metadata. If the controller requires non-null shadow batches, that requirement invalidates this narrow choice and needs a separately reviewed exact aggregate contract.

## 3. Closed pure comparator contract

Proposed pure owner: a named exported helper in the already planned `scripts/lib/reindex-eval-session.ts`, with shared serializable types in that same owner unless the controller explicitly assigns another path. This is a signature/specification, not authored implementation:

`compareShadowStateV1(input: ShadowStateComparisonV1): ShadowStateComparisonResultV1`

Input is a strict object with exactly:

- `version: 1`.
- `phase: 'pre_enqueue' | 'before_claim' | 'building' | 'before_seal' | 'after_seal' | 'after_failure' | 'evaluate'`.
- `binding`: exact projectRef, planDigest, candidateGenerationId and sorted member objects `{documentId,ownerId,baselineGenerationId,p04ExpectedStateDigest,p04AuditDocument}`. p04AuditDocument is the existing strict accepted P04 result/input binding, preserved without changed denominators or recomputed retrieval cases. Missing origin digest is invalid; real U04 document/generation IDs must be canonical UUIDs even though P04 accepted generic strings.
- `origin`: immutable `{originVerification,baselineSnapshot}`. originVerification is a closed `{contractVersion,adapterVersion,originDigest,verifiedSnapshotDigest}` whose admissible version/adapter is hardcoded by the reviewed brief, not a callable name supplied in the payload. originDigest equals the exact P04 digest. In production it is produced only by the locked trusted adapter; a caller setting a boolean cannot manufacture this evidence.
- `baselineSnapshot`: versioned fixed-family baseline evidence plus the exact original control rows described below. Capture all original rows before any U04 enqueue mutation. Store an independent `u04BaselineDigest` and preserve it unchanged. It is distinct from p04ExpectedStateDigest.
- `checkpoint`: nullable before enqueue; otherwise `{controlRevision,ownNodeJobs,ownStages}` from a private server-maintained checkpoint bound to exact member job IDs and first tokens. This is the most recently validated after-image, not an arbitrary caller assertion. Current candidate artifact inventory remains its separately governed input, not a permission to alter live baseline state.
- `current`: one complete observed fixed-family/control snapshot, with explicit query-complete flags and exact ID populations. In tests this is authored in memory; SQL obtains it under locks. Missing/partial results cannot mean an empty set.
- `clock`: `{transactionStartedAt,observedAt}` from SQL timestamps for live comparison; pure tests supply exact values. Full microsecond precision retained as normalized timestamp strings/integer microseconds, not JavaScript millisecond rounding.

Result is exactly one of:

- `{ok:true,version:1,kind:'origin_equal'|'sanctioned_u04_state',p04ExpectedStateDigests,u04BaselineDigest,controlRevision,phase}`; explicitly NOT eligibility or promotion.
- `{ok:false,version:1,reason,documentId:null|uuid,scope,fieldPaths}` with closed reasons `invalid_input`, `origin_binding_unavailable`, `origin_digest_mismatch`, `snapshot_incomplete`, `source_changed`, `owner_changed`, `live_generation_changed`, `baseline_evidence_changed`, `foreign_queue_changed`, `batch_changed`, `own_job_identity_changed`, `own_control_changed`, `lease_lost`, `shadow_wave_restart_required`, `unsealed_wave`, `failed_wave`, `control_transition_invalid`. scope is closed to origin/source/document/artifact/node_queue/edge_queue/stage/batch/claim/seal. fieldPaths contain schema paths only, no private values, source text or provider errors.

The comparator reports all deterministic differences in stable document/scope/path order or one fixed-priority refusal. It never repairs state, changes the baseline, requeues work or grants authority. The implementation brief must choose one deterministic refusal ordering for TS/SQL parity; this choice does not affect which states are admissible.

## 4. Baseline snapshot and exact exclusions

The P04-required minimum carried through unchanged is the actual existing audit schema: identity/G0, lifecycle and governed source fields, all expected/actual counts, provenance/version identities, structure/quality/embedding contracts and exact case evidence. These are audit bindings; U04 must additionally capture complete immutable artifact evidence under its already required inventory/baseline bundle. No new claim is made that P04's digest covers more than its unidentified preimage.

For the U04 binding, capture full fixed-schema rows of the live document and every baseline artifact family named by the approved inventory, source authority binding, both queues, existing job stages and relevant import-batch closure. Do not drop unknown columns opportunistically: a schema/version mismatch refuses and requires an explicit contract update. Known generated search vectors may be represented by their fixed input/row digest in the existing full artifact bundle; no content-bearing field or persisted timestamp is silently ignored by this control contract.

The control closure is precise:

- ALL Node rows with document_id in the wave, including historical completed/failed/deferred rows if the effective schema admits them; ALL Edge rows for those documents; all stages for those selected documents or selected queue job IDs (OR, so inconsistent cross-document references are detected).
- Batch IDs referenced by those original Node rows or by selected documents.import_batch_id; full rows for those batches; ALL Node rows attached to those batches, including out-of-wave siblings, and their identity/status/attempt/time fields. No graph expansion into those siblings' unrelated artifacts or other batches is needed.
- At later observations the same relational selection is run afresh, so newly inserted foreign rows/new batch references are detected. Compare key sets first, then row fields. Include pre-existing orphan/inconsistent stage records in the frozen observation; U04 does not silently remove or adopt them.
- Every original Node/Edge/stage/batch row is compared exactly to its original snapshot, including status, stage, progress, attempts, locks, retry/completion/start/create/update times, metadata/errors and all counters. A sibling heartbeat or unrelated terminal update causes `foreign_queue_changed`/`batch_changed`; it is not explained away as C progress. This conservative drift refusal is intentional.

Only exact new U04-owned rows may be outside that original set: Node job IDs returned by the atomic enqueue and recorded in the member ledger, and stage IDs returned by the fixed stage RPC for those exact job/token/document bindings. A row with C metadata alone is not owned. An existing row changed to look like C remains foreign. No original row may be removed/replaced by matching a generation value.

All original live document/artifact rows remain equal. Added core rows are accepted only through the candidate inventory's exact IDs/document/C/first-token (and D where appropriate). A new G0/legacy-null row, changed baseline row, unbound row or foreign generation addition fails. This includes pages: selection must compare the original exact baseline population plus separately admitted candidate identities, not use a newly changed committed-reader helper to hide drift. Pre-existing retained generations remain part of the captured population if present; U04 does not delete them.

## 5. Exact own-control transitions; no global ignored timestamps

Actual row sources: Node schema `schema.sql:489-508`, stage schema 511-530, Edge schema 5726-5744; U03 lease columns `20260831101000_fence_ingestion_leases_and_repairs.sql:9-36`. Node keys comprise id, document_id, batch_id, status, stage, progress, error_message, attempt_count, max_attempts, locked_at, locked_by, next_run_at, started_at, completed_at, created_at, updated_at; add all six U03 lease fields plus the proposed fixed operation/requested_generation_id/shadow_plan_digest. Unknown fields refuse until the schema version is updated.

Use a **single mutable private control checkpoint per wave/member**, containing a revision and the exact expected own Node row and own stage rows. Enqueue creates revision 0; every permitted control RPC compares its pre-image with that checkpoint, validates a closed transition, applies it, captures its actual after-image (including triggers), and advances the checkpoint in the SAME transaction. The normal snapshot comparator requires exact equality between current own rows and this trusted checkpoint. No heartbeat event log is necessary. Seal stores the terminal after-image/revision in the immutable receipt. This requires the implementer brief to name `control_revision bigint` and `control_snapshot jsonb` (closed schema) on the proposed private member ledger, or an equivalent fixed private owner; this contribution does not silently add product columns.

The reducer `validateShadowControlTransitionV1(before,intent,after,clock)` is strict and side-effect-free; SQL implements identical predicates. Closed intent kinds and exact allowed changes:

| Intent | Preconditions and only permitted changes |
| --- | --- |
| enqueue | New job ID absent from origin. document_id/C/plan exact; batch_id null; status pending; stage queued; progress 0; attempt_count 0; max_attempts 1 for this single-attempt shadow job; errors/locks/start/completion/lease tuple null; server-created timestamps; next_run_at exact server enqueue value. Live document/original queues/batches unchanged. |
| claim | Before is exact pending checkpoint, no first token, due next_run_at. Set status processing, locked_by nonempty validated worker, locked_at captured wall clock, new first lease token, expected generation G0, write generation C, authority digest exact, duration bounded by U03, expiry from actual clock+duration, attempt_count exactly 1, next_run_at null. All other fields unchanged except actual updated_at trigger value. No automatic started_at assignment: current U03 claim does not write it. Ledger first token/time are recorded atomically. |
| heartbeat | Exact original first token/worker/processing/expected G0/C/authority; expiry strictly after actual wall clock after lock acquisition. Only locked_at, lease_expires_at and updated_at change as the existing heartbeat does. Duration remains fixed. No revival from expired checkpoint. |
| progress | Same Fence/expiry as heartbeat. Additionally stage equals the validated RPC p_stage (current U03 max 500 chars) and progress equals validated integer 0..100. Do not invent monotonic progress: current owner does not require it. Only stage/progress/lock/expiry/updated_at change. |
| start_stage | New stage ID absent from all original/current stages; exact job_kind=node/job/document/token. Current U03 stores stage.index_generation_id=Fence.expected (G0, nullable), NOT target C; retain that and bind C through the owning job/ledger. Exact stage_name/metadata match validated RPC input; started/default fields reflect insert. No original stage changes. |
| finish_stage | Exact own stage currently started with matching job/document/token/G0; change only stage_status to completed/failed, finished_at, artifact_counts and error_message matching validated RPC input. Preserve stage_name/start/create/metadata/error_class/retry_count. No repeated finished-stage mutation. Counts are stage evidence; terminal artifact completeness still comes from inventory, not these counters. |
| seal | Valid original processing Fence immediately before seal; all candidate gates separately pass. Job becomes completed, fixed shadow terminal stage, progress 100, locks null, completed_at actual wall clock; updated_at is actual trigger result. Preserve first token and generation/authority/duration/expiry provenance; no lease expected= C handoff. error_message/next_run_at/start/attempt count stay as prior checkpoint (new-job error is null). Atomically freeze receipt/terminal checkpoint. Batch remains null, no aggregate DML. |
| fail | Valid original processing Fence. Job becomes failed; fixed shadow failure stage; error_message equals bounded typed failure serialization; next_run_at null; locks null; completed_at actual wall clock; actual updated_at. Preserve attempts/token/G0/C/authority/duration/expiry/progress/start. No requeue or live document patch, regardless of caller retry request. Freeze failed control outcome; candidate stays unsealed. |

Mutation code uses server-captured times, not arbitrary caller timestamps. `schema.sql:910-919` sets updated_at=now(), and the bindings at 1068-1081 install that trigger for batches/jobs; therefore **updated_at is transaction-start time**, whereas U03 lock/expiry/completion writes use clock_timestamp and may be later. Validate these distinct meanings; never require updated_at=locked_at, round to milliseconds, or use transaction-start time as lease freshness proof. The existing heartbeat/progress use separate clock_timestamp evaluations; mirror the actual after-image and require the documented duration/order/bounds, not false timestamp equality between separate calls. Do not require global monotonic wall-clock time that the existing contract does not promise; an invalid temporal envelope refuses instead of being ignored.

All other own-job/stage fields remain exact. An own-only candidate artifact write that does not change control has no allowed control delta. Candidate projections/inventory can change through their separate fixed operations without rewriting this original baseline. Replayed current same-token control requests follow the fixed RPC's existing semantics, but changed worker/token, attempt_count 2, failed-to-pending, expired heartbeat or completed-to-processing always refuses.

## 6. Source drift, G0 null, failures and read-after-seal

At every mutating boundary run U03 source/document locking and current-attempt assertion; do not replace its authority with the pure comparator. The source route and exact version/event/policy/acquisition fields are recomputed under lock (`U03 migration:43-115`). Compare owner explicitly and null-safely: catalogue authority digest alone does not substitute for owner equality. Withdrawn/replaced/policy-changed source fails before candidate writes even if projected text and counts are unchanged.

G0-null is allowed only when the generated document column is null AND generation metadata key is absent, matching `U03 migration:150-155,185-186`. Metadata containing null/empty/malformed index_generation_id is not the supported null case. Own processing job lease_expected_generation_id and stage index_generation_id stay null while write generation is C. Baseline legacy rows remain byte/identity stable; candidate rows cannot be accepted as legacy. Ordinary U03 completion requiring non-null committed generation is not called for this shadow path.

Expiry discovered by a read is a refusal/result, not permission to mutate the expired job. `phase=after_failure` can report an exact terminal failed checkpoint but never authorize evaluation. If a lease expires without a terminal write, diagnostic is `shadow_wave_restart_required`/lease_lost; it may still be processing physically. No synthetic completed/failed row is written by the comparator. New token/new worker cannot adopt C, and no uncertain data is deleted.

After seal, a historical receipt read may return the immutable past result without a live lease. `phase=evaluate` instead requires every member's exact terminal sealed checkpoint plus unchanged origin/source/live G0/evidence/foreign controls and current authorized operation context. Expired terminal lease fields do not invalidate the historical seal by themselves because no mutating lease is being revived; source/baseline drift still yields NO_GO. A member failure, missing receipt or extra/missing/changed foreign job blocks the whole wave.

## 7. Locked SQL equivalence and atomic boundary

Proposed internal helper signature: `assert_shadow_generation_state(p_document_id uuid,p_generation uuid) returns void`, backed by fixed snapshot/reducer helpers. No caller snapshot, supplied actual digest, expected-row patch, table name or ignore-list can control the SQL verdict. Pure TS input is a testable representation of server-derived state, not production authority.

1. At enqueue, verify operation/plan and exact origin adapter binding before any effect. Use U03 source advisory/event/version/document lock order. Acquire relevant Node, then Edge rows in stable ID order; relevant artifacts, then affected baseline batch rows in the prescribed order. Snapshot all fixed families with complete membership, capture original digest/baseline/control identities, insert only exact new shadow jobs/private ledger state, and validate post-state before commit. Enqueue's candidate/read ordering must not take a job lock before source/document authority.
2. At claim/control/stage/seal, acquire the same source/document and queue locks, then fixed owned artifact/control rows and batches when needed. Recheck source route after document lock, compare original foreign rows and live baseline, compare current own rows with the private checkpoint, enforce U03 actual clock expiry and exact transition. A failed predicate raises or uses an exception/subtransaction boundary so no partial mutation survives. Repeat full row predicate/affected-row checks in the update.
3. Capture actual after-images after their normal triggers; validate transition and update private checkpoint/revision in the same transaction. Do not write the checkpoint before the protected row result is known. Seal includes its terminal checkpoint in the immutable receipt transaction. Alias/projection/inventory failures roll the whole seal back.
4. SQL must detect set additions/deletions as well as changed fields. Row locks alone do not protect an empty set from INSERT phantoms. Respect U03's document/source serialization by every cooperating writer; existing one-open-job index (`schema.sql:821-823`) is an additional barrier, not a complete snapshot lock. For full all-writer serial equivalence, use a separately reviewed SERIALIZABLE transaction boundary with retry/refusal handling, or an explicitly proven complete writer-lock closure. Do not claim serializable snapshot proof merely from SELECT FOR UPDATE. Future SQL schedules must include concurrent foreign queue/stage/batch insertion/update and both lock interleavings. Non-cooperating arbitrary service-role SQL remains outside the accepted caller boundary unless this stronger isolation is supplied.
5. Evaluation uses a read-only consistent snapshot with required source/state protection through its complete result. A preflight check in one transaction followed by unconstrained reads in another does not prove unchanged-state evaluation. The runtime transaction adapter/isolation choice is a required remaining owner decision, not permission to run SQL here.

TS and SQL compare the SAME strict fields/sets/transition predicates and timestamp semantics. Canonical digest bytes remain the separately owned unresolved item 2; structured equality is not itself proof of a shared byte encoding. Keep historical P04 digest, U04 baseline digest and control checkpoint identities distinct in all receipts/errors.

## 8. Required focused proofs for the later implementer (not run)

Authored fixtures should reach the actual comparator and mutating orchestration: unchanged origin; exact claim/heartbeat/progress/stage/seal; updated_at transaction time distinct from wall clock; G0-null; expired token; attempt 2; foreign pending/completed/failed row insertion/removal; sibling heartbeat; Edge metadata/status/attempt change; batch membership/count/status/time-only change; same-count baseline content replacement; new legacy page; manual-label/organization metadata change; source event/owner change; failed/ambiguous seal and read-after-seal. Every failed mutation must preserve the original live state/checkpoint. An incomplete query is not an empty population. No source-only assertion supplies transactional SQL proof.

## 9. Exact remaining decisions

The control comparison is now specified without broadly ignored fields, but three connected-admission prerequisites cannot be asserted from current source:

1. **P04 preimage/adapter ownership remains unavailable.** Freeze a reviewed origin verification contract that can bind the supplied exact P04 digest to the locked pre-enqueue snapshot, or require fresh reviewed audit evidence generated by a newly versioned owner. Do not pretend the existing fixture/CLI supplies this. Until then, connected enqueue returns origin_binding_unavailable; pure fixture-driven design/implementation can proceed within its own authority. This corrects the earlier recommendation rather than manufacturing an answer.
2. **Controller approval of null shadow batch linkage and private control checkpoint.** These are the proposed minimum, not existing behavior. Non-null batch support needs exact additional ownership/aggregate transitions; no broad timestamp/count exclusions are permitted as a substitute.
3. **Origin/evaluation snapshot transaction adapter/isolation.** Named caller and lock/isolation strategy must establish that the compared snapshot is the one used by the mutation/evaluation, including phantom handling. Current P04 has no connected adapter. Freeze it in the implementer brief and leave runtime proof for separately authorized SQL schedules.

No model/runtime route evidence or independent acceptance is claimed. This document resolves the semantics of permitted control deltas and explicitly identifies where actual existing P04 evidence cannot close the origin-verification requirement.

## 10. Frozen source hashes

SHA-256 of the exact files read at observed HEAD:

| Source | SHA-256 |
| --- | --- |
| src/lib/ingestion-audit.ts | 5510b56099a520d3b85cab5cede9baf6cd3e184a24b4c350a8708f3debe42ddb |
| scripts/lib/indexing-audit-adapter.ts | fd668f018902cf38132e6b6fb4e8d73464c8e4fdb831e2d098bdaf64b1c4df14 |
| scripts/audit-ingestion-corpus.ts | 51644c86913648726948c5aa642e02e03b7613adcf648bd243e37e6d47f1acf8 |
| tests/fixtures/ingestion/active-corpus-inventory.json | cb10bd85130c84282305baf0b9bf6327129750974cae44effa536080e69e2201 |
| src/lib/ingestion-enqueue.ts | 06da8170636788de1c141396699b71e0960ec376746c938e18c5ee1628f0af3a |
| supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql | 92924c2c2b324866a18a0436a581b37886a44f440b6fbc8cd84fda22eed9ad0f |
| supabase/schema.sql | 34c22c97cabd6b9a0f754265c1b4da69b440c5c250f66fb3bffa551b83a31741 |
| docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md | 877594a62de02ef3391ae0c9ca7594b827e768d8b0603eef3adfba0530dc2939 |
| docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/shared-contract-freeze-v1.md | 731bda7eaeea5a6dac40748995ce015ab1678b43245f142a9ef70ba481f21820 |
