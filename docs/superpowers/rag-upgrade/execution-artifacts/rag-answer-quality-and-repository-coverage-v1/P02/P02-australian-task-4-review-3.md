# P02 Australian Task 4 — Review 3

## Findings

No Critical or Important defect remains in the complete three-commit immutable range.

The highest residual risk is executable PostgreSQL behavior: the migration was not applied or replayed under this review's explicit static/offline boundary. The positive v1/v2 owner-release paths and negative mutation paths therefore have strong source/schema contract evidence but not an actual PostgreSQL trigger/RPC execution result. This evidence gap is reported as **UNRUN**, not as a product failure or a claim of runtime proof.

## Prior-finding disposition

### Review 2 — generated-column-safe owner release: corrected

Files: `supabase/migrations/20260822123000_govern_australian_source_activation.sql:102-128,185-204`; `supabase/schema.sql:80-105`; `tests/supabase-schema.test.ts:1489-1573`

- The writable-document projections exclude exactly `owner_id`, `updated_at`, `metadata`, `search_tsv`, `title_search_tsv`, and `index_generation_id`. The latter three are the three stored generated columns in the actual `documents` schema. No writable reviewed column is omitted: title, description, file identity/location, content hash, source/import fields, status/counts, error state, identifiers and creation time remain in the old/new comparison.
- No generated `NEW` value participates in the `BEFORE UPDATE` decision. The former direct `NEW.index_generation_id` read is gone. For an Australian target, the guard safely casts `NEW.metadata->>'index_generation_id'`, converts malformed input to a controlled exception, and compares the resulting UUID to the approval's reviewed generation.
- The non-audit metadata projection still includes `index_generation_id` and every other governed metadata field, so the same statement cannot swap generation, catalogue, policy, content mode, licence, current/withdrawn state or other reviewed metadata while releasing ownership.
- The v1 path does not cast or require Australian generation evidence. A valid non-Australian v1 release can add only its publication receipt fields, while an old/non-Australian row cannot become `australian_public` in the same update. A valid v2 release can add the exact expanded receipt and must match v2 approval/policy/generation evidence.

### Review 2 — post-public receipt immutability: corrected

File: `supabase/migrations/20260822123000_govern_australian_source_activation.sql:130-150,248-255`

- The eight permitted receipt additions (`public_corpus`, approval ID, manifest/state digests, publication catalogue/policy/generation evidence, and `published_at`) are excluded only inside the owned-to-public branch.
- Once an Australian row is public, the guard compares the complete `OLD.metadata` and `NEW.metadata` values plus the writable/base document projection. Publication evidence cannot be added, removed or rewritten, and all governed/reviewed metadata remains immutable.
- Australian public re-ownership remains an unconditional rejection before the already-public comparison.

### Review 1 — target-state, canonical UUID and dispatcher findings: remain corrected

- Owner release is evaluated against `NEW` Australian scope and exact writable/non-audit target state before approval lookup. Exact target catalogue, policy, committed generation, indexed-content/public-index permission, current/non-withdrawn state and v2 receipt evidence are then checked against the selected approval.
- SQL validates UUID syntax before casts, groups duplicate document and approved generation IDs as canonical `uuid` values before aggregation/loop work, derives the batch state binding and generation array in canonical document-ID order, and row-locks/recomputes each document state.
- `runPublicationPromotion` remains import-safe and dependency-injected. The fake-client tests execute the seam and prove dry-run read-only behavior, exact v1/v2 approval inserts, sole correct writer RPC dispatch, canonical normalized v2 state/generation payload, and v1 Australian refusal before any approval insert or writer call.

## Full Task 4 assessment

The complete range retains the strict manifest-v2 shape, fixed `australian-source-policy-v1`, canonical UUID and lowercase digest handling, mandatory operator/reason/evidence, duplicate document/generation rejection, catalogue-backed unknown/inactive/link-only rejection, approved eTG/AMH/NPS prohibition, and preserved v1 parsing. Dry-run/apply count and digest confirmations remain intact.

The v2 script sends one atomic activation RPC with exact signed/reviewed fields. SQL independently validates the canonical batch digest and ordered generation array, then locks each document, digest-bearing child rows and ingestion jobs; rejects active work; verifies exact approval identity and policy/generation/state; checks child ownership; recomputes the existing reviewed-state digest under lock; and releases all approved rows within one transaction. Activation records the durable manifest/state/policy/generation receipt.

The migration remains replay-oriented and historical-compatible: nullable approval columns, all-null/all-present v2 evidence constraint, stable trigger/function replacement, repeatable grants/revokes, append-only approval history, enabled RLS, service-role-only table/RPC access, fully qualified security-definer objects and empty fixed search paths. No new privilege, race, replay, idempotence, checked-in type, or legacy transition-guard regression was found. `database.types.ts` matches the new approval columns and RPC signature.

The strengthened static test cross-checks the actual generated-column declarations, exact projection exclusion list, absence of the direct `NEW.index_generation_id` access, metadata-derived target-generation cast, activation-branch placement of receipt exclusions, post-public full-metadata comparison, and re-ownership branch. The SQL evidence is materially stronger than superficial error-string matching, while remaining accurately classified as static rather than runtime PostgreSQL proof.

No out-of-scope product file is in the range. `src/lib/rag/rag.ts` is unchanged at its 4,362-line budget.

## Immutable-range and verification evidence

- Current `HEAD`: `db78a7c90d97a681b1f806fda1b12e4ce00ea616` (exact requested head).
- `90b90ea26a09dc6e59fa18d1198dd2a6f63161d6..db78a7c90d97a681b1f806fda1b12e4ce00ea616` contains exactly three commits: `fe263fffa226940000d40cf0d743e507d3b06335`, `58ba7908afc61231ed898f23a39dd43158f173b1`, and `db78a7c90d97a681b1f806fda1b12e4ce00ea616`. It changes exactly the six planned Task 4 files.
- Canonical package SHA-256: `f571577371a905d16d3cbaeec32bad969fb2e84ad640c4dc7843b8c3c70612a0`. An independent full-index/no-renames/binary reconstruction of the complete BASE..HEAD range matched `P02-australian-task-4-review-3.diff` exactly (80,791 normalized characters).
- Initial literal focused attempt was denied before Vitest with exit 75 because the legitimate `measure-cls-attribution` focused-capacity lease was active. The lease was preserved and the result was treated as admission contention, not product failure.
- Final literal `node scripts/run-vitest.mjs run tests/publication-manifest.test.ts tests/supabase-schema.test.ts` — **PASS**, exit 0; 2 files and 97/97 tests passed in 597 ms. A fresh receipt was recorded for 4,571 inputs.
- Initial fresh typecheck attempt was likewise admission-contended before TypeScript ran. Final `npm run typecheck` with fresh receipts — **PASS**, exit 0; a fresh receipt was recorded for 4,571 inputs.
- `npm run check:migration-role` — **PASS**, exit 0; active hosted SQL/tooling uses `postgres` and immutable applied history is unchanged.
- `npm run check:owner-scope` — **PASS**, exit 0; 42 API files clean against 25 owner-scoped tables.
- Local Prettier check over the five changed TypeScript/test/type files — **PASS**, exit 0. SQL has no selected repository Prettier parser and was inspected directly.
- `git diff --check 90b90ea26a09dc6e59fa18d1198dd2a6f63161d6 db78a7c90d97a681b1f806fda1b12e4ce00ea616` — **PASS**, no output.
- `src/lib/rag/rag.ts` immutable-range check — unchanged; 4,362 lines.
- **UNRUN residual:** executable local PostgreSQL migration replay and trigger/RPC behavior tests. The migration was not applied. No database, Playwright, hosted migration-history, provider, Supabase, network, production-readiness, deployment, push or other external action was performed.

SPEC_VERDICT: PASS
QUALITY_VERDICT: PASS
