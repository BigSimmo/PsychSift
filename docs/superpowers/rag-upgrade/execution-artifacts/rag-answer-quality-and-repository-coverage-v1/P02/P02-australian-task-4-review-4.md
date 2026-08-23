# P02 Australian Task 4 — Review 4

## Findings

No Critical or Important defect remains in the complete four-commit immutable range.

The highest residual risk remains executable PostgreSQL behavior: this review did not apply or replay the migration under the explicit local/static boundary. Connected source verification and exact document-level licence review were also outside the authorized boundary. These evidence gaps are reported as **UNRUN**, not as product failures or claims of runtime/provider proof.

## Phase-review finding disposition

### Catalogue policy identity and authority identity: corrected

Files: `src/lib/source-authority-registry.ts:267-274,370-462`; `src/lib/source-metadata.ts:133-157`; `src/lib/source-authority-metadata.ts:351-363`; `src/lib/source-role-policy.ts:62-89`; `tests/australian-source-catalogue.test.ts:73-124`; `tests/source-metadata.test.ts:287-359`; `tests/source-authority-tooling.test.ts:82-122`; `tests/source-role-policy.test.ts:128-174`

- The catalogue policy key remains `australian-health-disability-ageing`, while publisher code `AUSDOH` resolves to the existing registry-owned authority `australian-department-of-health`. Catalogue-key equality is no longer treated as authority identity.
- `catalogueDocumentIdentityCompatible` is the single registry boundary used by normalization, read-only metadata audit, and role policy. It resolves both catalogue and document identities through normalized, unique publisher-code ownership; requires the same registry authority; validates non-empty publisher and jurisdiction against registered aliases; and requires the catalogue lifecycle to match the authority lifecycle.
- Canonical and registered national/WA aliases are accepted, including the AUSDOH key difference and `DOHWA` / `WA Department of Health` / `WA`. Hostile code, publisher, jurisdiction, unknown-authority, and lifecycle mismatches fail closed in the focused tests.
- Catalogue construction still rejects duplicate normalized publisher codes (`src/lib/australian-source-catalogue.ts:122-145`). Healthdirect remains absent and explicitly prohibited; eTG and AMH retain exact link-only/metadata-only normalization; NPS remains historical and non-indexable (`src/lib/australian-source-catalogue.ts:165-187`; `tests/australian-source-catalogue.test.ts:17-48`). The shared indexed-content identity change does not weaken those protected cases.
- The new compatibility code uses only browser-safe language/runtime primitives and does not add Node-only imports to a browser path.

### Australian active-state parity: corrected

Files: `src/lib/australian-source-state.ts:1-11`; `src/lib/source-role-policy.ts:91-110`; `scripts/promote-public-documents-batch.ts:62-94`; `supabase/migrations/20260822123000_govern_australian_source_activation.sql:51-72,186-213,397-413`; `tests/source-role-policy.test.ts:116-126,175-188`; `tests/publication-manifest.test.ts:531-566`; `tests/supabase-schema.test.ts:1449-1466,1504-1522`

- The shared TypeScript predicate admits exactly `change_state = unchanged|changed` and only a null, absent, empty, or whitespace-only `superseded_by_document_id`. Withdrawn, superseded, unknown, absent, unsupported, non-string, and replacement-bearing states fail closed.
- Australian role eligibility and v2 promotion preflight call that same predicate. Non-Australian legacy eligibility keeps its prior withdrawn/superseded/replacement behavior, avoiding an unrelated compatibility break.
- Approval insertion, owned-to-public transition, and the atomic activation RPC independently mirror the same SQL condition: a whitelist of `unchanged|changed` plus a trimmed-empty replacement pointer. Each boundary also retains the exact current-status, indexed-content, public-index permission, catalogue, policy, generation, and state requirements.
- Focused tests exercise both accepted states and all material rejected state classes. Promotion tests execute the import-safe fake-client seam and prove rejection occurs before approval insertion or a writer RPC; SQL tests extract all three function bodies and assert the exact predicate at each boundary.

## Prior Task 4 finding reconfirmation

Files: `src/lib/publication-manifest.ts:1-147`; `scripts/promote-public-documents-batch.ts:17-241`; `supabase/migrations/20260822123000_govern_australian_source_activation.sql:86-532`; `tests/publication-manifest.test.ts:1-566`; `tests/supabase-schema.test.ts:1375-1575`

- Manifest v2 remains strict and fixed to `australian-source-policy-v1`. Operator, reason, evidence, exact document shape, lowercase SHA-256 state digest, canonicalized UUIDs, and non-empty document membership are required. Document and approved-generation duplicate checks operate after UUID syntax validation/canonicalization. Unknown, inactive, historical, link-only, and non-indexable catalogue entries are rejected, which keeps approved eTG, AMH, and NPS prohibited; v1 parsing remains available.
- Approved entries are canonically sorted by document UUID. TypeScript binds `documentId:expectedStateDigest` into `p_expected_state_digest` and builds the generation array from the same approved array/order/cardinality. SQL first validates UUID syntax, then groups canonical `uuid` values for duplicate document/generation rejection, recomputes the ordered state binding and generation array, compares both confirmations, and loops in the same canonical document order (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:292-373`).
- `runPublicationPromotion` is import-safe and dependency-injected. It preserves dry-run/apply count and digest confirmation, records the exact v1 or v2 approval fields, dispatches only the correct writer RPC, submits one v2 atomic batch RPC, and rejects v1 Australian publication before an approval insert or writer call.
- An old/non-Australian or v1-reviewed row cannot become `australian_public` in the ownership-release statement. Same-statement writable document and governed metadata mutation is rejected while only the eight exact publication receipt fields are excluded for a legitimate owned-to-public release (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:112-213`).
- The writable-document projection omits only `owner_id`, `updated_at`, `metadata`, and the three actual generated columns `search_tsv`, `title_search_tsv`, and `index_generation_id`; no writable reviewed column is omitted. The BEFORE trigger never reads a generated `NEW` column. It derives the target generation from `NEW.metadata`, catches malformed UUID text, and binds it to the selected approval (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:114-129,186-205`; `supabase/schema.sql:80-105`).
- Once an Australian row is public, all metadata—including the eight publication evidence fields—is immutable, every writable/base document field remains reviewed, and re-ownership is rejected (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:250-257`).
- The RPC row-locks every document, relevant artifact rows, and ingestion job rows; rejects active ingestion work and mismatched child ownership; recomputes the existing state digest under lock; and releases the complete approved batch within one transaction (`supabase/migrations/20260822123000_govern_australian_source_activation.sql:368-506`).
- Approval history remains append-only and historical-compatible. The migration uses nullable all-or-none v2 evidence, stable trigger/function replacement, enabled RLS, anon/authenticated revocation, service-role-only approval access and RPC execution, fully qualified objects, and empty fixed `search_path`. Checked-in database types match the three approval columns and exact RPC signature.
- No new privilege, replay/idempotence, race, generated-column, transition-guard, v1, or protected-source regression was found. The stronger tests cross-check actual generated-column schema and function-body/branch structure rather than relying only on error strings.

## Immutable-range and verification evidence

- Current `HEAD`: `ac634ab358c92e6d943258a532aa5c6a98959e88` (exact requested head).
- `90b90ea26a09dc6e59fa18d1198dd2a6f63161d6..ac634ab358c92e6d943258a532aa5c6a98959e88` is a valid ancestor range containing exactly four commits: `fe263fffa226940000d40cf0d743e507d3b06335`, `58ba7908afc61231ed898f23a39dd43158f173b1`, `db78a7c90d97a681b1f806fda1b12e4ce00ea616`, and `ac634ab358c92e6d943258a532aa5c6a98959e88`. It changes 15 files: the Task 4 implementation/tests plus the expressly requested cross-task phase correction and focused tests.
- Canonical package SHA-256: `8fa01387dbdafc7c0c3884ed8d0efff7f8704044493186d21d8282618003e6e4`. An independent full-index/no-renames/binary reconstruction of the complete BASE..HEAD range matched `P02-australian-task-4-review-4.diff` exactly (113,469 normalized characters); the package is current and is neither stale nor correction-only.
- The first literal focused attempt was denied before Vitest because the legitimate `system_health_status_audit` focused-capacity lease was active. The wrapper surfaced exit 1 with an explicit capacity-full admission error; no test ran, the lease was preserved, and this was classified as admission contention rather than product failure.
- Final literal `node scripts/run-vitest.mjs run tests/publication-manifest.test.ts tests/supabase-schema.test.ts` — **PASS**, exit 0; 2 files and 102/102 tests passed in 535 ms. A fresh receipt was recorded for 4,576 inputs.
- Cross-task correction suite `node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/source-role-policy.test.ts tests/publication-manifest.test.ts tests/supabase-schema.test.ts` — **PASS**, exit 0; 6 files and 189/189 tests passed in 1.54 s. A fresh receipt was recorded for 4,576 inputs.
- The first typecheck attempt was likewise admission-contended before TypeScript ran. Final `GATE_RECEIPTS=refresh npm run typecheck` — **PASS**, exit 0; a fresh receipt was recorded for 4,576 inputs.
- `npm run check:migration-role` — **PASS**, exit 0; active hosted SQL/tooling uses `postgres` and immutable applied history is unchanged.
- `npm run check:owner-scope` — **PASS**, exit 0; 42 API files are clean against 25 owner-scoped tables.
- `npm run check:maintainability-budgets` — **PASS**, exit 0; `src/lib/rag/rag.ts` remains 4,362/4,362 lines.
- Local Prettier check over all 14 changed TypeScript/test/type files — **PASS**, exit 0. SQL has no selected repository Prettier parser and was inspected directly.
- `git diff --check 90b90ea26a09dc6e59fa18d1198dd2a6f63161d6..ac634ab358c92e6d943258a532aa5c6a98959e88` — **PASS**, no output.
- `src/lib/rag/rag.ts` immutable-range check — unchanged and budget-protected.
- **UNRUN residuals:** executable local PostgreSQL migration replay and trigger/RPC behavior; connected verification of current official source URLs; exact document-level licence review. No database, migration application, network, hosted/provider, Supabase, deployment, publication, push, or other external action was performed.

SPEC_VERDICT: PASS
QUALITY_VERDICT: PASS
