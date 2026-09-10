# U04 schema contract recommendation 1

Status: **design contribution only**. This is a proposed contract for controller and independent amendment review, not implementation permission, independent acceptance, executable SQL, or a new review verdict on accepted U03.

Inspected source: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`, branch `codex/rag-local-build-20260822`, HEAD `b335cfbe5e9953a4d3c67ca40a3f1c1f4b41fa08` (confirmed read-only). Inputs: `U04-staging-owner-preparation-1.md`, SHA-256 `de6eafba638f39ff513802f69a688f156ae3b0fdf604ca0238fe873f5c7eb319` (confirmed), `U04-controller-acceptance-constraints-1.md`, `U04-task4-at-b335cfbe5e.md`, current shared freeze and U03 execution contract. The supplied owner inventory is adopted; only the keys and seams needed for this design were inspected. Applicable root AGENTS and review protocol were consulted. This is not a branch/PR review; no review ledger record is due.

No repository edits, SQL authoring/application, tests, providers, worker/server or operational commands, untracked enumeration, commits or delegation occurred. The sole output is this new outside document. One attempted outside-file write failed before process creation because of the Windows command-length limit; it wrote no file. A memory lookup supplied only the historical scoped-offline-work reminder; current inputs govern the proposal.

## 1. Chosen minimum

Reuse existing generation-addressed core tables. Add generation-addressed pages as Task 4 requires. Keep live summary/label/quality/alias tables as current compatibility projections; put candidate singleton/set projections in **one fixed private relation with separately named, validated columns**. Add a wave, per-document generation ledger, immutable inventory and baseline bundle. No second source catalogue, generic destination-table argument, unrestricted patch RPC or activation mechanism.

Throughout shadow processing, Fence.expected remains live G0 (including supported null); the server-bound write target is C. Deep-memory producer generation D remains distinct from both. Only standard commit advances the live pointer and returns the U03 Fence handoff. Candidate adapters must not simulate that handoff.

Choose **single-attempt reservation per document in C**: once its first claim commits, no reclaim/re-execution of that member in C. A failed/uncertain member prevents whole-wave evaluation. A replacement plan requires a fresh C for the whole population and separately scoped operational authority. This preserves uncertain evidence without adding attempt identity to every core storage key and reader.

## 2. Same-C retry decision, grounded in actual keys

| Family | Inspected effective key |
| --- | --- |
| Pages | `schema.sql:110-119`: UUID PK; UNIQUE(document_id,page_number). Proposed U04 UNIQUE(document_id,index_generation_id,page_number) still has no attempt token. |
| Chunks | `schema.sql:735-737`: UNIQUE(document_id,index_generation_id,chunk_index) WHERE generation IS NOT NULL. New A2 in C collides at the same ordinal. |
| Embedding fields | `schema.sql:780-781`: UNIQUE(document_id,source_chunk_id,field_type,content_hash). source_chunk_id is nullable; null is not an idempotency guarantee. Fresh source chunks require fresh UUIDs. |
| Sections | `schema.sql:244-250`: legacy UNIQUE(document_id,section_index) WHERE artifact_generation_id IS NULL; producer UNIQUE(document_id,producer,artifact_generation_id,section_index) for non-null producer/D. Candidate sections must use local-worker/non-null D. |
| Images, facts, units, cards | UUID PKs; producer-generation indexes on units/cards are not unique barriers. A2 can silently accumulate mixed attempts even where no conflict occurs. |
| Live projections | Summary document UNIQUE; quality document PK; labels UNIQUE(document_id,label_type,label,source). Aliases have UUID PK/search indexes; existing deep-memory RPC also checks owner/alias/type collisions procedurally. |

Adding token only to private projections would not isolate core retry. Therefore:

- Enqueue with identical canonical plan returns existing reservation identity; it never resets/requeues a claimed member. Changed plan under C, duplicate/foreign membership, or C equal to any member's G0 refuses.
- First successful shadow claim atomically records an immutable first token/job identity in the ledger and sets the durable write generation to C. Standard claims retain fresh server UUID/new token behavior.
- Once a shadow ledger has a first token, claim refuses reclaim even if no database rows exist. An HTTP upload/result may still be in flight. Report `shadow_wave_restart_required`; do not delete, merge, reset or mint a replacement claim token.
- A valid first attempt may continue after a provably unsent operation. Ambiguous non-idempotent mutation responses do not authorize blind resend. Immutable receipt reads can establish a past seal; they do not revive a lease.
- The matched shadow job's failure path records its terminal outcome/actual batch accounting without requeueing, changing documents, or completing siblings. An expired processing member remains unusable; no new reaper is required. A diagnostic derives expiry/failure from the bound job instead of falsely marking it staged.
- Every late mutation still requires original unexpired Fence and unchanged G0/source authority. Physical late uploads may finish but cannot attach after loss of authority. All uncertain rows/objects remain for governed U05/U13 lifecycle work.

This availability tradeoff needs controller/independent approval. It preserves U03's new-token-per-successful-claim rule: a refused reclaim is not a successful claim. If same-C reclaim is mandatory, reject this minimum and design full attempt isolation; do not patch conflicts with deletion or upsert.

## 3. Exact relation contract

Types below describe the proposal, not executable DDL. New private tables may remain in `public` for existing tooling, but RLS is enabled with no anon/authenticated access, service SELECT only and RPC-only writes. Explicitly revoke inherited service INSERT/UPDATE/DELETE/TRUNCATE and PUBLIC privileges before grants. Null-owner rows remain private. New evidence FKs use RESTRICT/NO ACTION; no cascading deletion of receipts/bundles. Existing core cascades remain U05 lifecycle dependencies, not permission to delete retained evidence.

### A. shadow_reindex_waves

- `candidate_generation_id uuid PRIMARY KEY`; `plan_digest text UNIQUE NOT NULL`; `plan_version integer NOT NULL CHECK = 1`.
- `project_ref text NOT NULL CHECK = 'sjrfecxgysukkwxsowpy'`; `source_policy_version text NOT NULL`; `audit_digest text NOT NULL`; `population_fingerprint text NOT NULL`; `recovery_evidence_digest text NOT NULL`; `baseline_evaluation_digest text NOT NULL`; `operation_manifest_digest text NOT NULL`.
- `plan_payload jsonb NOT NULL` (closed ShadowReindexPlanV1 including exact members); `created_at timestamptz NOT NULL`, server chosen.
- All digests use lowercase `sha256:` plus 64 hexadecimal characters; policy version nonempty. Immutable after insert. No active/promoted state. Stage outcome derives from ALL exact member ledgers, not caller counters. Baseline-evaluation digest binds validated evidence; its mere presence does not prove metrics.

### B. document_index_generations

- `document_id uuid NOT NULL REFERENCES documents(id)`; `index_generation_id uuid NOT NULL REFERENCES shadow_reindex_waves(candidate_generation_id)`; PRIMARY KEY(document_id,index_generation_id).
- `owner_id uuid NULL` frozen from document; `baseline_generation_id uuid NULL`; `expected_state_digest text NOT NULL`; `authority_digest text NOT NULL`; `source_binding jsonb NOT NULL`, containing existing authority identity rather than a new authority system.
- `job_id uuid NOT NULL UNIQUE REFERENCES ingestion_jobs(id)`; `first_lease_token uuid NULL`; `claimed_at timestamptz NULL`; `state text NOT NULL CHECK IN ('reserved','building','staged')`.
- `expected_inventory_digest text NULL`; `inventory_digest text NULL`; `candidate_projection_digest text NULL`; `baseline_bundle_digest text NOT NULL`; `stage_receipt jsonb NULL`; `stage_receipt_digest text NULL UNIQUE`; `staged_at timestamptz NULL`.
- Reserved means no token/time/receipt; building means token/time but no receipt; staged requires all seal digests/receipt/time. Receipt fields are all-null or all-present. Identity, first token and final receipt are immutable; no state reversal. A failed job can leave building evidence; it must not be relabelled staged.
- Bind job.document_id, operation and C using composite FK where possible and explicit locked validation. Membership must exactly equal the plan. Owner/source/G0 compare null-safely. Seal only when actual families and all required evidence satisfy the frozen contract.

### C. document_generation_projections

- PRIMARY KEY/FK `(document_id uuid,index_generation_id uuid)` to B; `lease_token uuid NOT NULL` equals B.first_lease_token; `owner_id uuid NULL` derived.
- `summary jsonb NULL`, `generated_labels jsonb NULL`, `summary_projection_complete boolean NULL`, `enrichment_metadata jsonb NULL`.
- `quality jsonb NULL`, `worker_metadata jsonb NULL`, `document_counts jsonb NULL`.
- `deep_memory_artifact_generation_id uuid NULL`, `deep_memory_receipt jsonb NULL`, `deep_memory_metadata jsonb NULL`, `producer_aliases jsonb NULL`.
- `summary_digest text NULL`, `quality_digest text NULL`, `deep_memory_digest text NULL`, `worker_state_digest text NULL`, `sealed_at timestamptz NULL`.
- Each family is absent until its named RPC atomically finalizes it. Thereafter exact same request digest may return its stored result under a valid Fence; changed bytes refuse. Optional failure is inventory evidence, not `{}` masquerading as a projection. Final seal freezes the row.
- summary uses existing U02 validated row fields: summary, clinical_specifics, source_chunk_ids, source_image_ids, model, metadata. Preserve complete source-anchored payload/marker. generated_labels uses the existing label schema/confidence/source metadata with source=generated only, unique type/label identities within C. No manual labels admitted.
- quality includes ALL existing document_index_quality fields, including nullable coverage metrics, metrics and issues; it is not reduced to quality_score. document_counts has exactly page_count/chunk_count/image_count/status/error candidate values. These never update documents in U04.
- enrichment_metadata uses U03's five-key enrichment ownership list. worker_metadata uses the exact existing U03 worker allowlist with C validated. Neither accepts organization_profile/organization_profile_version. deep_memory_metadata permits only existing producer pointer/version/timestamp/receipt keys, explicitly enumerated in the brief.
- producer_aliases contains exact local-worker candidate rows: id, alias, canonical, alias_type, weight, enabled, metadata. Server binds owner/document/C/D/token. Reject duplicate owner/alias/type within the payload and collisions with manual/foreign producer aliases. Do not insert into rag_aliases or delete baseline aliases.

These are fixed domain JSON payloads, not EAV or a generic patch API. Their closed validators and existing producer limits must be named in the implementer brief and TypeScript contract. Exact family field/digest consistency checks are required.

### D. document_generation_inventory

- PRIMARY KEY `(document_id uuid,index_generation_id uuid,family text,unit_key text)`; composite FK to B; `lease_token uuid NOT NULL`, bound to first token.
- `expected boolean NOT NULL`; `required boolean NOT NULL`; `disposition text NOT NULL CHECK IN ('pending','retained','excluded','failed','skipped','not_required')`; `reason_code text NULL`; `limitations jsonb NOT NULL` using closed versioned limitation records.
- `producer text NOT NULL`; `artifact_generation_id uuid NULL`; `artifact_ref jsonb NULL`; `content_digest text NULL`; `source_binding jsonb NOT NULL`; `relationships jsonb NOT NULL`.
- `retained_evidence_text text NULL`; `retained_native_payload text NULL`; `representation_version text NULL`; `transform_version text NULL`. These retain FULL already-produced evidence without an existing artifact owner. No clipping, invented anchors or newly claimed native capability.
- Closed families: pages, native_structure, chunks, images, table_facts, embedding_fields, index_units, sections, memory_cards, summary, generated_labels, quality, document_metadata, producer_aliases, private_objects, attempt_control, cache_inputs, repair_audit_inputs. artifact_ref is a tagged reference to these named owners, never a SQL table name selected dynamically.
- Declare expected identity population BEFORE each producer/persistence stage; derivation expectations come from its planned outputs, not surviving writes. Unknown native population/capability gets a typed limitation; cannot become a completeness claim. Declaration is immutable; final disposition is write-once for the original token. pending blocks seal. retained requires resolvable full reference/payload and digest. excluded/failed/skipped require scoped reasons; not_required is non-expected with reason. Unexpected outputs must be explicitly represented/reconciled or rejected.
- Every available producer unit and relationship is retained in its existing table or the full evidence slots above. No duplicate chunk embeddings required. This is inventory/provenance, not another retrieval catalogue.

### E. document_generation_baselines

- PRIMARY KEY/FK `(document_id uuid,candidate_generation_id uuid)` to B; `baseline_generation_id uuid NULL`; `expected_state_digest text NOT NULL`; `bundle_version integer NOT NULL CHECK = 1`; `bundle_payload jsonb NOT NULL`; `bundle_digest text NOT NULL`; `captured_at timestamptz NOT NULL`.
- Immutable closed baseline-bundle-v1, captured from locked rows during enqueue. Never trust an arbitrary caller's baseline snapshot. Captures full singleton/set payloads and exact retained core/object inventory in section 8.
- B stores its digest; enqueue inserts B then E and verifies both before commit. No circular FK required. A digest/reference without retained recoverable bytes is not a recovery bundle.

### F. Existing table changes

- ingestion_jobs: `operation text NOT NULL DEFAULT 'standard' CHECK IN ('standard','shadow_reindex')`; `requested_generation_id uuid NULL`; `shadow_plan_digest text NULL`. Standard requires both null; shadow requires both and valid A/B membership. Operation/request/plan immutable after enqueue. Existing durable write generation equals C for shadow, fresh UUID for standard.
- document_pages: nullable `index_generation_id uuid`; UNIQUE(document_id,index_generation_id,page_number), plus UNIQUE(document_id,page_number) WHERE index_generation_id IS NULL to preserve one legacy set. New rows have non-null server-stamped C/G1 in typed AND metadata identity. Preserve actual producer page meaning; no fabricated DOCX/XLSX physical pages. Standard commit inserts only target pages and ceases deleting all document pages.

## 4. Fixed RPC signatures and ownership

All required parameters below are non-defaulted. Mutators return strict typed JSON envelopes and must roll back all effects on error. Necessary SECURITY DEFINER functions are postgres-owned with `search_path=''`, fully qualified names; explicit revoke from PUBLIC/anon/authenticated/service_role, then EXECUTE to service_role only for entrypoints. Internal helpers receive no service grant. No global default ACL changes. Accepted U03 migration bytes stay unchanged; the new U04 migration and schema snapshot own amended effective functions.

1. `enqueue_shadow_reindex_generation(p_plan jsonb,p_baseline_evaluation jsonb,p_recovery_evidence jsonb,p_operation_manifest jsonb) returns jsonb`. Validate closed inputs/project/expiry/operation/population/digests/baseline-before-stage. Lock sorted members' source/document/queues in U03 order; verify exact P04 state/authority; atomically create A/B/E and jobs. Return C/plan/job/bundle identities. Identity-idempotent return never restarts claimed work.
2. `write_shadow_generation_inventory(p_fence jsonb,p_generation uuid,p_declarations jsonb,p_dispositions jsonb) returns jsonb`. Closed declaration/final-disposition protocol; bind first token/C, never rewrite finalized evidence. Identical valid-Fence retransmission is allowed; changed identity/content refuses.
3. `write_shadow_generation_pages(p_fence jsonb,p_generation uuid,p_pages jsonb) returns jsonb`. Append exact declared C pages only. Conflicts refuse; never adopt another attempt. Standard commit retains its signature and inserts its own generation-addressed pages.
4. `persist_shadow_summary_projection(p_fence jsonb,p_generation uuid,p_summary jsonb,p_labels jsonb,p_metadata jsonb) returns jsonb`. Accepted U02 normalization and exact C source membership; atomically finalize candidate summary/labels/enrichment metadata only. Never delegate to the live summary RPC.
5. `stage_shadow_deep_memory(p_fence jsonb,p_generation uuid,p_artifact_generation uuid,p_sections jsonb,p_cards jsonb,p_units jsonb) returns jsonb`. D subordinate to C, local-worker, first token; C chunk/image membership and D section membership. Reuse existing pre-finalization D row shape with explicit C link. D must differ from C/G0 and other owned producer generations. No legacy-null D sections.
6. `finalize_shadow_deep_memory(p_fence jsonb,p_generation uuid,p_artifact_generation uuid,p_rag_memory_version text,p_document_intelligence_version text,p_section_count integer,p_memory_card_count integer,p_index_unit_counts_by_type jsonb,p_anchors jsonb,p_aliases jsonb) returns jsonb`. In one transaction verify exact D family counts/membership/token; repair only still-null C chunk anchors, reject contradictions, stamp C chunks; set only that D's section/card/unit index_generation_id to C while retaining artifact_generation_id=D; freeze candidate deep-memory receipt/metadata/aliases. No live commit call, document pointer, live alias replacement or live enrichment completion. Alias failure rolls back all changes. Never cleanup after ambiguous invocation.
7. `persist_shadow_generation_quality(p_fence jsonb,p_generation uuid,p_quality jsonb,p_counts jsonb,p_metadata jsonb) returns jsonb`. Finalize the full fixed C quality/counts/worker metadata fields. No U10 technical eligibility.
8. `stage_document_index_generation(p_fence jsonb,p_generation uuid,p_inventory_digest text,p_projection_digest text,p_expected_state_digest text) returns jsonb`. This is the final terminal SEAL after enrichment, not the old early core commit point. Under original live Fence/current authority/state, derive and compare exact inventory/digests; require all declared families terminal, required retained artifacts resolvable, no mixed tokens and required projection seals present. Atomically seal B/C, complete only its matched shadow job, and aggregate actual batch. No documents/pointer/sibling/Edge-repair mutation or Fence handoff. Include terminal control evidence in receipt. Missing evidence is not rescued by positive counters.
9. `get_shadow_generation_receipt(p_plan_digest text,p_generation uuid,p_document_id uuid) returns jsonb`. Service-only historical immutable read, no lease revival. Absent receipt returns typed absent. Evaluation separately checks current state/authority.

Existing base-write/prepare-upload/control signatures remain. Every shadow-reachable mutation owner must validate durable operation/C/first-token/state, including base artifacts, heartbeat/progress/stages and terminal paths. Shadow reset is refused after claim. Generic document patch, live summary/quality/deep-memory completion, standard core commit and normal completion must explicitly refuse persisted shadow jobs even if called directly. Worker branching alone is insufficient. Standard path remains unchanged apart from required page retention/visibility behavior.

Required fixed internal helpers, no service EXECUTE:

- `assert_shadow_ingestion_attempt(p_fence jsonb,p_generation uuid) returns jsonb`: call unchanged U03 live/authority/target assertion first; then check Node shadow mode, exact plan membership, first token and building state. Never weaken expected/live equality. Stale Fence keeps exact U03 lease_lost zero-effect result.
- `assert_shadow_generation_state(p_document_id uuid,p_generation uuid) returns void`: locked comparator, with sanctioned-control-state issue in section 9 resolved before implementation.
- `validate_shadow_plan_v1(p_plan jsonb) returns jsonb`; `validate_shadow_inventory_v1(p_declarations jsonb,p_dispositions jsonb) returns void`; named fixed summary/quality/alias/baseline validators.
- `capture_shadow_baseline_bundle(p_document_id uuid,p_generation uuid) returns jsonb`: locked fixed-family capture, recomputed digest.
- `compute_shadow_generation_inventory(p_document_id uuid,p_generation uuid) returns jsonb`: explicit fixed queries over named owners, source/provenance/reference membership and expected-outcome reconciliation, not count-only proof.
- `guard_shadow_generation_evidence_mutation() returns trigger`: protect identities/first token/final dispositions/sealed new records; no activation behavior.

Core co-resident artifact writers must likewise refuse staged C mutation. Evaluation/U05 recheck exact digests. This is not a claim that arbitrary service/table-owner SQL cannot mutate a table; installed privileges and transactional concurrency remain separate SQL evidence.

## 5. Actual producer flow

The actual importable worker orchestration validates persisted operation/C/plan, retains one serial Fence/cancellation owner, declares expected inventory, writes base C artifacts, appends C pages, invokes actual candidate summary/deep-memory adapters, finalizes C quality/metadata, reconciles inventory and seals. No reload may require live generation C. Candidate service selectors load exact C/first-token inputs while Fence stays G0.

Summary retains accepted U02 full normalized payload. Deep memory retains distinct D, exact source arrays/text/relationships/anchors and embeddings. Optional failures stay typed scoped failures, never fabricated structured completion or silent demotion of richer retained evidence. Required gaps block evaluation. Cache/repair audit are exact input references, not rollback targets or new operational repair capability.

Images keep U03 immutable document/token/C/upload paths and upsert:false. Unattached/ambiguous objects are recovery dispositions, not successful evidence and not deleted by U04. Inventory full evidence slots retain existing native/structural output only; U09 still owns missing extraction capabilities and full native fixtures.

## 6. Legacy pages, null baselines and ordinary visibility

Do not assign untagged pages to G0 merely because the document pointer is G0 today. Copy a page's already-valid generation metadata into the typed column only where provenance is unambiguous. Leave truly untagged rows null; malformed/contradictory records require explicit refusal/quarantine handling rather than invented identity. Preserve rows and record legacy-unattributed status.

For ordinary pages select exact active G0; allow the null legacy set only as an explicit fallback when no identifiable active page set exists. Never combine null and generation copies of the same ordinal. For supported G0-null select only genuinely untagged legacy pages. Apply visibility BEFORE page range/order/limit. A malformed document generation marker is not supported null and fails closed.

Other generation helpers preserve unset production legacy behavior except necessary candidate/null exposure closure. Candidate rows always have non-null consistent typed/metadata C, or pre-finalization D plus explicit C link. Missing/invalid candidate identity must refuse on write. TypeScript `isCommittedGenerationMetadata` must stop accepting every row under null live baseline: only genuinely untagged legacy rows are allowed there; present-invalid markers refuse.

Private candidate projections avoid ordinary summary/labels/quality/alias reader rewrites merely to store C. The owner's conditional document-list/label-review/search-scope additions are consequently unnecessary for that storage reason. Still implement all unconditional pages/images/null-helper/quality-input seams in the owner inventory: admin/service reads bypass RLS and must filter before counts/cover selection/paging/signing. Co-resident candidate sections/cards/units also require active visibility.

Extend relevant ordinary artifact SELECT policies with active visibility AND existing owner/public predicates. New staging tables have no ordinary read policy, even for null owner. Preserve null-owner fail-closed retrieval and public sentinel mapping to owner_id IS NULL. No evaluation GUC can widen tenancy or source eligibility. Any new view uses security_invoker=true. Private Storage serving retains existing signature/current-generation/source checks; no bucket-policy change is proposed.

## 7. Exact evaluation signatures and projection context

Required non-defaulted signatures:

- `eval_match_document_chunks_text_v2(p_eval_generation_id uuid,p_plan_digest text,p_stage_receipt_digest text,p_query_text text,p_match_count integer,p_document_filters uuid[],p_owner_filter uuid,p_include_public boolean)`; same result shape as existing text_v2.
- `eval_match_document_chunks_hybrid_v2(p_eval_generation_id uuid,p_plan_digest text,p_stage_receipt_digest text,p_query_embedding extensions.vector(1536),p_query_text text,p_match_count integer,p_min_similarity double precision,p_document_filters uuid[],p_owner_filter uuid,p_include_public boolean)`; same result shape as existing hybrid_v2.

Service-only/postgres-owned/empty search path. Validate exact wave, ALL member seals, aggregate receipt digest, current source/owner/G0 state and bounded filters before query. Filters equal the authorized evaluation population; any per-query subset needs an explicitly bound session subset. No null/global expansion, unsealed/mixed wave, null-owner misuse or stale authority.

If using transaction-local GUC context, set it only inside validated wrappers and save/restore previous context on success and exception. A setting alone is not authority; valid role/wave/receipt checks remain required. Update both `is_committed_document_generation(uuid,jsonb)` and `(uuid,uuid)` and both `is_committed_artifact_generation(jsonb,jsonb)` and `(uuid,jsonb)` consistently: valid eval context selects exact C with NO legacy-null escape; unset context retains production behavior above. Do not leak context to later queries.

Candidate evaluation must select C private summary/generated labels/metadata, not G0 projections. Add fixed internal candidate branches to `document_label_metadata`/`document_summary_text` and effective base/inline joins used by selected RPCs; unset context preserves live path. Finalized D rows have index_generation_id=C and must match C's private D receipt. Do not change owner/public ranking or order.

Candidate alias expansion must use C's exact private producer alias set, or report the affected metric unavailable/NO_GO. Silent G0 aliases cannot establish candidate equivalence. Baseline evaluation runs read-only at each bound G0 before enqueue; null legacy baseline has explicit metrics/limitations. Missing/incomplete/drifted evidence blocks evaluation. No wrapper promotes, issues technical eligibility or changes ordinary Answer visibility.

## 8. Complete U05 baseline bundle and handoff

U04 must capture and retain, per member:

- Plan/C/document/source/owner, G0 or legacy null, exact P04 origin digest/current authority, capture time and baseline evaluation/recovery digests.
- Exact retained IDs/full row digests/source/storage references for pages/native representations, chunks/embeddings, fields/units/facts, images/captions, sections/cards and every producer generation. Existing rows/objects remain resolvable. If no immutable owner can retain full available bytes, capture the full payload or mark recovery incomplete; a digest alone is insufficient.
- FULL live summary row, U02 payload, source arrays, IDs/timestamps/metadata/marker; FULL generated label set with source/confidence/metadata. Record manual labels separately for preservation/comparison.
- FULL quality row and live document status/count/error/metadata snapshot. Future restoration is limited to explicit generation-owned keys. Organization/manual/source-policy fields are compared/preserved, never blindly restored from stale whole-document JSON.
- Every producer pointer/version/commit receipt and exact owned alias rows; foreign/manual alias identity for collision checks. C supplies an exact replacement set, not a generic delete predicate.
- Attached immutable private-object paths/hash/size/type/provenance; uncertain/orphan/unavailable objects have separate dispositions rather than successful attachment claims.
- Bound job/attempt/stage and relevant queue/batch/sibling state, exact used cache/repair-audit references and typed limitations. These are audit evidence, not instructions to rewind jobs, siblings, caches or history.

Stage receipt binds this bundle digest, expected and actual inventory, candidate projection digest, C/D identities, first token/job identity, original state/authority and every failure/skip/exclusion/not-required reason. Structure, completeness, authority and semantic support remain independent; support remains unassessed absent separately governed evidence.

U05 receives the entire bounded wave, bundle/receipt identities, retention references and writer-ownership rules. Its future atomic switch must validate them under the same locks, recheck/snapshot live singleton state at switch time, preserve concurrent non-owned metadata/manual edits, and refuse/rebaseline on changed baseline evidence. U04 creates no promotion/rollback/cleanup API or retention executor. Staged is not active, ordinarily visible, technically eligible or clinically accepted.

## 9. Required unresolved decisions before implementation dispatch

The proposed storage and retry decision is concrete, but the controller/independent reviewer must freeze these remaining items:

1. Approve conservative single-attempt wave behavior, including shadow-specific terminal/retry guards. Requiring same-C reclaim instead invalidates this minimum; it needs full key/reader attempt isolation.
2. Freeze shared canonical digest encoding for plan, expected inventory, projection, bundle, member/aggregate receipts. Do not equate JSON.stringify with jsonb::text or unordered jsonb_agg. Specify domain separation, UTF-8 encoding, ordering/length/null/number handling, helper ownership and test vectors. No unreviewed hash implementation is supplied here.
3. Freeze exact state comparison through sanctioned U04 queue changes. P04 state includes queues; enqueue/claim/seal alter their own rows. Retain the original P04 snapshot/digest and compare current source/artifact/non-owned state while accounting ONLY for exact ledger-bound U04 job transitions. Name a pure comparator and locked SQL equivalent. Do not globally omit queues, or pass a newly calculated modified-state digest off as the original plan identity. Unknown equivalence fails seal.
4. Approve page legacy fallback and explicit migration preconditions for malformed/contradictory identity. Do not silently repair real data or fabricate page provenance.
5. Freeze per-family closed schemas/limits/requiredness, including whether truthful optional limitations permit an inert staged receipt while preventing evaluation. Required missing evidence must never produce complete-candidate evaluation. Unknown native capability remains typed U09 debt.
6. Name the exact effective SQL metadata/base/inline-join owners for both eval paths and candidate alias expansion adapter. Private storage removes ordinary singleton co-residence work; it does not eliminate eval's need for C metadata.
7. Freeze exact additional source/test owners from the owner's preparation plus comparator/digest helpers. Root owns the allowlist and outside verification recipe. Missing contracts cannot be resolved by silently adding U05/U09/U10 behavior or generic patch capability.

Actual SQL transaction/rollback/concurrency/RLS/owner/grant behavior and migration/snapshot replay remain separately authorized and unrun. This document is a design contribution awaiting independent review; it cannot independently accept itself or establish U04 completion.
