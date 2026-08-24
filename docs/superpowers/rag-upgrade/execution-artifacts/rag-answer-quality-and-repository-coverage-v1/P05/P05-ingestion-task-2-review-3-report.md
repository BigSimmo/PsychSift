# P05 ingestion Task 2 review 3 report

## Findings

### P1 — Excluded Healthdirect chrome is still uploaded as raw source provenance

- Evidence: `src/lib/public-source-acquisition.ts:580-586` correctly removes HTML chrome before producing the canonical retained text, but `buildPublicSourceStagingCandidate` retains the original response in `sourceBytes` at `:495-505`. The live adapter then unconditionally uploads those raw bytes to `sourceStoragePath` at `scripts/fetch-approved-public-source-versions.ts:164-179` before writing the canonical derivative.
- Trigger/proof: acquire the required synthetic trusted-page fixture whose header/footer contains Healthdirect links. The offline exact-head probe returned `{"canonicalContainsHealthdirect":false,"sourceContainsHealthdirect":true}`; the latter byte set is the one passed to the first Storage upload.
- Expected: the trusted-page contract drops the chrome and link target, and excluded Healthdirect evidence is rechecked before every upload/storage boundary (`P05-ingestion-task-2-brief.md:51,67`; governing design `2026-08-21-trusted-admin-document-ingestion-design.md:44`).
- Actual risk: the searchable canonical document is clean, but the excluded Healthdirect URL/identity still enters repository-controlled Storage. The worker backstop cannot correct a pre-index storage-policy violation.
- Smallest fix/proof: do not persist excluded raw chrome. Store only the sanitized canonical bytes (while retaining the upstream hash/content type as non-content provenance), or sanitize the provenance object before upload and hash that exact stored form. Add a live-adapter seam test proving neither uploaded object contains Healthdirect/eTG/AMH identity when the accepted canonical page does not.

### P1 — A transient replacement enqueue failure strands the staged version and cannot be retried

- Evidence: the corrected change path stages at `scripts/check-public-source-changes.ts:168-180` and then enqueues at `:181-191`. If enqueue rejects, the already-created owned document and `public_source_versions` row remain; there is no compensating cleanup or resumable result. On the next run, the change path constructs and stages again rather than looking up/resuming the exact shadow row. The table uniqueness constraint at `supabase/migrations/20260820121000_create_public_source_control_plane.sql:51` rejects that duplicate `(source_catalogue_key, exact_version_url, content_hash)`.
- Evidence: the “exactly once” regression at `tests/public-source-acquisition.test.ts:756-826` covers one successful invocation only. It does not inject an enqueue failure and retry the same confirmed change.
- Trigger: Storage/document/version staging succeeds, then `enqueueDocumentReindexJob` or its immediate authorization recheck fails transiently.
- Expected: a changed exact version is staged and enqueued exactly once, with a retry able to complete the enqueue after any interruption without creating a duplicate version.
- Actual risk: the CLI fails after durable staging. Every ordinary retry fails at duplicate version staging before reaching enqueue, so the replacement remains `uploaded` with no ingestion job and cannot reach evaluation/publication.
- Smallest fix/proof: make the exact staging identity idempotently return the existing owned `shadow` document/version, then call the already-idempotent enqueue boundary, or atomically commit the version/job state in one database operation after Storage admission. Add a two-attempt failure-injection test: first attempt stages then enqueue fails; second attempt reuses the exact staged row and leaves exactly one open job and one version.

## Reviewed range and artifacts

- TASK_BASE: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- TASK_HEAD: `45badf07af596a16efe0c44078f8ddd8ee82a8f2`
- Merge base: exact TASK_BASE.
- Full-range commits:
  - `38bef52bf feat(sources): stage approved public source versions`
  - `b54cc1aeb fix(sources): harden controlled acquisition boundaries`
  - `45badf07a fix(sources): close acquisition lifecycle gaps`
- Updated implementer report SHA-256: `4b3d8e91a42417b3913fc6274fb5111febf559be812f5cc41071a5f307fbbf4d`.
- Repository-canonical full-range package `P05-ingestion-task-2-review-3.diff` SHA-256: `5526dc39b324cde4bd7eaed31315a76186cac5b99a5488bb88f235cd00c1f461`.
- The repository-canonical 4,072-line package, updated report, correction delta, exact-head source/tests, governing brief/plan/spec, and previously accepted P02/P04 source/publication owners were reviewed across the immutable base..head range.
- `npm run ledger:lookup -- 45badf07af596a16efe0c44078f8ddd8ee82a8f2 --scope "P05/ingestion/task-2 SDD review-3"` returned `NOT REVIEWED at this HEAD and scope` before this pass.

## Review-2 finding disposition

1. Opaque/compressed containers: closed for the local live adapter. PDF/OOXML now return `unknown` and fail before staging unless an exact-hash/version trusted inspector verdict is injected.
2. Change activation identity and one-success-path enqueue: the shared candidate builder now carries the persisted activation event and the success path stages then enqueues once. Retry after a partial failure remains broken as finding 2 above.
3. Malformed JSON diagnostic redaction: closed. The three CLIs use a fixed read/parse error mapping and sentinel tests are content-free.
4. Withdrawal tombstone/review atomicity: closed statically. One service-role, fixed-search-path RPC locks the source rows, handles active/tombstoned retry state, tombstones, and inserts the review audit/outbox record in one transaction.
5. Current active identity: closed statically. CLI evidence requires `active`; SQL re-proves the exact active identity and a partial unique index prevents multiple active rows for one catalogue key.

## Earlier-boundary regression check

- Address-bound TLS transport, private/non-global/DNS rebinding checks, redirect limits, size/type/hash boundaries, exact staged/source hashes, exact P02 publication receipt binding, immutable activation/version identity, latest-event row locking, service-role grants, fixed search paths, generated RPC/type alignment, owned `shadow` staging, no automatic activation, enqueue/worker policy backstops, and import-safe dry-run CLIs remain present.
- The retained-main-content Healthdirect/eTG/AMH quarantine path remains correct. Finding 1 is specifically the separate raw-provenance upload that occurs after canonical sanitization.

## Commands and results

- Exact base/head/merge-base resolution, branch/status, three-commit log, full diff stat, and `git diff --check` — exact range confirmed; diff check passed.
- Updated artifact SHA-256 checks — both matched the controller-provided values.
- `node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/ingestion-enqueue.test.ts tests/indexing-v3-agent.test.ts tests/supabase-schema.test.ts tests/function-grants.test.ts` — PASS; 5 files and 134 tests passed. The function-grant negative-fixture messages are expected test output.
- `npm run check:migration-role` — PASS; hosted tooling retains the required postgres role and immutable applied history.
- Synthetic trusted-page canonical/raw probe — canonical retained bytes contained no Healthdirect identity; raw provenance bytes still did.
- Broad suites, typecheck, browser checks, live TLS/DNS, hosted SQL replay, provider gates, and database/migration operations were not run. The implementer reports typecheck and distinct static gates green; this review did not duplicate them.

## No-live and no-document confirmation

No actual source or document was fetched, uploaded, stored, extracted, chunked, embedded, summarized, indexed, activated, tombstoned, or processed. No corpus/provider data was read. No network request, provider call, Supabase/database connection, Storage operation, queue/worker mutation, migration apply/replay, deployment, push, or PR action occurred. Review probes used only the repository's explicitly synthetic HTML fixture, synthetic in-memory bytes, and dependency-injected local functions.

No product code was edited. This report is intentionally uncommitted and unstaged.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
