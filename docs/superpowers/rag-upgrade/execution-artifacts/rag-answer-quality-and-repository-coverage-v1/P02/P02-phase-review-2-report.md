# P02 phase review 2 — Australian source policy and activation contracts

## Findings

No Critical or Important defect remains in the complete immutable phase range.

The two Important findings from phase review 1 are closed. The remaining high-risk evidence boundaries are explicitly **UNRUN**, not treated as failures or as evidence of connected/runtime acceptance: current official-source and exact document-licence verification require a connected reviewer, and the migration/trigger/RPC contracts were not replayed in executable PostgreSQL under this review's prohibited-database boundary.

## Attempt-1 finding closure

### Catalogue policy versus authority identity and aliases — closed

- `australian-source-policy-v1` remains the single catalogue/manifest policy constant (`src/lib/australian-source-catalogue.ts:38`; `src/lib/publication-manifest.ts:50`; `src/lib/source-metadata.ts:55`; `src/lib/source-role-policy.ts:65`).
- `catalogueDocumentIdentityCompatible` resolves the catalogue publisher code and document publisher code through the registry-owned identity namespace, requires the same authority object, validates a non-empty registered publisher alias and jurisdiction, and requires lifecycle agreement (`src/lib/source-authority-registry.ts:434-450`). Catalogue keys deliberately remain policy identifiers and are not incorrectly equated to registry authority keys.
- Normalization, the content-free authority-policy audit, and role eligibility consume that shared compatibility boundary. The catalogue key `australian-health-disability-ageing` therefore aligns with registry identity `australian-department-of-health`, and registered national/WA code, publisher, and jurisdiction aliases remain accepted without admitting hostile code/publisher/jurisdiction/lifecycle combinations.
- The protected link-only entries are intentionally handled by the exact non-authority normalization branch: eTG and AMH retain only their canonical `link_only` / `metadata_link_only` policy and still receive no indexed authority identity. This does not weaken their content prohibition.
- The corrected matrix tests cover every indexed catalogue entry, the Department policy/registry key difference, WA aliases, hostile identity fields, link-only entries, and NPS historical behavior.

### Superseded/replacement/unknown/absent activation state — closed

- `hasActiveAustralianChangeState` is a shared TypeScript allow-list: only `unchanged` or `changed`, with no non-empty `superseded_by_document_id`, is active (`src/lib/australian-source-state.ts:7-11`). It rejects `withdrawn`, `superseded`, `unknown`, absent state, unsupported `active`, and non-empty/whitespace-normalized replacement pointers.
- Both Australian evidence eligibility and the v2 promotion preflight call that predicate (`src/lib/source-role-policy.ts:91-99`; `scripts/promote-public-documents-batch.ts:89-91`). Rejection occurs before approval insertion or an activation RPC.
- Approval insertion, the owned-to-public transition guard, and `activate_approved_public_documents` independently mirror the same SQL allow-list and trimmed replacement-pointer test (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:65-72,205-212,403-410`). They retain the current-status, indexed-content, public-index licence, catalogue, policy, generation, and reviewed-state requirements.
- Focused tests exercise both accepted states and every material rejected state at the role, promotion, and all three SQL boundaries.

## Complete phase assessment

### Task 1 — catalogue and protected-source policy

- The reviewed, content-free verification manifest and typed catalogue agree on all keys, publisher identities, roles, lifecycle, content mode, licence policy, jurisdiction, fallback rank, and `australian-source-policy-v1`.
- Healthdirect is absent and explicitly rejected. NPS MedicineWise remains historical and `index_forbidden`. eTG Complete and Australian Medicines Handbook remain `reference_link` + `link_only` + `metadata_link_only`; they cannot become registry corpus entries, chunks, embeddings, indexed evidence, claim roles, priority candidates, conflicts, or activatable documents.
- Active indexed catalogue roots default to `review_required`; index admission additionally requires the exact-document `public_index_permitted` licence. The catalogue exposes no broad domain wildcard or `.gov.au` trust shortcut.
- Task 1's precise pull-forward identities (`WACP`, `WALEG`, `AUSPRES`) are consumed by the registry without duplicate/conflicting Task 2 definitions. All indexed catalogue entries resolve one registry authority, while protected link-only entries deliberately resolve none.

### Task 2 — normalization and tooling boundaries

- The normalized metadata contract is required and bounded. Catalogue policy survives only an exact catalogue key plus compatible registry-owned identity; registry records cannot mint Australian authority. Invalid enum/URL/date/timestamp/hash values fail closed, diagnostics disclose only bounded field/reason vocabulary, HTTPS URLs reject embedded credentials, and the module remains browser-safe.
- The locality backfill remains limited to `publisher_code`, `publisher`, and `jurisdiction`; governance/currentness/licence data is not mutated. The separate policy audit is aggregate/content-free and produces no document-specific writable patch.
- The link-only normalization branch preserves the exact protected pair but cannot grant classification or indexability. NPS remains recognizable provenance with historical lifecycle and no active augmentation eligibility.
- The audit's stored-document scope is intentional: protected eTG/AMH content must never exist as stored/indexed document rows. Their policy is covered by catalogue/normalization tests rather than being treated as an authority-audit candidate.

### Task 3 — claim-role eligibility and evidence resolution

- The exhaustive `RagQueryClass` mapping is conservative: only verified numeric/threshold classes map to `dose_or_monitoring`; every ambiguous class maps to `treatment` (`src/lib/rag/rag-context-selection.ts:14-21`).
- Both normal and strong-retry production context paths call the same governed selector (`src/lib/rag/rag-context-selection.ts:49,75`), and `filterSourcesEligibleForClaim` runs before any relevance-band/authority ordering (`src/lib/source-governance.ts:19-23`; `src/lib/australian-source-priority.ts:82-101`).
- Eligibility rejects link-only/reference sources, Australian catalogue/policy/identity/role mismatches, inactive/non-current/expired/poor-extraction sources, and Australian evidence without exact public-index permission. There is no global authority score boost and `src/lib/rag/rag.ts` is unchanged.
- Resolution retains local-primary only for eligible, locally validated, directly supportive uploaded guidance; otherwise it selects eligible Australian evidence or a structured no-evidence decision. Conflict creation requires explicit verified differences and complete evidence on both sides; duplicate conflict evidence unions are deterministic and sorted.
- Legacy public/private rows with missing canonical scope or role now fail closed. That is an intentional programme sequencing boundary, not a regression: trusted ingestion owns emission of canonical `corpus_scope` / `source_role` (`docs/superpowers/plans/2026-08-21-trusted-admin-document-ingestion.md:398`), and retrieval composition explicitly leaves missing/historical scope ineligible pending separately reviewed reconciliation (`docs/superpowers/plans/2026-08-20-rag-retrieval-composition.md:439`). P02 is the policy/contract phase and is not deployed independently.

### Task 4 — manifest, approval, and atomic activation

- Manifest v2 is strict and fixed to the catalogue policy version. UUIDs are normalized before document/generation duplicate checks; lowercase state digests, exact owner/generation/catalogue bindings, operator, reason, evidence, and decisions are required. Unknown, inactive, historical, link-only, and otherwise non-indexable catalogue entries are rejected. V1 parsing remains available, but the dispatcher and database transition guard prohibit v1 activation of `australian_public`.
- Approved entries are sorted by canonical document UUID. TypeScript binds the same approved set/order/cardinality into `documentId:expectedStateDigest` and the generation array (`src/lib/publication-manifest.ts:130-142`; `scripts/promote-public-documents-batch.ts:209-216`). SQL validates UUID syntax, rejects canonical UUID duplicates, recomputes the ordered batch digest and generation array, and loops in canonical order (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:294-373`).
- The dispatcher is import-safe and dependency-injected, preserves dry-run plus count/SHA confirmation, records the exact v1/v2 approval fields, invokes only the corresponding writer RPC, and sends v2 as one atomic batch.
- The transition guard validates the target `NEW` reviewed state, rejects same-statement policy/generation/content mutation, omits only the actual generated document columns from the writable-state comparison, reads generation from `NEW.metadata` rather than an unavailable `BEFORE`-trigger generated column, and permits only the exact publication receipt fields during the governed owner release (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:112-213`). Once Australian state is public, full metadata and writable reviewed document state are immutable and re-ownership is rejected (`:249-257`).
- The atomic RPC row-locks documents, evidence children, and ingestion jobs; rejects active ingestion work and mismatched child ownership; rechecks exact status/policy/licence/change-state/generation/approval evidence; recomputes the existing document-state digest under lock; and releases the complete approved batch in one transaction (`:368-526`).
- Approval history remains append-only with all-or-none nullable v2 evidence for v1 compatibility. RLS is enabled; anon/authenticated access is revoked; approval access and activation execution remain service-role-only; security-definer search path is fixed; checked-in database types match the three columns and RPC signature. The new migration is intentionally not folded into `supabase/schema.sql` before application.

### Cross-task scope and ownership

- Catalogue keys, publisher codes, policy version, corpus/role/content/licence/lifecycle vocabulary, and active-state meaning agree across catalogue, normalizer, authority registry/audit, role policy, promotion, manifest, SQL, tests, and checked-in types.
- The full range contains only Tasks 1-4 production/test/data/migration files. No Task 5 reference-link presentation or Task 6 operator-documentation feature work, and no task/process artifact, entered a product commit.
- `src/lib/rag/rag.ts` has no immutable-range diff and remains exactly 4,362 lines.
- The tracked worktree was clean before this permitted report write. Existing untracked `.superpowers`, P02 execution artifacts, and the draft P02 receipt were preserved; no product/source/test/migration file was edited and no commit was created.

## Immutable range and canonical package

- Requested/current HEAD: `ac634ab358c92e6d943258a532aa5c6a98959e88`.
- Base `b7da14fe6abaf1ff93b97b55303ed1b135c60a14` is an ancestor of HEAD.
- The complete range contains exactly 12 commits, in order: `924a6c63b250d45c550df2b907276c14144d924c`, `bb708016b6277279e9d38482ce4d90927be6468c`, `d4e42a5d710ecdaa82e567ed2ea2584dc12d832f`, `cf7bc34186af5a72cb239cd25ce6004c2d7c72f9`, `c6d5ed52eca90ead9c1a088999d2adeb285959d1`, `36e0e1a6185f169f7e3820587da4aa94877fe396`, `e877cd7770f50d775663a3abf8690d13bc68eb49`, `90b90ea26a09dc6e59fa18d1198dd2a6f63161d6`, `fe263fffa226940000d40cf0d743e507d3b06335`, `58ba7908afc61231ed898f23a39dd43158f173b1`, `db78a7c90d97a681b1f806fda1b12e4ce00ea616`, and `ac634ab358c92e6d943258a532aa5c6a98959e88`.
- `P02-phase-review-2.diff` SHA-256 is exactly `05b6a8e85ae5dfd75a4320defc6ca4ce73645ff253db57e4ab73422e02f24d92` and its header/base/head/commit list are exact.
- Independent checker-semantics reconstruction used the repository's `reviewPackageBytes` inputs (`--no-color --no-ext-diff --no-textconv --no-renames --full-index --binary -U10`) for the same BASE, HEAD, and 12-commit list. The replacement package is byte-for-byte exact: `actualBytes=235005 expectedBytes=235005 byteExact=true`, and its actual and reconstructed SHA-256 values both equal `05b6a8e85ae5dfd75a4320defc6ca4ce73645ff253db57e4ab73422e02f24d92`.

## Protected offline verification

- `node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts tests/check-indexing-contract.test.ts tests/registry-corpus.test.ts tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/source-metadata-browser-safety.test.ts tests/therapy-source-governance.test.ts tests/answer-copy-payload.test.ts tests/source-role-policy.test.ts tests/australian-source-priority.test.ts tests/source-governance.test.ts tests/rag-context-budget.test.ts tests/rag-score.test.ts tests/publication-manifest.test.ts tests/supabase-schema.test.ts` — **PASS**, exit 0; 15 files, 279/279 tests, fresh receipt. No lease contention.
- `npm run arbiter -- typecheck` — **RUN**, exit 0; the DB scope requires the typecheck.
- `npm run typecheck` — **PASS**, exit 0; fresh whole-tree typecheck receipt.
- `npm run check:rag:fixtures` — **PASS**, exit 0; 36 golden cases, 26 suites, 29 programme cases; fixture digest `sha256:4bf13e036a49ee077a9227c6b61d6f597efff15e8a5f2e3ea36f0cd4e4ea5107`.
- `npm run check:maintainability-budgets` — **PASS**, exit 0; `src/lib/rag/rag.ts` is 4,362/4,362.
- `npm run check:migration-role` — **PASS**, exit 0; active hosted SQL/tooling uses `postgres` and immutable applied history is unchanged.
- `npm run check:owner-scope` — **PASS**, exit 0; 42 API files clean against 25 owner-scoped tables.
- `git diff --check b7da14fe6abaf1ff93b97b55303ed1b135c60a14..ac634ab358c92e6d943258a532aa5c6a98959e88` — **PASS**, no output.
- Independent package path/blob verifier — **PASS**: 30/30 paths and 30/30 BASE/HEAD full-index blob pairs matched.

## Residual evidence boundaries

- **UNRUN — connected source-current acceptance:** no network or official-site verification of current source URLs was performed. The checked-in manifest continues to require connected verification.
- **UNRUN — exact document-level licence acceptance:** no connected licence/evidence review established `public_index_permitted` for any document.
- **UNRUN — executable PostgreSQL behavior:** the migration was not applied or replayed; trigger/RPC semantics were reviewed statically and through focused SQL contract tests only.
- No database/Supabase connection, hosted/provider action, migration application, publication, deployment, push, direct Playwright run, or other external action occurred.

SPEC_VERDICT: PASS
QUALITY_VERDICT: PASS
