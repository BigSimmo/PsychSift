# U03 execution contract

Review candidate against accepted checkpoint `fd043b262ebd9b20315c2e46bc4838265787fa80`. This supplements original Task 3 in the [continuation plan](../../../plans/2026-08-31-ingestion-first-continuation.md); it does not create another U03 acceptance range. The [shared contract](shared-contract-freeze-v1.md) and [execution authority](2026-09-07-execution-authority.md) apply. Independent xhigh acceptance of the complete planning range precedes product dispatch.

## Outcome and limits

Every inventoried Node/strict-Edge ingestion writer must prove the current durable attempt, expected generation and source authority inside its database mutation transaction. A stale attempt must not publish evidence, overwrite metadata, finish a replacement attempt or reopen it. Repair planning is deterministic, bounded and dry-run only. Preserve sound committed evidence, accepted U02 projections and manual/organisation-owned metadata.

U03 supplies source changes and offline proof. It does not apply SQL, run workers or providers, acquire/process real documents, activate source versions, enable the kernel, perform repairs or publish anything. In-memory authored regression data is permitted. SQL lock/role/concurrency schedules, physical Storage cancellation, native extraction and connected acceptance remain separate, unrun gates. A caller mock is not atomicity proof.

## Frozen input and ownership

The outside preparation files are at `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/`:

- `U03-frozen-task-context.md`: original Task 3, SHA-256 `f19c9a082edf068d9700e09401badfbcd270694abecb4ef8a0c4a6e62d3cdcea`.
- `U03-frozen-owner-preparation.md`: reused all-writer inventory, SHA-256 `74bf1c4d4960feaf87787f187f1de474b9680b98b8e8b7594da324a256e78ec7`.
- `U03-schema-contract-recommendation.md`: chosen schema contribution including its operator-compatibility appendix, SHA-256 `adb0735ae327f04a2206a78f2bc2c7ba8a51ce6bded28d89042cdf6065f2da0c`. Its author's recommendation is not independent acceptance. The pre-append version is retained in preparation history, not used as the complete current input.
- `U03-operator-compatibility-followup.md`: exact entry boundaries, import-safe seam and tests, SHA-256 `b22168040664b13fb15d4b30f5e68a5fd53db4d1311798caba12f60ca982215a`.
- `U03-verification-preparation.md`: evolving bounded check preparation; the acceptance manifest must bind its final bytes and the approved executable recipes. Earlier compiler recipes explicitly superseded there are not executable authority.

One fresh Astra High implementer owns the complete original U03 range. The controller owns scope, evidence, gate execution and integration. Use serial increments, one repository writer and at most two concurrent children. Planning contributors cannot independently accept their own contribution. No recursive delegation or other-task message is authorised.

Create only these product paths:

- `supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql`
- `supabase/functions/_shared/ingestion-attempt.ts` — shared pure Fence/result parsing and monotonic cancellation state; no server startup.
- `src/lib/ingestion-repair-plan.ts` — deterministic pure planner and canonical digest encoding.
- `scripts/lib/ingestion-operator-compatibility.ts` — pure unleased-mode refusal and direct-invocation identity helper.
- `tests/ingestion-lease-fencing.test.ts`
- `tests/ingestion-repair-plan.test.ts`
- `tests/ingestion-operator-compatibility.test.ts`

Modify only these existing owners when required:

- `worker/types.ts`, `worker/row-contracts.ts`, `worker/behavior.ts`, `worker/main.ts`.
- `supabase/functions/indexing-v3-agent/index.ts`, `supabase/functions/indexing-v3-agent/behavior.ts`.
- `src/lib/document-enrichment.ts`, `src/lib/deep-memory.ts`.
- `scripts/backfill-smart-index.ts`, `scripts/enrich-documents.ts`, `scripts/archive/backfill-enrichment.ts` — only the explicit unleased-write refusal and type-compatible call-site treatment described below.
- `supabase/schema.sql`, `src/lib/supabase/database.types.ts`.
- `tests/indexing-v3-agent.test.ts`, `tests/worker-behavior.test.ts`, `tests/worker-run-loop.test.ts`, `tests/worker-runtime-control.test.ts`, `tests/worker-row-contract.test.ts`, `tests/check-indexing-contract.test.ts`, `tests/document-enrichment.test.ts`, `tests/deep-memory.test.ts`, `tests/deep-memory-transaction-sql.test.ts`, `tests/worker-visual-capture.test.ts`, `tests/worker-shadow-extraction.test.ts`, `tests/storage-upload-compensation.test.ts`.
- `docs/ingestion-state-machine.md`, `docs/worker-deploy-runbook.md`, `docs/reindex-runbook.md`, `docs/codebase-index.md`, `docs/scripts-index.md`.

Keep the existing general Storage helper's unrelated consumers unchanged; change ingestion call sites and their focused tests. Keep `_shared/source-anchored-summary.ts` unchanged unless an actual U03 persistence integration defect requires a reviewed scope amendment; its accepted normalisation is not being redesigned. Controller-owned unit evidence and progress records are separate explicit allowlists. Additional product owners require a concrete reviewed brief amendment, not an implicit directory-wide permission.

## Attempt and generation contract

Both `ingestion_jobs` and `indexing_v3_agent_jobs` receive `lease_token uuid`, `lease_expected_generation_id uuid` nullable, `lease_write_generation_id uuid`, `lease_authority_digest text`, `lease_expires_at timestamptz` and bounded `lease_duration_seconds integer`. Preserve the existing claim parameter's 45-minute default; validate integer `p_stale_after_minutes` in 1–1440 and persist seconds in 60–86400. Reject out-of-range configuration explicitly rather than clamping silently. Processing rows require the complete tuple; enforce digest syntax and duration bounds in the schema. Each claim/reclaim generates a new UUID even for the same worker. Persist the duration at claim; heartbeat cannot renew an expired lease or choose an arbitrary new threshold.

Do not fabricate valid tokens for historical processing rows. The migration must refuse application with a clear drain-required precondition while any such rows remain. Operational draining/application is separately authorised. Non-processing historical rows may retain null lease fields.

Every mutating domain call has this required non-defaulted Fence:

```text
job_kind (node | indexing_v3), job_id, document_id, worker_id,
lease_token, expected_generation_id, authority_digest
```

The internal `assert_current_ingestion_attempt` references both job tables through two explicit static branches. Match full identity, `status = processing`, unexpired lease, the durable expected generation and recomputed current source authority under locks. A target generation must equal the durable write generation. No null-worker, missing-token, missing-digest, generation-only or caller-selected-table branch exists.

Node claim reserves write generation G1 and records committed G0. Staging writes belong only to G1 while the live pointer stays G0. The non-empty fenced core commit changes the pointer to G1 and advances the job's expected generation in the same transaction, returning the new Fence. Later summary/quality/deep-memory writes require G1. Holding G0 is not permission to invent that handoff. The initial Node G0-null case is allowed only when typed generation is null and generation metadata is absent, not malformed or contradictory. `documents.index_generation_id` is generated from metadata; do not assign it directly.

Edge claim requires an exact non-null committed generation, used as expected and write generation. Both claim paths recheck both queues under the document lock; only one live Node/Edge attempt may own a document. Include `job_kind` even when UUIDs in the two tables happen to match. Reset only this attempt's unpublished staging generation; do not delete prior committed or identifiable legacy evidence because a document status changed.

Exactly return `{ "ok": false, "reason": "lease_lost" }` for absent/stale identity, expiry, generation or authority, with zero database side effects. Gate refusal has a separate typed failure such as `completion_gate_blocked`. Invalid input, missing RPC, permission error, malformed RPC response and database failure are hard failures. None authorises a direct-write fallback.

## Source authority and lock order

Reuse P05; add no source catalogue or publication mechanism. Catalogue-tagged documents require one exact version linked through `staging_document_id`, the latest activating event, matching event/policy/digest and permitted lifecycle, exact source URL/version/hash/licence/owner/content-clearance identity. Any P05 link or public-source marker forbids the non-catalogue fallback. Unknown, contradictory, unsupported or withdrawn authority refuses. The digest combines `public_source_acquisition_identity_digest(version_id)`, version identity/lifecycle and latest event identity/sequence/decision/policy. It excludes changing progress and generation, which are checked independently.

For a genuinely non-catalogue document, digest the locked document's exact owner, source/storage/file/content identity and governance/content-clearance fields with explicit null representation. Do not reinterpret public sentinels or retrieval owner scope. SQL identity matching does not replace protected-content scans or future U07/U08 pre-egress clearance.

Use one order for claims and domain functions:

1. For P05, the existing `pg_advisory_xact_lock(pg_catalog.hashtextextended('public_source:' || catalogue_key, 0))` namespace.
2. Latest source event, then exact version row.
3. Document row.
4. Node jobs, then Edge jobs, ordered by UUID within each table; only needed rows.
5. Owned artifact families in fixed order, with stable row-key order.
6. Affected batch rows ordered by UUID, before aggregate queries.

A pre-lock key lookup routes the lock only. After acquiring the document lock, revalidate the link/key; refuse a changed route rather than taking a second source lock out of order. Claims may choose candidate IDs without locks, then use try-advisory-lock and ordered `FOR UPDATE SKIP LOCKED` with eligibility rechecks. A job-first lock followed by document/source waiting is forbidden.

The existing P05 event writer uses this same source advisory lock. If a policy event wins, the next mutation refuses; if the mutation wins, it finishes before that event. Recompute authority while holding locks inside every write transaction, not merely in caller preflight. Repeat the complete fence predicates in each job update. Unexpected affected-row counts roll back every write in that function through an exception/subtransaction boundary; returning false after earlier writes is not rollback.

No provider, native tool, HTTP Storage or callback runs inside SQL transactions. Use empty `search_path`, qualified objects and owner `postgres` for necessary `SECURITY DEFINER` functions. Revoke PUBLIC/anon/authenticated execution; grant only named service-role entry points. Internal helpers and obsolete unfenced overloads are not worker-callable. This protects the inventoried execution paths; it does not turn a database owner or arbitrary service-role client into an unprivileged principal.

Evaluate expiry with the actual wall clock after lock acquisition, not a transaction-start timestamp captured before waiting. Renewal derives the duration from the locked claim. A transaction that wins the shared locks may finish atomically before a reclaimer; no separate provider work may extend its lock lifetime.

## Domain operations and all-writer coverage

No arbitrary table/column/SQL/callback/unrestricted-patch RPC is allowed. Each operation has fixed SQL and bounded named artifact inputs.

| Mutation owner          | Required operation and atomic boundary                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node control            | `update_ingestion_job_progress`, `heartbeat_ingestion_job`, `patch_ingestion_document_state`; full Fence, explicit worker-owned metadata fields. Unparseable rejected claims cannot mutate terminal state.                                                                                       |
| Node base artifacts     | `reset_ingestion_attempt_artifacts`, `write_ingestion_base_artifacts`, fenced `commit_document_index_generation`, `persist_ingestion_index_quality`; named chunks/images/table facts/embedding fields/index units, pages in core commit.                                                         |
| Node and Edge summaries | `persist_ingestion_summary_projection`; exact summary, generated labels, completion marker and enrichment-owned metadata in one transaction.                                                                                                                                                     |
| Deep memory             | `stage_ingestion_deep_memory`, `cleanup_ingestion_deep_memory_staging`, fenced `commit_document_deep_memory_generation`; sections/cards/units, chunk-anchor repair, stamps and owned aliases.                                                                                                    |
| Edge stages             | `start_ingestion_job_stage`, `finish_ingestion_job_stage`; persist and match kind/job/document/attempt/generation, never stage ID alone.                                                                                                                                                         |
| Edge generated families | `replace_indexing_v3_sections`, `replace_indexing_v3_memory_cards`, `replace_indexing_v3_visual_artifacts`, `replace_indexing_v3_core_embeddings`; their units/facts/fields/image metadata are included in the respective fixed transaction. Summary-generated labels use the summary operation. |
| Terminal/retry/defer    | `complete_ingestion_job`, `fail_or_retry_ingestion_job`, `complete_strict_enrichment_job`, `update_indexing_v3_agent_job_status`; gate outcome, document/job metadata, release and actual batch aggregation are one transaction. Add `heartbeat_indexing_v3_agent_job`.                          |
| Caption cache           | `persist_ingestion_image_caption_cache`; derive owner from the locked document, retain current validation, require Fence. Full cache representation identity is U09/U13.                                                                                                                         |
| Image upload            | `prepare_ingestion_image_upload` assigns an immutable attempt path; base-artifact attachment rechecks Fence. HTTP bytes remain outside SQL atomicity.                                                                                                                                            |

Extend the four original service RPC signatures with required expected-generation/authority inputs. No default argument may recreate old tokenless calls. Inspect all overloads and grants, including Edge SQL and shared library callers. The same wrapper's explicit success/error parser must handle actual RPC responses, not just compile-time types.

Preserve accepted U02 byte-stable multi-item projection, exact source arrays/anchors, manual labels, `organization_profile` and `organization_profile_version`. The summary wrapper consumes the existing validated payload/projection; it cannot invent new model normalisation. Replace only generated labels for this document and merge owned keys under lock. Enrichment metadata owns only `rag_enrichment_version`, `rag_indexing_version`, `rag_memory_version`, `rag_enrichment_updated_at`, `generated_label_count`. Worker-state metadata has its own explicit field allowlist; broad stale document snapshots are forbidden. Provisional Edge fallback carries no generated labels, cannot complete structured enrichment and cannot downgrade an already valid structured payload. Valid retries remain provider-free and idempotent.

Deep-memory staging retains producer and artifact-generation ownership, adds attempt provenance and fences every batch. Move chunk-anchor repair/stamps and producer-owned aliases into the generation commit. Repair anchors only where still null, for the exact generation; merge owned metadata keys. Validate expected counts and membership, preserve foreign/manual aliases and refuse producer collisions. Alias failure rolls back the commit. Exact committed-identity retry may return its stored result only after current Fence validation, without duplicate aliases. Never clean staging after commit invocation: a lost response may mean success. Pre-invocation cleanup is fenced and limited to that producer's unpublished generation; lease loss leaves inert leftovers for U13.

Choose **no sibling supersession** in U03. Current queued siblings lack durable generation/policy equivalence, so removing the broad sibling-completion optimisation is safer than claiming they are satisfied. Live, unowned, pending and failed siblings retain their own lifecycle. Derive batch identity from the matched job, reject a conflicting supplied ID and lock batches before aggregate reads. Retry budgets come from the locked job. Terminal/enrichment failures preserve the prior committed pointer and evidence.

Strict completion updates only its gate evidence; it cannot erase independent extraction issues or force quality to good from non-zero counts. U10 retains threshold ownership. Remove worker fallback calls to generic metadata patch, sibling/batch updates and arbitrary repair. The generic `apply_document_metadata_patch` has an independent webhook caller: do not globally revoke that unrelated capability. Revoke the old `repair_strict_enrichment_gate_batch(integer)` mutation endpoint.

## Operator compatibility until U13

Three existing npm-callable scripts use the shared persistence exports without a durable attempt and can mutate before reaching them. Requiring Fence only at the final helper call would leave earlier writes. The selected temporary compatibility change is an explicit non-successful `ingestion_attempt_required` refusal before lazy operational imports/client setup:

- `index:backfill`: reject every `--write` request, with or without confirmation or metadata-only flags. Preserve its existing no-write inspection mode, whose hosted reads remain separately authorised.
- `enrich:documents`: reject all three valid modes (summaries-labels-images, deep-memory, metadata-stamp). This command has no supported read-only mode; do not invent one.
- `enrich:backfill`: reject default/mutating calls; preserve explicit `--dry-run`. Move local parsing ahead of its current lazy imports/health probe.

Implement `assertUnleasedOperatorModeAllowed` in the named pure helper with these three discriminated request shapes. It accepts no Fence, override, test flag or environment bypass. Export each real script's existing `main` with explicit argv input. Move environment loading and automatic main/catch/exit into a pure Node path/URL direct-invocation guard, so imports do not load environment files, create clients, log, run or exit. Keep provider modules lazy. Do not create a command framework.

Shared enrichment/deep-memory exports require a real Fence. Replace now-invalid unleased call expressions with the same explicit unavailable-operation outcome; no casts, fake claims, optional Fence or legacy RPC escape. Preserve unrelated historical/pure/read-only helpers; this is not dead-code cleanup. U13 owns the reviewed lease-acquiring reprocessing adapter required to re-enable these write modes. Document the temporary operational behavior in the runbooks and scripts index; no operator script runs in U03 acceptance.

The new compatibility suite imports the actual three entry functions with fail-on-use lazy module mocks. Assert no import side effects, early refusal for every write-mode variant before provider/client/write setup, explicit error and non-successful direct CLI handling, and mock-only read modes reaching only read surfaces. Keep equivalent U02 generation/source assertions in `check-indexing-contract`; changing call shape must not erase them. Explicitly include the archived entry as a compilation root even though the normal config excludes its directory.

## Storage and cancellation

Retain private buckets. Image paths contain document UUID, lease token, reserved generation and upload UUID, with `upsert:false`. Only a guarded prepare operation chooses them; model payloads do not choose paths. A late upload may still write bytes after cancellation, but its immutable path cannot overwrite committed evidence or attach to a reclaimed attempt. Do not claim an atomic Storage fence or zero stale physical writes.

Remove worker physical compensation after ambiguous attachment/commit errors or lease loss. Retain the exact unreferenced path and a structured non-sensitive recovery signal. SQL staging cleanup remains fenced. Physical orphan inventories, retention/disposal and serving lifecycle belong to U04/U05/U09/U12/U13; no garbage collector or bucket-policy redesign is introduced.

Use one monotonic cancellation state per attempt. Missing RPC, failed renewal or `lease_lost` stops subsequent provider/native/Storage calls and late result publication. Check before/after non-interruptible operations and each batch; propagate `AbortSignal` where supported. Catch blocks may not swallow cancellation and proceed to metadata/stage/failure writes. Replace the existing shadow test's swallowed-lease-error expectation with actual orchestration refusal; ordinary optional shadow failure may remain non-fatal without demoting sound evidence. Cancellation cannot retract already sent bytes; U07/U08 own full clearance and live egress proof.

## Exact schema prerequisite

The current `schema.sql` omits P05 objects present in tracked migrations. Reconcile the **effective direct dependency closure** inside U03's schema increment; do not regenerate unrelated drift or copy another worktree.

- `20260820121000_create_public_source_control_plane.sql`: effective `public_source_activation_events`, `public_source_versions`, indexes/FKs/checks, RLS, SELECT-only service-role grants and immutable-event/version triggers.
- `20260824120000_consolidate_public_source_lifecycle_authority.sql`: final `source_sequence` constraint/uniqueness, lifecycle including superseded, acquisition digest column/check and final `guard_public_source_version_identity`.
- `20260824123000_harden_public_source_lifecycle_authority.sql`: final `public_source_acquisition_identity_digest(uuid)` and exact service/internal grants.
- To preserve the shared policy-writer boundary, include effective `record_public_source_activation_event(jsonb)`, `make_public_source_version_ineligible(uuid,text)` plus UUID compatibility wrapper, `public_source_serving_authority` table/seed/RLS/grants, `bump_public_source_serving_authority()` and final six-argument `transition_public_source_version`, taking final definitions from consolidation/hardening. Do not restore the obsolete seven-argument overload.

Use final CREATE definitions, not historical numbering/quarantine/publication backfills or trigger-disable DML. The existing document, publication-approval, artifact/job/cache and extension objects remain dependencies. Reconcile directly required grants/triggers/types/index documentation together. Before closing this increment, a static effective-object comparison must show the selected objects' bodies/signatures/checks/grants agree with their final tracked migration owners and that their direct referenced schema objects exist. If that reveals a missing P05 transitive dependency, name and review the exact addition before changing it. Omitted unrelated activation/fetch/stage/tombstone/serving definitions remain explicit snapshot-parity debt; do not claim whole-schema parity. Actual replay remains unrun.

Recheck the exact tracked migration prefix and named file immediately before creation. At preparation HEAD the proposed U03 migration is absent; `20260831100000_retire_ingestion_worker.sql` exists and remains the predecessor.

## Dry-run repair contract

Keep original `IngestionRepairPlan` version, `dryRun:true`, 1–100 unique lowercase canonical document UUIDs, non-empty fixed reason sets and exactly one lowercase `sha256:` state digest per document. Reject unknown fields, duplicate IDs, duplicate reason codes, unsupported reasons and malformed digests; do not silently deduplicate input. Reasons remain `missing_committed_generation`, `generation_mismatch`, `summary_missing`, `summary_invalid`, `summary_fallback_growth`, `lease_abandoned`. Sort IDs and reason codes.

Hash UTF-8 bytes of `ingestion-repair-plan-v1\n`, then one line per sorted document: UUID, tab, comma-joined sorted reasons, tab, expected-state digest, newline. The fixed UUID/reason/digest vocabulary cannot inject separators. TypeScript and SQL use this encoding; do not assume JavaScript JSON serialisation equals `jsonb::text`.

Add `ingestion_repair_plan_audit` with audit ID/time, canonical plan/digest and outcome fixed to `planned`. `record_ingestion_repair_plan` validates the bounded payload/recomputes the digest, then appends only that row. RLS on; service SELECT only, RPC-only insert; no UPDATE/DELETE/TRUNCATE grants and rejection triggers covering those operations. This is database access immutability, not protection from the database owner. No apply endpoint or document/job/source mutation exists.

Expected-state identity includes exact source/version/event, generation, summary/projection/label state and both queue states/attempts. A planner input digest is not proof that the snapshot is still current. U13 re-reads and compares under locks before any later application; `planned` is never `repaired`.

## Serial implementation and acceptance

Pin one U03 `TASK_BASE` at the accepted freeze checkpoint. Extract original Task 3 and attach this version/hash, shared contracts, final allowed paths and authorised check recipes. Do not reset the base between increments:

1. P05 snapshot prerequisites, token/guard/claim primitives and shared parsing.
2. Node core/control and Edge stages/terminal ownership.
3. Atomic summary/deep-memory/alias/family persistence, Storage and cancellation call sites.
4. Repair planner/audit, types/docs and complete writer-coverage proof.

Each increment is a reviewable local candidate, not separate U03 acceptance. Actual-producer RED must show stale/missing identity can reach an existing mutation seam before correction, and planner RED separately proves the absent contract. Do not count a missing-module import as proof of every stale-write case. Refactor real orchestration into the named importable seams only as necessary; tests must not start worker/Edge servers. Final GREEN includes:

- New token per Node/Edge claim, including same worker; missing/malformed/cross-kind/expired identities refuse, heartbeat cannot revive expiry.
- Node/Edge mutual exclusion and G0-to-G1 reserved-generation handoff; stale G0 callers refuse.
- G1 pauses, G2 wins: every listed artifact/control/cache/summary/label/stage/deep-memory/alias/terminal path rejects G1 and preserves G2.
- Policy event/withdrawal before mutation, and policy change after client preflight, refuse. SQL schedules separately establish lock ordering and the opposite interleaving.
- Summary/labels/metadata rollback; U02 positive/negative projections, manual organisation/labels and provisional zero-label fallback retained.
- Deep-memory staged counts/ownership, exact-generation anchors/stamps, alias rollback and lost-response non-cleanup.
- Late upload cannot overwrite/attach to another attempt; ambiguous response does not delete potentially committed bytes.
- Cancellation escapes optional-shadow catch; stale stage finish cannot finish a new attempt; missing/false/malformed RPC never falls back to direct mutation.
- Terminal retry limits, strict quality preservation, batch identity/aggregation and unchanged siblings.
- Planner order invariance/bounds/invalid inputs and SQL append-only access; obsolete repair grants revoked.
- All three unleased operator entry points refuse before any effects; the two existing read-only modes remain read-only under mocks, and importing a command has no startup effects.
- An explicit all-writer source/SQL inventory has no unfenced remaining path, with effective schema signatures/grants and types aligned.

Use the final focused selector once after the relevant changes; smaller changed-file subsets may supply iteration feedback without re-running unchanged successes:

```text
node scripts/run-vitest.mjs run tests/ingestion-lease-fencing.test.ts tests/ingestion-repair-plan.test.ts tests/ingestion-operator-compatibility.test.ts tests/indexing-v3-agent.test.ts tests/worker-behavior.test.ts tests/worker-run-loop.test.ts tests/worker-runtime-control.test.ts tests/worker-row-contract.test.ts tests/check-indexing-contract.test.ts tests/document-enrichment.test.ts tests/deep-memory.test.ts tests/deep-memory-transaction-sql.test.ts tests/worker-visual-capture.test.ts tests/worker-shadow-extraction.test.ts tests/storage-upload-compensation.test.ts
```

Process-local `GATE_RECEIPTS=off` and `GATE_ARBITER=off` preserve restricted discovery; restore them in `finally`. Consult the arbiter for selected test/typecheck commands, retain its actual verdict and keep the coordinator intact. A busy lease is not bypassed. Test environment must remain scrubbed/provider-free. Review the actual final diff with `verification-router` before handoff; no full baseline, Answer eval or unrelated suite is added by default.

Required additional evidence:

- Compilation for changed TypeScript contracts and their callers, preserving the original compiler option/type-discovery semantics. The reviewed tracked-input equivalent must exclude `1/` in Git pathspec **before enumeration**, avoid unrelated untracked traversal and retain explicit Next ambient dependencies. The two generated declarations currently named by `next-env.d.ts` are absent; this is an environment/input issue to resolve through a reviewed local generation route before claiming compilation, not a passed or inherited exception. Native Edge compilation is separate.
- Both actual Edge roots (`indexing-v3-agent` and `site-content-sync`) through the accepted frozen native Deno environment, rebound to new source closure hashes. Retain the exact outside composite lock/import map; new dependencies invalidate affected resolution proof. No stubs, root omission, loosened lock or declaration suppression. This is the named native Edge equivalent, not the unrepaired literal npm wrapper.
- Scoped **staged migration-role equivalent** calling unchanged exported validator on exact indexed guarded roots, including immutable historical migration and the new U03 migration. Do not invoke the CLI's unrelated-untracked discovery path or call the equivalent the literal npm command.
- Focused format/diff and explicit-input module-index/schema-table coverage, script references and actual changed import/adoption edges. Update the exact scripts-index count for the new helper, then use `node scripts/update-docs-inventory.mjs --check`, whose discovery is restricted to tracked `scripts/` filenames and package scripts. No full generator that discovers untracked files. Preserve immutable raw evidence bytes outside formatting checks.
- Reuse accepted P04 classifier evidence only while its full classifier/input/config dependency set remains unchanged. Existing audit SHA-256 is `f7421f631f846fe6570f8c0614224c2f7c0b221797b5ea3f5f891c1a0f7d3c6b`, population `sha256:08bf1d12e8b431f3ec2e243fcc595b743acb222cb4bb7593fd766ce0834a5083`, with 3 documents, 1 targeted reprocess, 0 shadow, 0 blocked. If an affected dependency changes, run the pure fixture command once to a new outside output and compare exact population/actions; never `--live-read` or overwrite the historical artifact.

The acceptance manifest pins literal approved commands, wrapper/config/input hashes, product/base/head, exact outcomes, raw and committed-copy hashes, reviews, failed attempts and residuals. The planning review must inspect concrete outside recipes before execution; an unreviewed command sketch is not an executable gate. Normal locked public dependency restoration may be used within current authority; it provides no provider/hosted proof.

Freeze the complete product range with the canonical review-package writer. Fresh `ingestion-worker-reviewer`, `supabase-schema-guardian` and `clinical-governance-reviewer` review that same original base through all corrections. Preserve failed reviews; resolve Critical/Important findings, verify actual requested/observed routes and obtain Specification/Quality PASS before source acceptance. Evidence checkpoint is a separate scoped local commit and append-only `.superpowers/sdd/progress.md` update. No next unit starts on an unaccepted U03 product candidate.

Historical U02 offline evaluation remains **exit 1, four failed suites, 45 failed and 586 passed tests overall**. It is not green and supplies no U03 exception. C01 remains incomplete until its own gates; local source acceptance is not SQL, native, provider, production-readiness, clinical or ordinary Answer acceptance. `check:production-readiness` and connected acceptance remain at their governing C07 boundary; do not silently run or mark them passed here.
