# P07 phase review 1

## Findings

### 1. P2 - incidental medicines are still promoted to comparison sides

Task 1 permits a comparison plan only when the two things actually being compared are identifiable. `comparisonSides` instead returns the first two medicines from `analysis.medications` before checking the query's comparison grammar (`src/lib/rag/rag-query-plan.ts:121-137`). This closes the reviewed one-medicine example, but not the same attribute-comparison shape when a second medicine is contextual rather than a comparison side.

A provider-free executable probe against the exact phase head produced the following result for `Compare the benefits and risks of clozapine when co-prescribed with lithium.`: `comparisonIntent: true`, medicines `clozapine` and `lithium`, and a decomposed plan whose two comparison subquestions are clozapine and lithium. `Compare efficacy and safety of clozapine in a patient taking lithium.` produced the same false decomposition. Both questions compare attributes of clozapine in a co-prescribing context; they do not ask for clozapine-versus-lithium evidence.

**Trigger:** a benefits/risks, efficacy/safety, advantages/disadvantages, or similar attribute comparison mentions another medicine as co-therapy, interaction context, or patient history.

**Risk:** the false side consumes two required subquestions and most of the four-variant candidate budget. Later P08 retrieval and coverage can then search and require support for the wrong comparison, creating false partial/absent coverage or an unsafe comparison-shaped answer. The accepted Task 1 regression covers only the single-medicine form (`tests/rag-query-plan.test.ts:44-50`), so it remains green.

**Required remedy:** identify comparison sides from the explicit comparator relation, not from any two medicines present in the analysis. Reject attribute-only comparisons even when another medicine appears contextually, while retaining genuine `clozapine versus lithium` and non-medicine setting comparisons. Add direct negative regressions for the two reproduced inputs plus a positive explicit medicine-versus-medicine case.

### 2. P2 - material clarification plans retain a closed site-domain filter

Task 2 explicitly requires ambiguous queries to keep the site-domain filter open so potentially relevant records are not hidden (`docs/superpowers/rag-upgrade/local/plans/2026-08-20-rag-retrieval-composition.md:293-306`). `buildRagQueryPlan` computes explicit/inferred domains before adjudicating material ambiguity and returns them unchanged on the `clarification_required` branch (`src/lib/rag/rag-query-plan.ts:158-184`). Consequently, the accepted material-ambiguity fixture `Which form is required?` correctly has no subquestions but still returns `targetSiteDomains: ["forms"]` and `siteDomainDecision: "explicit"`.

**Trigger:** a retrieval-changing ambiguity contains a domain word such as form, document, service, medication, or tool.

**Risk:** the plan simultaneously says the workflow/jurisdiction/decision is unresolved and preselects one content family. When P08 consumes these hints, relevant service, policy, tool, or clinical-guidance records can be excluded before the user supplies the clarification. The Task 2 ambiguity test uses only `What should be considered next?`, which has no domain signal and therefore cannot catch the closed-filter branch (`tests/clinical-search.test.ts:63-69`).

**Required remedy:** return `targetSiteDomains: []` and `siteDomainDecision: "none"` whenever `kind` is `clarification_required`, or prove a narrower domain is invariant across every competing interpretation and encode that as an explicit typed exception. Add the exact `Which form is required?` regression and at least one similarly ambiguous domain-bearing negative case.

## Verdicts and severity counts

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

- P0: 0
- P1: 0
- P2: 2
- P3: 0

P07 remains offline/shadow and served legacy behavior is unchanged, so neither finding is a current served-result regression. Both are phase blockers because these accepted contracts become retrieval and coverage inputs in P08.

## Task-review closure and combined-range assessment

### Task 1

- The Review 1 P1 coverage finding is genuinely closed. `SubquestionEvidenceInput` requires explicit eligible IDs and direct/partial support, runtime omission fails closed, canonical gate rejection empties supported evidence, absent/unknown corpus scope is rejected, and conflicts are retained only across directly cited supported IDs (`src/lib/rag/rag-coverage.ts:28-37,49-65,80-157`). The direct negative regressions cover gate rejection and omitted eligibility (`tests/rag-coverage.test.ts:127-178`).
- The Review 1 material form-ambiguity trigger is closed as to clarification: the unanchored form now yields one material clarification and no subquestions, while the WA/clozapine-anchored form proceeds (`src/lib/rag/rag-query-plan.ts:69-106`; `tests/rag-query-plan.test.ts:94-114`). Finding 2 is new cross-task evidence about the accompanying domain filter.
- The Review 1 fabricated benefits/risks sides are closed only for one medicine. Finding 1 proves the same semantic defect remains when a contextual second medicine is present, so comparison-side acceptance is not phase-closed.
- Fallback codes/messages are total, typed-first, bounded, and do not copy legacy/provider text (`src/lib/rag/rag-fallback-reason.ts:3-120`). `corpus_scope` and `site_content_domain` remain server-only in the exhaustive client policy (`src/lib/answer-client-payload.ts:19-56`). No raw query/subquestion field was added to a telemetry owner.

### Task 2

- Review 1's orchestration-proof gap is genuinely closed. The corrected test uses a decomposed query with divergent candidate/served variants, query-sensitive RPC results, a candidate-only poison result, an exact legacy query sequence, identical returned IDs/order, and a provider sentinel (`tests/rag-variant-early-exit.test.ts:159-197`). The local-array tautology was removed.
- Runtime constructs one plan after the finalized classifier/fallback analysis and query-mode override, derives mode from the immutable request snapshot, and serves only `servedVariants` (`src/lib/rag/rag.ts:1596-1629,1651-1678`). Candidate planning is pure, four-bounded, synchronously abort-checked, and contributes only allow-listed diagnostics (`src/lib/rag/rag-retrieval-variants.ts:316-389`). It does not call retrieval or write candidate material to either cache.
- Search cache identity includes the query-plan version behind `rag-cache-v21`, variant text is privacy-hashed before storage, and snapshot rollout identity separates legacy/shadow namespaces (`src/lib/rag/rag-cache.ts:38,335-379,408-486,701-735,903-918`). No candidate-only query or raw subquestion becomes a persisted key or telemetry field.
- Adversarial refusal remains before context, client, cache, classifier, or Supabase work. Ordinary unsupported routing remains before embedding/vector retrieval; the new query-plan computation adds no provider/retrieval fanout. Shadow abort is pinned by the focused regression (`tests/rag-routing.test.ts:53-66`).
- `src/lib/rag/rag.ts` is 4,358 lines against the 4,362-line ceiling. The range contains no corpus lane/RPC, migration, source-priority/ranking, Task 3 retrieval activation, route/env flag activation, provider retry, UI, ingestion, reindex, or live-system change.

## Receipt, package, and agent coherence

- Phase identity is exact: base `c933f33f6f8d74299f4b19199018ec98b8166223`, head `0499ee71363f43d1528028f059fdc4936d61e145`, with the linear four-commit chain `e8dc922f` -> `f936f555` -> `0430adf7` -> `0499ee71` and the recorded Task 1/Task 2 bases and heads adjoining without a gap.
- The canonical 19-file phase package reverse-applies cleanly at the exact head. SHA-256: `19761857DF3671D21EC2DF66A576A88AB09DF0B7F462DF4F259523F3E259B52E`.
- Every receipt-recorded brief, implementer report, task review package, and task review report SHA-256 matched the file on disk exactly. In receipt order, the material final identities are: Task 1 brief `C7756C3A...3E945`, implementer report `0BD3EDD1...A42B4`, accepted review package `E095D045...0343`, accepted review report `36F40D43...36C8`; Task 2 brief `3F14E8DB...1F13`, implementer report `D8770B54...1B7A`, accepted review package `798B7425...0966`, and accepted review report `6DF035A5...FB0A`.
- Agent independence is coherent. Task 1 implementer `/root/p07_query_contract_impl` is distinct from reviewer `/root/p07_task1_review1c`; Task 2 implementer `/root/p07_shadow_query_impl` is distinct from reviewer `/root/p07_task2_review1`; this phase reviewer is distinct from both task implementers and reviewers. Reusing the same task reviewer for that task's correction re-review is disclosed, and Task 2's controller-only mechanical handoff after implementer usage exhaustion is disclosed without being presented as independent review.
- The draft receipt correctly has no phase review or acceptance record yet. Its `status: "draft"`, null completion/acceptance fields, local package identity, manifest model/effort routing, offline-shadow authority, task evidence, and no provider/live residual claim are internally coherent.

## Checks and evidence

- Read the P07 local manifest entry, complete local retrieval plan Tasks 1-2 and applicable global constraints, local approved design, draft P07 receipt, both briefs, both implementer reports, all four task-review reports, the canonical combined diff, and every changed production/test owner.
- `npm run ledger:lookup -- 0499ee71363f43d1528028f059fdc4936d61e145 --scope "P07 full phase review attempt 1"` - `NOT REVIEWED at this HEAD and scope`. No ledger append was made because this task authorizes only the untracked phase report as a write.
- `Get-FileHash -Algorithm SHA256` - the canonical package and all receipt-recorded task artifact identities matched.
- `git apply --check --reverse P07-phase-review-1.diff` - PASS at the exact phase head.
- `git log --reverse <base>..<head>` - confirmed the exact linear four-commit chain and task boundaries.
- One narrow provider-free `tsx` probe reproduced both findings and emitted only synthetic query-plan objects. No product test, broad gate, provider, database, Storage, document/corpus, or live operation ran.
- Reused exact-head evidence without rerun: Task 1 correction selector 2 files/18 tests, contract selector 3 files/15 tests, client-boundary selector 1 file/10 tests, and fresh typecheck across 11,003 inputs; Task 2 literal selector 4 files/247 tests, cache/orchestration selector 2 files/16 tests, correction selector 1 file/4 tests, routing selector 1 file/88 tests, fresh typecheck across 11,035 inputs, maintainability at 4,358/4,362, scoped lint/format, and range diff checks.

## Safety boundary and acceptance blocker

This review used only local repository source, tests, plans/manifests, synthetic strings, immutable packages, receipts, and prior reports. It made no network/provider/OpenAI call, Supabase/database/Storage read or write, document/corpus read or processing action, migration, embedding, retrieval evaluation, reindex, activation, deployment, commit, push, or PR action. No product, test, plan, manifest, receipt, brief, implementer report, or accepted task-review artifact was edited.

Both P2 findings require correction plus an independent fresh re-review before P07 acceptance or P08 dispatch. This report is the only write made by this review and must remain untracked and unstaged.
