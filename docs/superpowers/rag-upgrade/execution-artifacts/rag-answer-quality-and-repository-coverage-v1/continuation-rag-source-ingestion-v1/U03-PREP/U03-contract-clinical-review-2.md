# U03 contract clinical and governance review 2

Date: 8 September 2026.

Specification PASS.

Quality PASS.

No concrete Critical or Important clinical/governance defect remains in the corrected full original documentation range. These are independent specialist documentation verdicts, not product, execution-recipe, SQL, clinical or whole-programme acceptance.

## Complete original range and retained review

- Worktree `R = C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Outside evidence directory `O = C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`.
- Branch `codex/rag-local-build-20260822`.
- Original base remains `fd043b262ebd9b20315c2e46bc4838265787fa80`.
- Corrected head `73b5b0f39671073eb135ddfd8e8ab25e2afba9ca`.
- Reviewed complete original range: `fd043b262ebd9b20315c2e46bc4838265787fa80..73b5b0f39671073eb135ddfd8e8ab25e2afba9ca`.
- Canonical full-range package: `R/docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U03-PREP/U03-contract-review-2.diff`.
- Independently observed package SHA-256: `11936f3c54c5863ba578b7afc062b939b9806f8828573bc651ad0403326d6843`.

Retained unchanged review: `O/U03-contract-clinical-review-1.md`, SHA-256 `942ee182f266edc1cfc97e160a0e5b96f2779e70918d616414eefd514f18743c`. I verified that report's bytes remain unchanged. It supplies my full five-document and bounded-source review through `481270d8b4267d479bc78d58815b365439f8a2ec`; this report incorporates it except where the explicitly corrected P05 prerequisite supersedes the earlier preparation wording. This is a new verdict over the complete original range, not an acceptance of only the correction commit.

The same five documentation owners remain the entire original-range diff: continuation plan, continuation design, RAG evidence handoff, shared-contract-freeze-v1.md and U03-execution-contract.md. Read-only Git comparison confirmed the sole delta after review 1 is two insertions/one deletion in U03-execution-contract.md. Its complete 205-line content matches its additions in the canonical full-range package. The other four reviewed documents and product source are unchanged. HEAD matched the corrected head and tracked status was empty with `--untracked-files=no`.

The applicable review protocol, execution authority and canonical SDD context from review 1 are retained. `npm run ledger:lookup -- codex/rag-local-build-20260822 --scope U03-contract-clinical-review-2` returned `NOT REVIEWED at this HEAD and scope`. The controller owns the completed ledger append and integration.

## Correction assessment

No blocking findings; no further clinical/governance correction requested.

The changed requirements are in `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md:145,147`:

1. The selected schema dependency set now explicitly includes final `guard_document_publication_transition()` and its `documents_require_publication_approval` trigger binding. This is justified by the current source: `supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:431-446` binds publication to approval/source policy/generation and reviewed state; :447-461 permits Australian-public lifecycle exit only with the exact bound version/document/staging-owner identity and otherwise protects immutable reviewed public state. The snapshot's existing trigger is attached at `supabase/schema.sql:8353-8356`, but its older function lacks those final lifecycle semantics.
2. The three required approval columns and `document_publication_approvals_v2_evidence_complete` are correctly tied to `supabase/migrations/20260822123000_govern_australian_source_activation.sql:5-18`. That constraint preserves an all-null historical tuple or a complete v2 tuple; the final publication guard requires the exact matching v2 values for the named transition. Adding these prerequisites does not invent clinical approval or grant source authority to generated content.
3. The chosen lifecycle writer really sets and clears the exact exit binding: `supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql:301,335,348`. Requiring effective DML-trigger dependencies in the static comparison therefore closes a real integration requirement; object-name presence alone would not establish equivalent behavior.
4. The correction expressly supersedes only the fixed preparation contribution's named omission. It excludes obsolete bulk-publication functions, data backfills and trigger-disable operations, preserves unrelated parity debt, and leaves any further transitive addition subject to explicit review. Its positive exact-exit and negative missing-binding comparison remains under separate SQL authority and explicitly unrun.

The correction preserves the previously reviewed clinical contracts: exact recoverable evidence and qualifiers; independent structural/semantic verdicts; R1 restriction and permitted supplementation; R3 snapshot-bound safe partitioning; R4 accountable implementation ownership with clinical adjudication still unassigned; U02 projection/manual-metadata protection; stale-writer refusal; conservative quality and lost-response handling; private Storage and provider boundaries; and early explicit refusal for unleased operator write modes. None is weakened or newly activated by these three changed lines.

The clinical governance preflight disposition in review 1 remains valid for this documentation-only range. No patient-identifiable workflow, clinical output, provider egress, access expansion, Supabase target change or deployment behavior was introduced. Publication approval remains source-policy authority, not a fabricated semantic or clinical reviewer verdict.

## Residual gates and independence

- U03 remains unstarted and C01 incomplete. This PASS does not implement or run the added schema reconciliation. Actual RED/GREEN, full writer coverage, effective schema/type/grant/trigger comparison and fresh product specialist reviews remain required in U03's original product range.
- Disposable SQL must later compare valid exact lifecycle exit and missing-binding refusal against migration-chain and snapshot environments, in addition to the retained lock/reclaim/rollback/role schedules. No source inspection or mocked response closes that runtime proof.
- The separate execution reviewer owns outside wrapper/recipe corrections. I did not read the moving recipe files or consume another specialist's verdict as proof. Controller integration still requires the applicable independent reviews and a bound final recipe manifest.
- Native extraction, Storage/provider behavior, hosted roles, production-readiness, clinical adjudication and separate RAG consumer acceptance remain unrun or unresolved at their appropriate gates. No activation, kernel enablement, repair, publication or operational permission follows from this report.
- Historical U02 `eval:rag:offline` remains **exit 1, four failed suites, 45 failed and 586 passed tests overall**. It is neither green nor an inherited exception for U03 or later completion.

## Requested and observed own route

Requested route: retained independent `gpt-6-astra` / `xhigh` clinical-governance reviewer for `/root/u03_contract_clinical_review`.

Observed through only selected `session_meta`/`turn_context` fields in my exact own log, read with shared access:

`C:/Users/joshs/.codex/sessions/2026/09/08/rollout-2026-09-08T20-51-03-01a08112-6bd7-7b23-951a-277da5c47a16.jsonl`

- Line 1, `2026-09-08T12:51:03.881Z`: session `01a08112-6bd7-7b23-951a-277da5c47a16`; parent `01a07b47-4623-7e90-825a-ec25116b8531`; agent path `/root/u03_contract_clinical_review`; role `clinical-governance-reviewer`; provider `openai`.
- Latest review-turn context at line 179, `2026-09-08T13:18:21.578Z`: `model = gpt-6-astra`, `effort = xhigh`; collaboration settings independently record the same model and reasoning effort.

This is observed local resolved configuration, not backend attestation or inference from requested routing.

Only read-only Git/document/source/hash inspection, the read-only ledger lookup and selected own-log metadata inspection were used. No tests, product gates, SQL, providers, workers, native processing, other-task messages or recursive agents were run. No repository file was written; protected or unrelated untracked content was not enumerated or read. This report is the only new write, and report 1 is preserved.
