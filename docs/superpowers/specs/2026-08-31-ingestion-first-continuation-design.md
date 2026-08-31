# Ingestion-First Continuation Design

**Date:** 2026-08-31  
**Status:** Approved by user on 2026-08-31  
**Parent programme:** `rag-answer-quality-and-repository-coverage-v1`  
**Immutable parent anchor:** accepted P07 receipt commit `03aa32d731d1cb9009be55213580e9ea3994017c`  
**Proposed continuation:** `rag-source-ingestion-continuation-v1`

## 1. Decision

Continue with an ingestion-first programme rather than completing every remaining RAG, answer-composition, presentation, delivery, evaluation, and connected-acceptance phase in the parent programme.

The continuation preserves all accepted P00-P07 evidence byte-for-byte, implements the smallest late retrieval kernel that the ingestion runtime genuinely requires, completes the source-only ingestion system, and records every deferred or connected gate explicitly. It does not process documents, apply migrations, access hosted data, call providers, deploy, activate a generation, run a live reindex, or claim production acceptance.

## 2. Why a new continuation is required

The parent package and accepted receipts bind the exact programme identity, package hash, predecessor chain, task order, artifacts, and atomic metadata commits. Editing the parent manifest in place would invalidate accepted evidence.

The current parent plan also contains two forms of avoidable work:

1. scheduling-only predecessors that do not provide ingestion runtime interfaces; and
2. tasks that re-prove or recreate accepted audit, recovery, snapshot, and receipt contracts rather than consuming them.

Therefore the continuation is a versioned plan and evidence overlay anchored to accepted P07. It imports accepted P00-P07 receipts by hash and ancestry, but never modifies them. It reuses the existing task-brief, report, immutable review-package, ledger and repository verification machinery; it does not build a second generalized continuation, hydration or review-readiness engine unless a concrete repeated failure later proves that tooling would repay its implementation cost.

The overlay explicitly replaces the parent programme's deferred predecessor and phase-receipt contract for the retained work. It cannot claim the original P14, P15 or P16 phases accepted; it can claim only the continuation's C01-C06 offline acceptance at exact reviewed heads. This is a governance boundary, not a relaxation of product requirements.

The paused unaccepted P08A draft contains no product change or test evidence. The continuation supersedes that draft. Its migration reservation `20260830215420_add_corpus_scoped_retrieval_v3.sql` could be carried forward only if a fresh implementation-time preflight proved it still sorted after every prerequisite migration. The approved implementation plan instead allocates the new ordered `20260831106000_add_source_ingestion_retrieval_kernel.sql` reservation, so the conditional P08A reuse option is closed and must not be reopened during execution.

## 3. Objectives

The continuation must deliver:

- one surviving ingestion processor;
- committed-generation-only reads across every enrichment and retrieval consumer;
- source-anchored, generation-addressed summaries and reconstruction;
- claim-token lease fencing, heartbeats, bounded retries, repair plans, and audit history;
- exact-generation shadow reindex planning, evaluation, activation, rollback, retention, and delayed-cleanup contracts;
- administrator/backend-only trusted admission through one durable contract;
- fail-closed malware, active-content, identifier, licence/source-policy, and provider-egress gates;
- reproducible OCR/layout evidence and deterministic extraction promotion by document class;
- automatic, digest-bound technical activation or durable review routing;
- a persistent, cursor-paginated administrator technical queue;
- one public clinical-answer candidate population with staging/private/withdrawn exclusion;
- exact document, generation, page, span, index-unit, original-hash, and policy lineage;
- immediate withdrawal invalidation before asynchronous cleanup;
- selective, dry-run-first, reversible reprocessing and incident/restore procedures; and
- exact offline ingestion-to-answer, queue-scale, privacy, migration, rollback, and governance evidence.

## 4. Non-goals and deferred work

The following parent work is deferred, not deleted:

- the full P08A parent phase: only its minimum public-retrieval kernel is folded into C04 after technical activation exists;
- P08B Tasks 5-6 and P08C Tasks 7-8;
- P09 Task 3;
- Evaluation Task 4's general HMAC canary, component-rollout, health and rollback owner;
- Retrieval Task 4's broad subquestion-coverage allocation, supplementary ordering and local-primary ranking;
- P10 Task 6, except for ingestion-specific evidence invariants retained at final acceptance;
- P11 Tasks 5-6;
- P12 Tasks 1-6;
- P13 Tasks 1-6, while preserving the existing buffered answer path;
- P17 Tasks 5-6, except for same-SHA, case-set, population, and zero-hard-violation acceptance invariants; and
- all P18 connected operations.

Verified incremental delivery, adaptive presentation, feedback analytics, broad paired comparison, link-presentation refinements, and production acceptance are not prerequisites for a correct source-only ingestion system.

## 5. Required late retrieval contract

No separate pre-ingestion retrieval phase is required. P14 and P15 land first, then P16 establishes trusted admission and digest-bound technical activation. P16C Task 6 implements the public retrieval seam once against that final generation and activation authority.

The retained kernel is deliberately smaller than full Evaluation Task 4 plus Retrieval Tasks 3-4, but it preserves every ingestion-facing safety invariant:

1. service-role-only, fixed-search-path, public-only corpus-scoped v3 retrieval;
2. exact active uploaded generation and active site release/change-epoch binding;
3. pending, private, staging, non-canonical, review-due, superseded and withdrawn exclusion;
4. identical anonymous, ordinary-user and administrator public candidate IDs;
5. complete document, generation, chunk/index-unit, page/span, original-hash and policy/release lineage;
6. bounded fail-closed conflict or insufficient-evidence output rather than silent conflict selection;
7. a candidate namespace bound to the kernel version and immutable request snapshot, with no legacy-cache reads or writes; and
8. synchronous eligibility/cache invalidation on activation or withdrawal.

Default-off is structural: the ordinary buffered `rag.ts` serving path remains unchanged and cannot reach v3. The continuation may prove technical retrieval and lineage through direct source-only contracts, but it does not claim that newly activated sources are available in ordinary end-user Answers. General canary rollout, broad coverage allocation, Australian/international fallback ordering and conflict-caveat presentation remain a later serving tranche.

## 6. Continuation phases

| Phase | Purpose                                   | Retained work                                                                                                                                                              | Authority                                 |
| ----- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| C00   | Anchor and execution controls             | Import P00-P07 receipt hashes; retained/deferred registry; exact base, ownership, migration-order and task-ledger preflight                                                | Local metadata only                       |
| C01   | Processor integrity                       | Ingestion Tasks 4-6: retire duplicate processor, shared generation visibility, anchored summaries, lease fencing and bounded repair                                        | Offline source-only; migrations unapplied |
| C02   | Reindex lifecycle                         | Ingestion Tasks 7-9: exact-generation shadow driver, non-destructive activation/rollback, cleanup eligibility and operator runbook                                         | Offline dry-run only                      |
| C03   | Trusted admission and activation          | Trusted Tasks 0-4; Task 0 is an entry gate, followed by admission, safety/egress, extraction evidence and digest-bound technical activation                                | Offline source-only; no live documents    |
| C04   | Durable queue and public retrieval kernel | Trusted Tasks 5-6: persistent administrator queue plus the minimum late public-retrieval, lineage, conflict-blocking and withdrawal seam                                   | Offline source-only; no live documents    |
| C05   | Lifecycle and offline closure             | Trusted Tasks 7-8: selective reprocessing, recovery/incident controls, scale fixtures and the phase exit/acceptance gate                                                   | Offline evidence only                     |
| C06   | Whole-continuation acceptance             | Full-range ingestion, schema, retrieval, clinical-governance and privacy review; one selected broad offline handoff gate                                                   | Offline evidence only                     |
| C07   | Connected residual ledger                 | Record migration apply, deployment, synthetic upload, reindex, activation, rollback drill, cleanup, provider canary, backup/restore and production observation as unclosed | Separately authorized; not executed       |

Authority seams remain separate: the default-off retrieval kernel, source-only ingestion, dry-run reindex, trusted ingestion, and connected operations are never merged into one acceptance claim.

## 7. Reuse and delta rules

Existing behavior is reusable only when a fresh continuation task package cites the exact immutable base, implementation, focused committed test, and accepted ancestor receipt where applicable.

High-value reuse includes:

- accepted P04/P05 ingestion audit and recovery-readiness contracts;
- committed-generation filters already used by RAG context and cache reconstruction;
- per-job failure isolation in the current worker loop;
- Node enrichment coverage, source identifiers, structured provenance, and validated persistence;
- existing worker-ID checks as a base for claim-token fencing;
- existing document-generation activation/rollback types and retained-generation binding;
- atomic administrator upload and ingestion-job creation;
- upload structure validation and source-policy rejection;
- bounded Docling shadow extraction;
- publication row-locking and artifact-owner checks;
- immutable RAG request snapshot and cache-key authority; and
- the site-content outbox lease, fencing, retained-pointer and rollback pattern, reused as a pattern rather than as shared ownership tables.

Two other worktrees are reference implementations, not acceptance evidence:

- `0f9a52f22^..03d68b3a1` contains a corrected governed-retrieval implementation and tests. The branches diverged before P07 and its SQL targets a different site-authority model, so it is never cherry-picked wholesale. The continuation patch-ports only the minimum public-scope, isolation, lineage and test patterns, rewrites SQL against the target authority, allocates a current migration timestamp, and regenerates schema/types/drift locally.
- the dirty `rag-ingestion-design-20260821` worktree contains useful bounded admission shapes, privacy-preserving event fields and tests. It is never committed, modified or copied wholesale. The port must repair RPC replay/idempotency, prevent arbitrary service-role callers from self-asserting backend authority, and bind activation to exact technical-eligibility and generation receipts.

The continuation does not recreate these primitives. It implements only the missing delta and adds regression proof around reused behavior.

Verified no-op closure is allowed only when all task criteria are already satisfied at the immutable base, fresh task-specific commands pass, an independent reviewer verifies exact source evidence, no source/test/schema change is required, and the task is not closing a prior failed product finding.

## 8. Runtime flow

The target flow is:

1. An administrator or configured backend submits a bounded, validated upload.
2. One durable admission event binds actor, source policy, digest, storage identity and intended corpus.
3. Local safety gates quarantine first and fail closed before provider egress, extraction, embedding or activation.
4. The sole processor claims a job with worker identity plus a claim-specific lease token.
5. Extraction persists generation-addressed page/layout/OCR evidence and stable retrieval units.
6. Enrichment produces source-anchored summaries without first-N truncation or destructive replacement.
7. Technical eligibility evaluates exact security, source, currentness, extraction, lineage, embedding, generation and state-digest evidence.
8. Eligible generations activate atomically; ineligible or uncertain generations create durable administrator technical tasks.
9. The source-only retrieval kernel resolves one immutable request snapshot and admits only active shared uploaded, active public site, and eligible Australian candidates; ordinary Answer serving remains unchanged and cannot call this kernel.
10. Withdrawal removes retrieval eligibility and invalidates affected snapshots synchronously; cleanup proceeds asynchronously and cannot restore eligibility.
11. Reprocessing and reindex operations remain dry-run-first and emit exact manifests and receipts. Execution requires separate authorization.

## 9. Failure, privacy and recovery behavior

- Unknown or incomplete admission, safety, source-policy, generation, release, lease, lineage or activation state fails closed.
- Stale workers cannot mutate a job after a newer claim.
- A failure in one claimed job does not abort unrelated jobs.
- Replacement summaries are committed before prior valid summaries are removed.
- No ordinary user upload or owner-private Answer overlay is introduced.
- No document text, excerpts, owner identity, rollout salt or cohort input enters telemetry.
- Link-only or excluded content is rejected before acquisition and rechecked before storage, extraction, embedding, indexing and activation.
- Rollback retains exact prior-generation identity; cleanup is delayed and manifest-bound.
- Backup/PITR/Storage restore readiness is represented as evidence, never inferred from configuration presence.

## 10. Efficiency mechanisms

The continuation adopts the following without weakening product review:

1. Existing task-brief, report, immutable review-package, ledger, receipt and gate machinery is reused; no generalized workflow tool is built speculatively.
2. Retrieval and admission reference work is semantically patch-ported at the final corrected behavior, never cherry-picked or treated as proof.
3. Admission and technical activation land before the public retrieval kernel, so active-generation eligibility is implemented once rather than temporarily denied and reopened in a later phase.
4. Related migrations are grouped by coherent authority boundary. Schema, generated types and drift are regenerated and reviewed once per stable migration tranche, not copied from another base or repeatedly churned after every substep.
5. Read-only specification pre-reading, next-task owner mapping and review-package preparation run in parallel with the sole writer.
6. Reviewer findings are returned as one correction packet per task, followed by one full-range re-review.
7. Accepted P05/P06 findings and the corrected retrieval/admission reference ranges become first-pass brief checklists so known fail-open, reader/search, cache and lifecycle defects are prevented before review.
8. Task-level independent reviews remain mandatory. Cross-task integration is reviewed after the core-ingestion tranche and after the trusted-ingestion tranche, then once across the final whole range; metadata-only boundaries do not trigger duplicate product reviews.
9. Focused RED/GREEN selectors run during iteration. Static migration/grant/schema checks run at the owning tranche, documentation synchronizes once after behavior is stable, and one selected broad offline gate runs at handoff. Equivalent gates are not stacked.
10. Extra-high reasoning is reserved for architecture, SQL/RLS/access control, lease/rollback and final clinical-governance review. Concrete implementation and mechanical evidence work use high or the least capable safe tier to reduce turn cost without weakening decisions.

## 11. Review and verification

The retained behavior work comprises 13 independently reviewed change units: Ingestion Tasks 4-9 and Trusted Tasks 1-7. Trusted Task 0 is the entry gate and Trusted Task 8 is the final acceptance gate. Every product task retains:

- a fresh implementer;
- fresh RED and GREEN evidence for changed behavior;
- an immutable `TASK_BASE..TASK_HEAD` package;
- independent specification and quality verdicts;
- correction and full-range re-review for Critical or Important findings; and
- integration review at the two coherent tranche boundaries and a final whole-range review.

Specialist review routing is based on the actual diff:

- ingestion worker/retry/queue changes: ingestion worker reviewer;
- migrations, functions, grants, RLS and owner scope: Supabase schema guardian;
- public retrieval, ranking, selection and cache behavior: RAG retrieval reviewer;
- source rendering, access, answer lineage and clinical output: clinical governance reviewer; and
- final gate selection: verification router.

Verification remains offline and proportionate:

- focused unit/contract selectors during TDD;
- static migration, grant, owner-scope and schema/type checks for database changes;
- focused worker, retry, lease, reconstruction and reindex tests for ingestion changes;
- focused public-parity, private-row exclusion, cache-isolation and lineage tests for the default-off kernel;
- focused browser proof only if the administrator quality-queue UI changes, using `npm run ensure` and the verified project URL;
- one final `verify:pr-local` selection for whole-continuation handoff when the product range is stable; and
- production-readiness, provider, hosted Supabase and connected checks remain approval-gated.

## 12. Completion states

`SOURCE_COMPLETE` means all C00-C06 continuation evidence records and reviews pass at exact committed heads, all required offline gates pass, migrations remain unapplied, no documents were processed, and C07 lists every unresolved connected proof.

`PRODUCTION_ACCEPTED` is not available from this continuation alone. It requires separately authorized C07 operations and evidence.

## 13. Time and savings target

The current-code delta audit found substantial reuse but also confirmed missing processor retirement, claim-token fencing, shadow reindex driver and persistence, trusted ingress/egress gates, persistent quality queue, public retrieval scope and lineage, withdrawal propagation, and scale fixtures.

The revised target is **38-52 active Codex elapsed hours**, with a **58-hour contingency ceiling**, excluding connected-operation observation windows. The target includes implementation, task and integration review/correction loops, offline verification and evidence closeout. The approximately 14-22-hour reduction comes from eliminating unused rollout/coverage machinery, integrating retrieval only after activation exists, reusing corrected reference implementations, avoiding speculative process tooling and removing duplicate review/generation passes.

About **34 active hours is the credible hard floor** for the full recommended source-complete scope. Going below that would likely require weakening migration reconciliation, lease fencing, rollback/withdrawal, lineage, access parity or independent review evidence rather than merely removing unused work.

An optional API/CLI-first quality queue could save approximately 5-8 additional hours by deferring the complete administrator dashboard journey and browser proof. That preserves ingestion and privacy correctness but has a real administrator-usability impact and is not selected by this design; the recommended path retains the full durable queue UI.

Expected savings versus the full remaining parent programme are approximately 40-60%, produced mainly by removing unrelated answer/presentation/evaluation phases, consuming accepted primitives, preventing avoidable review loops, and automating mechanical evidence work.

## 14. Accepted design boundary

The user approved this design on 2026-08-31 with the following boundary:

- the priority is a source-complete ingestion system rather than completion of every parent RAG programme phase;
- buffered answer behavior remains the supported serving path during this continuation;
- source completion means governed admission through technically validated retrieval, not ordinary end-user Answer availability;
- the minimum late public-retrieval kernel is retained while general canary and broad coverage/ranking work is deferred;
- P00-P07 remain immutable;
- no live or document-processing work occurs without a later explicit request;
- source completion and production acceptance remain distinct; and
- the revised 38-52-hour target is preferable to the full 110-150-hour parent programme estimate.
