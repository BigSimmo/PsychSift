# Independent ingestion planning execution review 1

Specification: **PASS for the adopted planning scope.**

Quality: **PASS for the adopted planning scope.**

No high-confidence P0-P2 planning defect was found in this review surface. This is not acceptance of U02 corrective product code, U03, C06, native extraction, SQL concurrency, providers, clinical semantics, or ordinary Answer. The first-packet Edge verification route is an unresolved execution prerequisite described below; neither verdict calls that gate passed.

## Identity and frozen review range

- Worktree: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Branch: `codex/rag-local-build-20260822`.
- Original base: `2dad59e0ee26ab6586f6a49ec1dfdb993d1f9ad7`.
- Reviewed head: `4cf61dfe065b7c41eb53bc9f890d1fd16dfbad70`.
- Canonical package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/ADOPT/ADOPT-review-1.diff`.
- Package SHA-256: `100cad3992a5c56b8097572eb40c364268fbd59a72ba484b0cb1c6f079ad4085`.
- The package identifies one candidate commit and the complete original range above. Review covered the unique changed source documents and their integration with retained task bodies; the controller's recorded 12-file generated mirror parity was reused, not independently rerun.
- Local Git inspection confirmed the requested root/branch/head and no tracked staged or unstaged changes. Untracked paths were deliberately not enumerated. The controller supplied a candidate ledger lookup of NOT REVIEWED and owns the completed ledger append.

Requested reviewer route: independent Astra/xhigh, ingestion-worker-reviewer. Observed own exact session record:

- Session: `01a07b83-409b-7ab1-97aa-0585d48ea177`.
- Parent: `01a07b47-4623-7e90-825a-ec25116b8531`.
- Agent path: `/root/plan_execution_review`; nickname Newton; role `ingestion-worker-reviewer`; depth 1.
- `session_meta.model_provider`: `openai`.
- `turn_context.model`: `gpt-6-astra`; `turn_context.effort`: `xhigh`.
- Exact log: `C:/Users/joshs/.codex/sessions/2026/09/07/rollout-2026-09-07T18-56-35-01a07b83-409b-7ab1-97aa-0585d48ea177.jsonl`.

Only selected session_meta/turn_context fields from that exact child file were read through shared FileStream access. These establish locally resolved configuration, not backend execution attestation. The turn-context launch cwd is D:/Repos/Database; all repository review commands explicitly targeted the assigned ingestion worktree.

## Execution prerequisites and handoff notes

These are existing gates or bounded execution details, not newly discovered product defects.

1. **U02 Edge verification needs an offline route before its verification preflight can close.** The correction brief's final selector names `npm run check:edge:functions`. `scripts/check-edge-functions.mjs:6-11` discovers and sorts the immediate `supabase/functions/*/index.ts` roots; line 19 invokes Deno with `check --node-modules-dir=false`. The wrapper has no argument passthrough. Installed `deno check --help` describes downloading and type checking; it does not make a cold dependency graph offline. The controller reports that installed Deno 2.9.4 rejects `--cached-only`; this review's installed full help likewise does not expose that option. Do not prescribe it. `--deny-import`/`--no-remote` appearing in help alone is insufficient proof that a proposed replacement retains complete cached type checking while forbidding every dependency-acquisition path. Use a separately verified equivalent covering the same roots and config/lock semantics, or retain the Edge gate as blocked. Do not claim the literal npm wrapper passed. This affects the immediate packet's execution/check acceptance, not the F02 correction's ownership or test design. The current authority already requires compatibility preflight before dispatch; this planning verdict does not waive it.

2. **The real-producer RED must check the underlying validation cause.** `src/lib/document-enrichment.ts:675-700` constructs the model response profile and projection; lines 724-760 pass it through the validator; lines 762-767 wrap its failure as `source_anchored_summary_generation_failed` with the original Error as `cause`. A mocked provider-shaped response through `upsertDocumentEnrichment` can exercise that actual path without provider access. The brief's expected `source_anchored_summary_profile_overview_invalid` is the inner product cause, not necessarily the top-level rejection message. Preserve that distinction in the authored RED assertion. Eight projected items must respect the existing per-category limits (six for ordinary categories); distribute valid items across categories instead of relaxing bounds. This needs no product-scope expansion.

3. **Broader work still needs the scheduled shared-contract freeze.** Continuation plan lines 81-89 and R1-R5's final decision paragraph require frozen evidence/support/coordinate/resolver and all-writer/egress/generation contracts before widening U03. That freeze must produce the actual writer/producer inventory, exact allowed paths, serialized examples and literal affected selectors. The original U03/U09 file lists are not automatic permission to omit newly identified owning seams or to change unrelated ones. R1 mode semantics, R3 safe partition semantics and R4's named governance owner remain the specifically recorded decisions. They do not block the bounded formatting correction.

4. **Protected-untracked safety is not a blanket certificate for every later check.** The reviewed GATE_RECEIPTS=off/GATE_ARBITER=off bridges return before receipt/arbiter scans while preserving the actual Vitest wrapper, coordinator and offline environment. SKIP_DOCS_SYNC_HOOK=1 exits pre-commit before its scan; the required scoped manual checks remain. U03's exported migration-role validator bridge still needs its concrete guarded tracked-input/new-migration allowlist reviewed before use. C06's eventual bare `verify:pr-local -- --dry-run` would reach `scripts/ci-change-scope.mjs:555-556`, which asks Git for all untracked paths; use the existing explicit file selector from an owned committed range and assess its selected commands before that later gate. The U02/U03 preflight is not proof that the entire C06 chain is safe to run unchanged. No broad check is requested now.

## Contract assessment

**Authority, order and preserved history.** The dated authority, amendment, plan lines 15-31/75-91 and canonical SDD continuation overlay agree on serial local implementation and scoped candidate/correction/evidence commits after review. Candidate commits do not accept a unit. P00-P07, C00 and accepted U01/U02 artifacts are outside the changed scope; P08A remains superseded. The U02 historical evaluation remains exit 1, four failed suites, 45 failed and 586 passed overall. The correction deliberately omits unrelated Answer suites without renewing the old exception; later required failing evaluation blocks its relevant acceptance.

**All-writer, generation and egress coverage.** Plan lines 406, 499, 642, 933, 1174 and 1607 connect F01/F06/F08/F09/F16 to attempt identity, current source/policy authority, every summary/label/metadata/fallback/repair writer, the full staged artifact set, current pre-egress checks, retention and reuse. Same worker ID is not a fresh attempt. Missing-RPC fallback cannot remove fencing. Original evidence survives optional summary failure. SQL interleavings and provider parity are explicitly separate evidence, not inferred from caller mocks. Detailed implementation inventory remains the mandatory freeze output.

**U05/U10 have one switch.** Task 5's private pointer-only transition core and separate deletion core (lines 714-724) remain the publication mechanism. Task 10's finalizer reconstructs server-owned evidence under the current lease, appends its exact receipt and either calls that core or writes a review task in the same transaction (lines 1299-1313). Shadow mode remains staged, and later promotion must consume successful receipts. U10 strengthens the existing publication wrapper; it does not introduce a second independently granted pointer path. The earlier U05 implementation may bind the frozen future verdict interface without claiming U10 is already accepted or activating documents early.

**U12 partial results and tests.** The new partial discriminant (lines 1460-1477) and implementation rule (line 1569) preserve whole-request refusal for unknown/mismatched snapshots. Retained candidates must be nonempty, independently eligible and free of affected claim/qualification/authority dependencies; otherwise refusal remains. The pre-existing material-conflict refusal tests apply to the affected group, while R3/H3/H4/H6 add safe-independent-part and typed-limitation cases through actual suppliers. The later frozen resolver schema must bind original text, relationships and limitations, rather than treating the current candidate metadata example as complete evidence resolution. That work is expressly scheduled before its owner dispatch; no existing product consumer is being changed by this documentation diff. Ordinary Answer imports and legacy cache access remain prohibited.

**Fidelity and ownership.** E1-E7 nominate independent expected atoms, relationships and tail evidence for the actual supported producers. Positive preservation and safe negative refusal have separate denominators; withholding all positives cannot pass. P05/P06 authority and original/derivative family identity remain owned, and RAG alone owns request composition, every displayed claim, public DTO projection, follow-up and complete display/copy. Named clinical adjudication and source retention decisions are not supplied by this engineering review.

**Review floors and checkpoints.** Canonical SDD lines 7-29 and smart allocation lines 3-37 retain High implementation, sensitive Astra floors, independent xhigh amendment/final review, all required specialties, fresh unit implementers, suitable same-writer corrections, bounded review waves and one writer. Correction attempt limits stop redispatch, not acceptance scrutiny. Every final task/tranche/programme verdict covers its whole corrected original range; prior failed attempts and TASK_BASE persist. Manual continuation evidence is explicitly distinct from parent P-phase checker compatibility; no U/C `--resume` or `--accept-phase` acceptance is fabricated. Shared proof has a designated gate owner.

## Verification and limits

Read-only source/diff review and local Git identity checks were performed. `deno check --help` and `deno check --help=full` were help-only inspection; no type check ran. The supplied execution-preflight.md and planning-doc-checks.json were consumed as controller evidence: 16 source docs, 12 byte-equal mirrors, 124 new links, script references resolved, diff check passed, product unchanged; generator exit 1 on two unchanged historical migration collisions. Those checks were not rerun or relabelled fresh.

No repository edits, staging, commits, tests, installs, provider calls, SQL execution, worker runs, protected/unrelated untracked enumeration, child agents or other-task messages occurred. Only this report was authored outside the repository. Controller communication remained inside the assigned agent tree. Clinical/source semantic adjudication has its independent reviewer; this report does not replace that verdict or the controller's final adoption/checkpoint record.
