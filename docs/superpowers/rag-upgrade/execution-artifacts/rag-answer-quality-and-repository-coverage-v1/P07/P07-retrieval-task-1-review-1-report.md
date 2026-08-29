# P07 Retrieval Task 1 Review 1

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

BLOCKER_STATUS: TASK 1 ACCEPTANCE BLOCKED

## Executive result

- Finding counts: P0 0, P1 1, P2 2, P3 0.
- The provider-free and server-boundary portions are directionally sound: the plan is bounded to four, retains the original query, uses fixed fallback codes/messages, excludes the new scope fields from client payloads, and adds no query/subquestion telemetry field.
- Acceptance is blocked because coverage can report clinically unsupported evidence as `direct`/`complete`, and query planning deterministically manufactures comparison sides or skips material clarification for concrete ambiguous inputs.

## Immutable identity and scope

- Global task key: `P07/retrieval/task-1`.
- Exact reviewed range: `c933f33f6f8d74299f4b19199018ec98b8166223..e8dc922f7fe5cabf2f3c0a4a703acde99e9dc8ed`.
- Reviewed HEAD: `e8dc922f7fe5cabf2f3c0a4a703acde99e9dc8ed`, matching the current worktree HEAD.
- Canonical package: `P07-retrieval-task-1-review-1.diff`; SHA-256 `2F99A9A32ACCA7D11DEA9E224BE1BE1D6199231958FD3F89DE00AE5D8CC6ECFC`.
- Brief SHA-256: `C7756C3AF061C93A7211F6F5E22396EC0692DA98F92B6B5F46E525539FA3E945`.
- Implementer report SHA-256: `AB7A073848E4024D6946C62EAD7366B8126E73C6FB0B74802A4BBAD816CB953B`.
- Reviewed the nine-file canonical diff against Task 1 of the retrieval-composition plan, the answer/Australian-sources design, the immutable brief, and the implementer report. This is a controller-owned governed task-artifact review, not a branch/PR/readiness review.

## Findings and remedies

### P1 - Coverage ignores the canonical evidence gate verdict and can promote rejected evidence to direct/complete

Evidence: `src/lib/rag/rag-coverage.ts:88-117`. For each subquestion, the implementation intersects selected, cited, eligible, present, and scope-valid IDs, then calls `evaluateEvidenceCoverageGate`. However, `gate.accepted` is never consumed. Status is computed solely from `directEvidence.length` and the caller's optional `support` label. Consequently, a selected/eligible/cited but clinically irrelevant chunk for a clozapine threshold question receives the gate reason `missing_clozapine_blood_action_structured_threshold` while still being labelled `direct`; a one-subquestion plan then becomes `overall: "complete"` with no insufficiency reason. The same path also defaults an omitted eligibility set to all selected IDs.

Trigger/failure path: a later Task 2/4 caller supplies a scoped selected chunk that survived ID/citation bookkeeping but fails the existing threshold, dose, document-title, comparison-diversity, or image-support gate. `evaluateAnswerCoverage` records the rejection reason yet advertises direct coverage. Adaptive composition can therefore treat unsupported clinical content as complete evidence.

Expected: direct coverage must require a canonical positive direct-support decision in addition to selected, eligible, cited, present, and scope-valid membership. For query classes owned by `evaluateEvidenceCoverageGate`, a rejected gate cannot yield `direct`/`complete`; for non-applicable classes, an explicit typed selection/source-role support decision must own the result rather than membership alone. Missing eligibility proof must fail closed or be represented by a distinct already-eligible input contract that cannot be confused with unchecked selection.

Smallest proof/fix: wire a typed direct-support verdict into status derivation (using the existing gate where applicable), then add a regression with a high-scoring, known-scope, selected+eligible+cited clozapine chunk lacking ANC/withhold/structured-threshold evidence and require non-direct/non-complete coverage. Also pin the omitted-eligibility behavior.

### P2 - Comparison parsing invents two comparison sides from two attributes of one subject

Evidence: `src/lib/rag/rag-query-plan.ts:88-102,152-166`. When fewer than two medicines are identified, the fallback regex treats any `compare X and Y` fragments as two entities. The provider-free executable probe for `Compare the benefits and risks of clozapine` produced comparison sides `the benefits` and `risks of clozapine`, even though the query compares two attributes of one medicine rather than two identifiable subjects.

Trigger/failure path: common prompts such as “compare the benefits and risks of X” or “compare efficacy and safety of X” are decomposed into fabricated sides, consuming two required subquestions and later retrieval/coverage budget. This violates the explicit contract that primary plus two comparison sides are created only when both sides are identifiable.

Expected: comparison-side decomposition requires two bounded entities/concepts, not merely two syntactic phrases around `and`.

Smallest proof/fix: constrain fallback extraction with existing canonical terms/entity signals or a deterministic two-entity grammar; otherwise retain a single primary plan. Add the exact benefits-versus-risks regression plus a genuine non-medicine pair.

### P2 - Material ambiguity detection is a single hard-coded phrase family, not the required retrieval-changing contract

Evidence: `src/lib/rag/rag-query-plan.ts:68-85,119-149`. `detectClinicalAmbiguity` can return non-null only for an unqualified “required observation/monitoring/review/follow-up period” regex. It cannot identify material ambiguity in the other declared dimensions (document, decision, or most population/setting/medicine/jurisdiction cases). The executable probe for `Which form is required?` returned `kind: "single"`, targeted the forms domain, and stated a deterministic document interpretation despite having no document, jurisdiction, setting, population, or decision anchor.

Trigger/failure path: an underspecified form/procedure/medicine question whose competing jurisdiction or workflow interpretations select different records proceeds directly into retrieval instead of asking the one targeted clarification required by the design.

Expected: deterministic ambiguity detection must cover the declared dimensions whenever missing anchors materially change retrieval, while ordinary uncertainty still proceeds with a stated interpretation.

Smallest proof/fix: derive bounded ambiguity predicates from the existing analysis plus the query's requested object/decision, rather than special-casing one period phrase. Add at least one material document/jurisdiction or decision example and one similar but ordinary-uncertainty negative example.

## Mandatory-focus adjudication

- Deterministic/provider-free and maximum four: PASS for the implemented builders; no provider call or randomness was added, broad plans are ordered and sliced to four.
- Original retention: PASS; `originalQuery` and the primary subquestion retain the supplied query.
- Comparison identification: FAIL due to the fabricated-side finding above.
- Material ambiguity: FAIL due to the single hard-coded ambiguity family above.
- Selected + eligible + directly cited coverage: FAIL because membership is checked but canonical direct-support rejection is ignored and omitted eligibility defaults open.
- Canonical corpus fail-closed behavior: PASS for absent/unknown scope and `registry_record` incorrectly labelled `uploaded_local`; recognized domains are bounded. No client payload includes `corpus_scope` or `site_content_domain`.
- Typed/sanitized fallback mapping: PASS. Typed code, insufficiency, then provider failure take precedence; legacy text maps only to bounded codes; unknown text maps to `unknown`; public output is fixed text rather than raw input.
- Server-only payload exclusion: PASS, protected by the exhaustive field policy and focused boundary test.
- Telemetry/query privacy: PASS for this diff. No telemetry builder was changed and no query/subquestion text field was added. The request-local fields remain server-side contracts.
- Compatibility: PASS for the reviewed type additions and client trim; the new `SearchResult` fields are optional and the exhaustive payload policy was updated.

## Checks and evidence

Checks run during this review:

- Exact HEAD/base/status, changed-file inventory, canonical diff, plan/spec/brief/report, and relevant existing owner inspection.
- `npm run ledger:lookup -- e8dc922f7fe5cabf2f3c0a4a703acde99e9dc8ed --scope "P07 retrieval task 1 canonical review"`: `NOT REVIEWED at this HEAD and scope`.
- SHA-256 verification for the package, brief, and implementer report: values recorded above.
- Provider-free executable query-plan probe via local `tsx`: reproduced both `the benefits` / `risks of clozapine` fabricated comparison sides and the unclarified `Which form is required?` single plan.
- A direct ad-hoc coverage import was attempted but was blocked before execution by the repository's `server-only` guard through `env.ts`; no result from that attempt is claimed. The P1 is established directly from the status branch and the ignored `gate.accepted` return at the cited lines.

Reused, not rerun, implementer evidence:

- Literal Task 1 selector: 3 files, 15 passed.
- Client-boundary selector: 1 file, 10 passed.
- Typecheck, scoped ESLint/Prettier, and range diff check: PASS as recorded.

No full suite, build, browser, provider-backed RAG evaluation, OpenAI, Supabase/database/Storage, document/corpus, migration, reindex, hosted CI, deployment, commit, push, or PR action occurred. No ledger record was appended because the controller explicitly constrained this review's sole write to this untracked/unstaged report.

## Acceptance boundary

Task 1 must not advance to integration until all three findings are corrected and independently re-reviewed. The recorded focused green/typecheck evidence proves the implemented code compiles and satisfies its current tests; it does not cover these missing negative contracts.
