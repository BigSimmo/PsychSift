# U03 independent clinical-governance product review 3

Specification: **PASS**. Quality: **PASS** within the clinical-governance specialty and the evidence limits below. No new Critical or Important clinical implementation finding. CG01 and CG02 remain closed. The candidate-2 wrapper assertion limitation is now closed by my inspection of the exact committed assertion changes and their bound focused test evidence.

This is a corrected-head rebind of my independent full-original-range review, not a fresh audit of unchanged files and not programme, deployment, provider, or clinical acceptance. The controller owns overall acceptance. Another specialist's verdict is not the basis for this verdict.

## Scope, identity, and review method

- Worktree: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Original TASK_BASE: `8c11f138e6c683a13db3b465332e7f3cbb515c62`.
- Current independently observed HEAD: `bbd978a5708ed70c51e293aab079ead9c5bcb1ce`.
- Previous candidate: `57ba6d6fc2505f03a1ee0df82b186bccd0a455c2`; failed candidate `b651ee23d8541fbebea77ca1c621fcdec42540ad` remains retained.
- Complete original range remains 41 product files across the three commits, with 6,544 additions and 2,624 deletions. The current delta from candidate 2 contains exactly two assertion replacements in two test files. The other 39 files are byte-identical.
- `git status --short --untracked-files=no` was empty. No unrelated untracked enumeration, repository edit, test/gate, arbiter, compiler, SQL, provider, operator, server, migration, publication, or delegation was performed for this rebind. Only this new outside report was written.

My full-range `U03-product-clinical-review-2.md`, SHA-256 `146541229e8720c0f2dabcfe5daf5d1162fc914d8710a4d141b4f6a417103bfe`, is incorporated for its unchanged independent source analysis, governing-contract assessment, exact source references, clinical preflight, prior-finding dispositions, and evidence qualifications. Its review of the integrated original range remains applicable because all production, SQL, Edge, planner, access-control, and documentation inputs are unchanged. Its candidate-2 assertion limitation is superseded only by the bounded assessment below.

Applicable AGENTS/review/clinical instructions and the U03 execution contract, shared-contract freeze, execution authority, and canonical SDD continuation rules were already read during that review. Their no-provider and frozen-review boundaries continue to apply. The controller owns ledger append; this report does not claim a new ledger entry.

## Independently checked current binding

I rehashed all 41 current raw files, all 41 committed Git blobs, and all 41 freeze entries, including their byte counts: no mismatch. I checked all 22 named inventory artifacts and all 12 selected test-input hashes: no mismatch. The canonical and outside full-range diff copies have identical hashes.

| Artifact | Observed SHA-256 |
| --- | --- |
| `U03-candidate-binding-3.json` | `4759824eb7d37b93eefd232df7d659116fc631fa01b66a4e17db46514306e4bb` |
| `U03-implementation-freeze-7.json` | `df84e179232a4c0408b742bbac2822c206679f9d70e364d32a82780894d930c2` |
| `U03-controller-verification-inventory-3.json` | `147e4f3b06d5008db7d5838aabea0d45b3459f57085f84cb47499ba208967061` |
| `U03-product-review-3.diff`, both copies | `a7713f3c523a1c55c9c8cabca3c93e58209d798f01ce95a239227ad23f19d244` |
| `U03-test-proof-round-2-report.md` | `ee9fe0607201f9a1f70a44be86dc345daa41438f000b82536edf96622bbe3a6f` |
| `U03-test-proof-round-2-inputs.json` | `94b0118f656f0238b6a1a36f53d44b57b893be73ea8d4770f55c3dedb78159f0` |
| `U03-test-proof-round-2-result.json` | `58ab6b98cd7ab5c34d741ed8e78fc2ad780160ed433516ba7728cf14d6ad054f` |
| `U03-test-proof-round-2-verification-route.md` | `b6225bec0404ae97b74739c46f15a59a18bc912b225564c4b4f38a33121c099e` |

Freeze 7 and the before-run input manifest record candidate 2 as their capture HEAD because the two test edits were not committed at capture. Their actual file hashes match the corresponding candidate-3 committed blobs. This is an explicit content rebind, not a claim that the run occurred after the candidate-3 commit. Binding/inventory `accepted:false` and pending controller acceptance are preserved.

## Correction and finding dispositions

**Wrapper identity proof — closed for this review.** At `tests/model-index-extraction.test.ts:137`, the actual generation options' `.signal` is now checked with `.toBe(controller.signal)`. At `tests/openai-cache.test.ts:815`, the actual SDK request options' `.signal` is checked the same way. The previous object-subset assertions could accept another AbortSignal with no distinguishing enumerable properties. The committed replacements require the exact object; mocks, production forwarding, positive controls, and other assertions are unchanged. Thus a different or absent forwarded signal fails these assertions. This is test-proof repair; no production defect reproduction or mutation experiment is claimed.

The inspected raw result for `node scripts/run-vitest.mjs run tests/openai-cache.test.ts tests/model-index-extraction.test.ts` records exit 0, 29 passed, 0 failed, 0 skipped, 2 files. The named inputs include the actual `vitest.config.mts`; all 12 match current content. Focused format/check and arbiter evidence record exit 0; receipt reuse and arbiter enforcement were off, and the coordinator was retained. These are reused writer results, not checks I reran. The bounded route is adequate for this assertion-only delta; no new compilation claim is needed. `U03-product-wrapper-review-2.md` was hash-checked at `7d17dc960c7379a6e5697b31ef2a69fb866f58a125069e93e6913aa10c84cdf7`; its verdict does not substitute for the direct assertion and evidence inspection above.

**CG01 — remains closed.** The unchanged shared persistence adapter classifies returned and rejected persistence failures as typed fatal ingestion failures; adopted summary/deep-memory enrichment cancels and rethrows them. The actual worker's typed-failure path prevents subsequent success, metadata, quality, or terminal mutations. Deep-memory cleanup remains limited to precommit local failures; cleanup uncertainty is fatal, and no postcommit compensation can delete committed evidence. References and behavioral evidence remain those in review 2, including `_shared/ingestion-attempt.ts:22`, `document-enrichment.ts:873`, `deep-memory.ts:614`, and `worker/behavior.ts:188`.

**CG02 — remains closed.** The unchanged actual Edge producer uses the accepted U02 normalizer and checks the returned persisted projection and marker before completion. Under the existing lock, SQL refuses fallback over any current structured row with `ingestion_summary_requires_structured_repair`; it does not return successful preservation based only on kind/generation. A valid normalized stored structured result remains a positive control, while an agreed zero-label fallback remains provisional. Invalid structured rows can remain physically present pending separately governed repair; this path cannot turn them into completed accepted evidence. No SQL normalizer or new repair authority was introduced. Review 2 retains the exact migration/schema, Edge, and test references.

## Integrated clinical assessment and limits retained

The original integrated source assessment remains PASS: current source/version/event authority and lease/generation checks precede mutation; serialized dispatch protects the G0-to-G1 transition and heartbeat interleaving; fixed artifact membership, server-derived ownership, manual metadata/label protection, and committed evidence preservation remain conservative. The selected P05 schema/ACL prerequisites restrict the intended tables/helpers without turning shadow or approval state into publication or clinical clearance. The planner stays dry-run and auditable; unleased mutation entrypoints refuse before effects. The kernel remains default off. U02 normalization, privacy/query-privacy, clinical answer verification, model/prompt/budget/cache behavior, and clinical source authority have not changed in this correction.

Source-backed clinical claims still require linked source verification before use. No new patient-identifiable workflow, private-document client access, service-role exposure, demo-to-real promotion, or governance-based retrieval weighting was introduced. The configured Supabase target remains Clinical KB Database (`sjrfecxgysukkwxsowpy`) by source inspection only. Pending legal execution in the existing cross-border basis is not treated as disclosure permission. This review is neither clinical validation nor a TGA/SaMD determination.

The earlier 176/6 behavioral GREEN 3 result retains its whitespace-only test-format qualification. The 6 passed/25 skipped Storage-shadow evidence remains selective mocked evidence. The scoped compiler's 0 diagnostics/0 I/O violations and two-root native Edge compilation remain results at their original input identities, not fresh candidate-3 runs. The Edge runtime import's `@ts-ignore` exists in the native source too: neither compiler independently proves diagnostics on that annotated line. Review 2's inspection of actual exported runtime symbols/types supplies the relevant source evidence; no stub, remap, or root omission is claimed. Role-manifest PASS over 522 inputs remains static evidence.

Module-index remains **FAIL, exit 1** with the unchanged `.superpowers` root gap and nine `site_content` table-documentation gaps, explicitly dispositioned as an unchanged baseline in the retained final-route addendum. It is not green and not inherited U02 success. P04's 21-input fixture closure remains historical/reused, not a live corpus or provider result. Historical U02 exit 1 (four failed suites, 45 failed, 586 passed) is not inherited as passing. C01 and programme acceptance remain incomplete.

No live SQL replay, lock/concurrency/role-inheritance/rollback/trigger execution, whole-schema application, physical Storage, native extraction, protected egress clearance, licensing acceptance, real-provider behavior, named clinical review, or C07 acceptance is established. Source/static/mocked assurance must not be promoted to those runtime or clinical claims.

## Observed reviewer route

Own session ID: `01a0840a-2fb1-7532-971c-ba0e3d0f90c7`.

Own exact log: `C:/Users/joshs/.codex/sessions/2026/09/09/rollout-2026-09-09T10-40-55-01a0840a-2fb1-7532-971c-ba0e3d0f90c7.jsonl`.

Selected `session_meta` at `2026-09-09T02:40:55.626Z` records that ID, parent `01a07b47-4623-7e90-825a-ec25116b8531`, agent path `/root/u03_product_clinical_review_2`, and model provider `openai`. The selected current `turn_context` at `2026-09-09T03:08:46.25Z` records model `gpt-6-astra`, effort `xhigh`. Only my own selected session/turn fields were used. These fields are observed local configuration evidence, not backend execution attestation; neither the planned route nor the writer's route stands in for them.