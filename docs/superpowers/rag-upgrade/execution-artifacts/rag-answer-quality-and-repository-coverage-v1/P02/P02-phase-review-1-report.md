# P02 phase review 1

## Findings

### Important — the catalogue-to-authority handoff rejects a canonical indexed source and does not implement compatible identity semantics

`australian-health-disability-ageing` is the canonical policy key for the active Department of Health and Aged Care source (`data/australian-source-verification.v1.json:87`), while the existing single-owned authority identity for publisher code `AUSDOH` is correctly keyed `australian-department-of-health` (`src/lib/source-authority-registry.ts:267`). `authorityIdentityForCatalogueEntry` nevertheless requires the authority key to equal the catalogue policy key (`src/lib/source-authority-registry.ts:424-430`). This makes the identity resolver return `null` for a required indexed catalogue entry even though the unique publisher code resolves to the intended existing authority.

That mismatch propagates across the phase:

- Task 2 normalization calls the rejecting resolver before retaining catalogue/policy/licence fields (`src/lib/source-metadata.ts:133-153`), so a fully governed Department document loses `source_catalogue_key`, `source_policy_version`, `content_mode`, and `licence_policy` and is then ineligible.
- The policy audit separately requires `classification.authorityKey === entry.key` (`src/lib/source-authority-metadata.ts:350-361`), so it omits the same Department source instead of auditing it.
- Compatibility is also narrower than the authority registry: normalization requires literal non-national catalogue jurisdiction before consulting registry aliases (`src/lib/source-metadata.ts:141-153`), and Task 3 later requires literal catalogue publisher and jurisdiction strings (`src/lib/source-role-policy.ts:60-68`). A correctly coded WA Health source using registered publisher/jurisdiction aliases is therefore rejected despite the Task 2 contract requiring a compatible publisher code/jurisdiction.

Reproduction on immutable HEAD:

```text
catalogueKey: australian-health-disability-ageing
publisherCode: AUSDOH
registryKey: australian-department-of-health
catalogueIdentity: null
normalizedCatalogueKey: null
normalizedPolicyVersion: null
eligibility: { eligible: false, reason: "catalogue_mismatch" }
```

A second probe using `source_catalogue_key=wa-health`, `publisher_code=WAHEALTH`, registered publisher alias `WA Department of Health`, and registered jurisdiction alias `WA` produced the same null policy fields and `catalogue_mismatch` decision.

Expected: a catalogue policy key should resolve through the unique existing publisher-code identity plus its compatible publisher/jurisdiction/lifecycle definitions. The policy key need not duplicate or rename the authority identity key. All Task 2/3 consumers should use that one compatibility result.

Risk: the planned national Department source and valid authority aliases cannot enter normalized Australian evidence, audit output, role eligibility, or retrieval composition. This defeats a material P02 catalogue entry while tests only prove that a publisher code resolves to some truthy registry key (`tests/australian-source-catalogue.test.ts:72-75`).

Smallest credible correction: make the unique publisher-code authority the identity owner without requiring policy-key equality, expose one compatible catalogue/document identity predicate from the registry boundary, and use it in normalization, audit, and role policy. Add a full indexed-catalogue resolution matrix covering the `AUSDOH` key difference and registered publisher/jurisdiction aliases.

### Important — superseded Australian documents pass promotion and every database activation gate

Task 3 explicitly makes `change_state = 'superseded'` or a non-empty `superseded_by_document_id` inactive (`src/lib/source-role-policy.ts:87-94`). Task 4 does not carry that state meaning into activation:

- the promotion preflight rejects only the literal `withdrawn` state (`scripts/promote-public-documents-batch.ts:85-90`);
- the approval insert trigger rejects only `withdrawn` (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:68-70`);
- the owner-release transition guard rejects only `withdrawn` (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:205-210`); and
- the atomic activation RPC again rejects only `withdrawn` (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:404-407`).

A local dry-run probe supplied an otherwise valid v2 NHMRC document with `document_status = 'current'`, `change_state = 'superseded'`, and a non-empty `superseded_by_document_id`. `runPublicationPromotion` accepted it and printed the normal apply command. The static SQL checks show the same document can pass approval and both activation boundaries. Existing positive fixtures use the unsupported value `change_state: "active"` (`tests/publication-manifest.test.ts:353-360,451-458`), so they do not exercise the declared Task 2 change-state vocabulary or this cross-task invariant.

Expected: a document that Task 3 classifies inactive must not be approvable or activatable. At minimum, promotion, approval insertion, transition, and RPC should all reject `superseded` and any non-empty replacement pointer in addition to `withdrawn`, with one shared state meaning represented in tests.

Risk: a superseded document can be made immutable public Australian evidence even though it is excluded from claim evidence immediately before activation. This violates the phase contract for active/current/non-withdrawn publication state and lets retrieval and activation disagree on the same governed metadata.

Smallest credible correction: add consistent supersession checks to the script and all three SQL boundaries and replace the current `active` fixtures with valid `unchanged`/`changed` cases plus negative `superseded` and replacement-pointer tests.

## Range and package currentness

- Immutable base: `b7da14fe6abaf1ff93b97b55303ed1b135c60a14`.
- Immutable head and current checkout HEAD: `db78a7c90d97a681b1f806fda1b12e4ce00ea616`.
- The complete range contains 11 commits, from `924a6c63b250d45c550df2b907276c14144d924c` through `db78a7c90d97a681b1f806fda1b12e4ce00ea616`.
- I independently reconstructed the package with the repository's `reviewPackageBytes` Git presentation (`--no-renames --full-index --binary -U10` and canonical header/commit list). It is exactly equal to `P02-phase-review-1.diff`; this is not a stale or correction-only package.
- `npm run ledger:lookup -- codex/rag-local-build-20260822 --scope "P02 Australian source policy and activation contracts tasks 1-4"` reported `NOT REVIEWED at this HEAD and scope`. No ledger record was written because this review was authorized to write only this report.

## Phase-wide review disposition

Apart from the two Important defects above, the range implements the intended P02 Tasks 1-4 boundaries:

- The catalogue and verification manifest use policy `australian-source-policy-v1`, exclude Healthdirect, retain NPS as historical/non-indexable, and keep eTG/AMH exact no-content link-only sources. Registry-corpus admission blocks declared unknown, historical, link-only, and non-indexable catalogue entries before embeddings or provider access.
- Task 2 normalization preserves bounded diagnostics without rejected raw values, validates HTTPS/date/timestamp/hash fields, is browser compatible, protects the exact link-only policy pair, and keeps tooling audit output aggregate/read-only.
- Task 3 requires an exhaustive claim role on both production model-context paths, maps ambiguous query classes conservatively, applies eligibility before ranking, preserves relevance bands, implements local-primary/Australian-fallback/no-evidence decisions, and deterministically unions verified conflict evidence.
- Manifest v2 is strict and tied to the Task 1 catalogue/policy version; v1 cannot activate Australian rows. Canonical UUID duplicate handling, canonical state/generation bindings, exact reviewed target state, generated-column-safe BEFORE-trigger handling, append-only approval evidence, RLS/service-role grants, row/child locks, active-job checks, state-digest recomputation, owner checks, and post-public immutability are present. Checked-in types reflect the unapplied migration contract.
- The earlier task-review failures are closed in the final range: Task 1 catalogue admission/publisher-code uniqueness; Task 2 bounded diagnostics, protected-source policy, timestamp/output/audit contracts; Task 3 mandatory roles, unknown extraction, primary decision, deterministic conflicts and complete evidence unions; Task 4 OLD/NEW publication bypasses, canonical UUID duplicates, dispatcher integration, generated-column handling, and post-public evidence immutability.
- No task/process artifact is present in the 11 product commits. No Task 5/6 reference-link or rendering feature work is in range. `src/lib/rag/rag.ts` is unchanged and remains exactly 4,362 lines under the maintainability gate.
- Legacy rows missing `corpus_scope`/`source_role` remain intentionally fail-closed pending the separately reviewed trusted-ingestion/reconciliation phase. Because P02 is a policy/contract phase and is not deployed independently, that sequencing state is not reported as a P02 defect.

## Local/offline verification

- Focused phase suite: `node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts tests/check-indexing-contract.test.ts tests/registry-corpus.test.ts tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/source-metadata-browser-safety.test.ts tests/therapy-source-governance.test.ts tests/answer-copy-payload.test.ts tests/source-role-policy.test.ts tests/australian-source-priority.test.ts tests/source-governance.test.ts tests/rag-context-budget.test.ts tests/rag-score.test.ts tests/publication-manifest.test.ts tests/supabase-schema.test.ts` — PASS, 15 files / 267 tests. The first request was not admitted because the focused-test capacity was occupied by `performance-remediation`; the retry was admitted and passed. The contention result was not treated as a product failure.
- `npm run arbiter -- typecheck` — RUN; DB scope never defers and CI classifies this change as heavy.
- `npm run typecheck` — PASS, fresh receipt over 4,573 inputs.
- `npm run check:maintainability-budgets` — PASS; `src/lib/rag/rag.ts` 4,362/4,362.
- `npm run check:migration-role` — PASS; active hosted SQL/tooling uses `postgres`, immutable applied history unchanged.
- `npm run check:owner-scope` — PASS; 42 API files clean against 25 owner-scoped tables.
- `git diff --check b7da14fe6abaf1ff93b97b55303ed1b135c60a14..db78a7c90d97a681b1f806fda1b12e4ce00ea616` — PASS, no output.
- Two read-only `npx tsx -e` contract probes reproduced the catalogue identity defect. A third local dry-run probe reproduced superseded-document admission without writes.

Green focused/static checks do not override the reproduced missing cases; neither Important defect has a regression test in the admitted suite.

## Residual evidence boundaries

- Connected verification of current official source URLs, source currency, and exact document-level licence remains **UNRUN** by programme design.
- Executable PostgreSQL migration replay remains **UNRUN**. The migration was inspected statically and was not applied locally or remotely.
- No network, hosted provider, live source, Supabase project, database, migration-application, deployment, publication, or production action was performed.

SPEC_VERDICT: FAIL
QUALITY_VERDICT: FAIL
