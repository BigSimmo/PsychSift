# P02 Australian Task 4 — Review 2

## Findings

### Important — the `BEFORE UPDATE` guard reads unavailable `NEW` generated columns and rejects legitimate publication

Files: `supabase/migrations/20260822123000_govern_australian_source_activation.sql:112-113,179`; `supabase/schema.sql:80-105`; `supabase/migrations/20260717131000_guard_document_publication_approval.sql:92-94`

The correction compares `to_jsonb(NEW)` with `to_jsonb(OLD)` while retaining every document column except `owner_id`, `updated_at`, and `metadata`. It also directly compares `NEW.index_generation_id` to the approval. The existing trigger is a `BEFORE INSERT OR UPDATE` trigger, while `documents.search_tsv`, `documents.title_search_tsv`, and `documents.index_generation_id` are stored generated columns.

PostgreSQL computes the current `NEW` generated values after `BEFORE` triggers. They are therefore not valid target-state values inside this guard. Serializing the whole `NEW` record includes unavailable/uncomputed generated fields, so the old/new document projections do not reliably match even when every writable reviewed field is unchanged. For Australian activation, the direct `NEW.index_generation_id IS DISTINCT FROM <approved non-null UUID>` check also fails because that generated value is not current in the trigger. The result is a broken core workflow: the exact RPC update that changes only owner, publication audit metadata, and `updated_at` is rejected. The projection issue also affects the preserved v1 owner-release path.

Expected behavior is to allow the legitimate owner release while rejecting changes to writable reviewed/governed state. The current focused tests pass because they inspect SQL text and never execute this trigger under PostgreSQL generated-column semantics.

Required correction and proof:

- Build the reviewed document projection only from writable/base columns. Explicitly omit all three generated columns (`search_tsv`, `title_search_tsv`, and `index_generation_id`) from both composite projections.
- Do not read `NEW.index_generation_id` in a `BEFORE` trigger. Validate/cast the target generation from `NEW.metadata->>'index_generation_id'`, or use the locked `OLD.index_generation_id` after proving the non-audit metadata projection is unchanged.
- Add a local PostgreSQL behavior test proving that the exact v2 RPC owner-release update succeeds, the legacy v1 non-Australian owner-release path still succeeds, and same-statement title/status/metadata/generation mutations fail. A source-string assertion alone cannot detect this regression.

### Important — post-public immutability excludes all durable publication evidence

File: `supabase/migrations/20260822123000_govern_australian_source_activation.sql:114-133,229-233`; `tests/supabase-schema.test.ts:1520-1539`

The metadata projections remove eight keys: `public_corpus`, `publication_approval_id`, `publication_manifest_digest`, `publication_reviewed_state_digest`, `publication_source_catalogue_key`, `publication_source_policy_version`, `publication_reviewed_index_generation_id`, and `published_at`. Excluding exactly these keys is necessary during the owner-release statement because the activation RPC is adding the receipt. However, the post-public branch reuses the same reduced projections. Its intended logic therefore permits an owner-null Australian row to rewrite or delete every publication receipt/evidence key without rejection, while the append-only approval row remains unchanged.

That permits the document metadata to point at a different approval, manifest/state digest, catalogue/policy/generation or publication time than the durable activation that occurred. It undermines the fail-closed activation receipt and audit binding. The current generated-column defect may accidentally reject such updates, but accidental failure caused by unavailable generated values is not an acceptable immutability control; fixing the first finding exposes this evidence rewrite unless the branch is corrected at the same time. The focused schema test currently enshrines the omission by requiring all eight keys to be removed from both metadata projections.

Required correction and proof:

- Scope the eight-key exclusion to the owned-to-public activation comparison only. Once an Australian document is public, compare those receipt keys exactly (or compare full metadata) so they cannot be added, removed, or changed. Continue allowing only genuinely non-reviewed row audit changes such as `updated_at` where required.
- Retain the unconditional Australian re-ownership rejection.
- Add post-public behavior cases that attempt to mutate each receipt/evidence field and prove rejection, alongside a positive exact activation case that proves the eight fields can be added only during the governed owner release.

## Review-1 correction disposition

- **OLD-to-arbitrary-NEW bypass:** the intended logic is corrected. The owner-release branch derives old/new Australian scope, rejects non-Australian/v1 to Australian conversion, compares all writable document fields and all non-publication-audit metadata before approval lookup, and checks target Australian policy/content/licence/status fields. It is not releasable yet because the generated-column implementation above breaks the valid path.
- **Canonical duplicate rejection:** corrected. The RPC validates UUID syntax before casts, then groups document IDs and approved generation IDs as canonical `uuid` values before aggregation and before the activation loop. Canonical digest/generation order and per-document locked recomputation remain intact.
- **Dispatcher/test gap:** materially corrected for TypeScript. `runPublicationPromotion` is import-safe and dependency-injected. The fake-client tests execute it and prove dry-run read-only behavior, exact v1 and v2 approval shapes, the sole correct writer RPC, canonical normalized v2 binding/generation order, and rejection of v1 Australian publication before approval insertion. The remaining SQL tests are structural rather than behavior-level and missed both findings in this review.

## Remaining contract assessment

The complete two-commit range retains the strict manifest-v2 shape, exact policy version, canonical UUID/lowercase digest handling, operator/reason/evidence, document/generation uniqueness, catalogue eligibility enforcement, link-only/inactive/unknown rejection, eTG/AMH/NPS prohibition, and v1 parsing. The script preserves explicit dry-run/apply confirmation and passes the signed/reviewed fields required by the v1 or v2 path.

Apart from the trigger findings, the atomic v2 RPC still independently recomputes the canonically ordered batch binding and generation array before row processing; locks each document, digest-bearing children and ingestion jobs; rechecks exact current/non-withdrawn/indexed/public-index-permitted policy and generation state; verifies matching append-only approval evidence and child ownership; recomputes the per-document state digest; and releases all approved documents in one transaction. No new race, replay, type-signature, RLS, grant, or `SECURITY DEFINER search_path` regression was found. The nullable approval columns and all-null/all-present constraint retain historical compatibility, and the checked-in database types match the SQL surface.

No out-of-scope product file is in the immutable range. `src/lib/rag/rag.ts` remains unchanged at its 4,362-line budget.

## Immutable-range and verification evidence

- Current `HEAD`: `58ba7908afc61231ed898f23a39dd43158f173b1` (exact requested head).
- `90b90ea26a09dc6e59fa18d1198dd2a6f63161d6..58ba7908afc61231ed898f23a39dd43158f173b1` contains exactly two commits, `fe263fffa226940000d40cf0d743e507d3b06335` and `58ba7908afc61231ed898f23a39dd43158f173b1`, and changes exactly the six planned Task 4 files.
- Canonical package SHA-256: `432ce60477ac7054529774fcedf378f32055d82d5803fa824b5866846f89e99d`. An independent full-index/no-renames/binary reconstruction of the complete BASE..HEAD range matched `P02-australian-task-4-review-2.diff` exactly (78,531 normalized characters).
- `node scripts/run-vitest.mjs run tests/publication-manifest.test.ts tests/supabase-schema.test.ts` — **PASS**, exit 0; 2 files and 97/97 tests passed in 661 ms. A fresh receipt was recorded for 4,569 inputs. This does not close the SQL runtime gaps described above.
- `npm run typecheck` with fresh receipts — **PASS**, exit 0; a fresh receipt was recorded for 4,569 inputs.
- `npm run check:migration-role` — **PASS**, exit 0; active hosted SQL/tooling uses `postgres` and immutable applied history is unchanged.
- `npm run check:owner-scope` — **PASS**, exit 0; 42 API files clean against 25 owner-scoped tables.
- Local Prettier check over the five changed TypeScript/test/type files — **PASS**, exit 0. SQL has no selected repository Prettier parser and was inspected directly.
- `git diff --check 90b90ea26a09dc6e59fa18d1198dd2a6f63161d6 58ba7908afc61231ed898f23a39dd43158f173b1` — **PASS**, no output.
- `src/lib/rag/rag.ts` immutable-range check — unchanged; 4,362 lines.
- The migration was not applied or replayed. No Playwright, hosted migration-history, provider, Supabase, network, production-readiness, deployment, push, or other external action was run under this offline review authority.

SPEC_VERDICT: FAIL
QUALITY_VERDICT: FAIL
