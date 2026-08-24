# P05 ingestion Task 2 review 4 report

## Findings

No P0-P2 findings.

The two review-3 failures are closed at the corrected head, and no regression was found in the earlier security, governance, lifecycle, schema, or import-safety boundaries.

## Reviewed range and artifacts

- TASK_BASE: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- TASK_HEAD: `62adef3b97906f6164f3d568712141dd9cd4117d`
- Merge base: exact TASK_BASE.
- Full-range commits:
  - `38bef52bf feat(sources): stage approved public source versions`
  - `b54cc1aeb fix(sources): harden controlled acquisition boundaries`
  - `45badf07a fix(sources): close acquisition lifecycle gaps`
  - `62adef3b9 fix(sources): make replacement staging resumable`
- Task brief `P05-ingestion-task-2-brief.md` SHA-256: `9bb4012ec1cd5b1db1c7dbd6eae405eb08766c496562336fdc36567bb24dfcf7` (immutable brief reviewed in full during this same-reviewer sequence).
- Updated implementer report SHA-256: `464f769e393f473fe1b2a3946df21aa9b1d6ce1e155f3e343629b01970484d1e`.
- Repository-canonical full-range package `P05-ingestion-task-2-review-4.diff` SHA-256: `5e086e2867c4f5e87163cac8f520c81faccdd8d53eecf7c94540034c397a8e3a`.
- The 4,386-line repository-canonical package, updated report, exact correction delta, exact-head source/tests, governing plan/spec, and accepted P02/P04 ingestion/publication/source-control contracts were reviewed across the immutable base..head range.
- `npm run ledger:lookup -- 62adef3b97906f6164f3d568712141dd9cd4117d --scope "P05/ingestion/task-2 SDD review-4"` returned `NOT REVIEWED at this HEAD and scope` before this pass. No ledger record was appended because this controller-owned SDD review requires only an uncommitted, unstaged report.

## Review-3 finding disposition

### Unsafe raw HTML storage: closed

- `PublicSourceStagingCandidate` now exposes one byte field only, the canonical `bytes`; upstream provenance is content-free `sourceContentHash`, `sourceContentType`, and `sourceByteLength` (`src/lib/public-source-acquisition.ts:73-85`).
- HTML validation hashes the bounded upstream response, removes chrome, retains only accepted main text, re-hashes the canonical text, and returns the upstream digest/type/size without returning upstream bytes (`src/lib/public-source-acquisition.ts:570-623`). The candidate metadata records those values with `source_content_provenance: "digest_only"` (`:483-528`).
- The live adapter performs exactly one upload, to a `/canonical/` path, using `candidate.bytes` and `candidate.contentType`; the document's file size/hash and `canonical_storage_path` describe those same canonical bytes (`scripts/fetch-approved-public-source-versions.ts:228-251`). There is no raw/source upload or `candidate.sourceBytes` access anywhere in the public-source path.
- The synthetic Healthdirect-chrome regression proves the candidate has exactly one `Uint8Array`, the canonical bytes contain no excluded Healthdirect/eTG/AMH identity, the metadata retains only upstream digest/type/size, and the live adapter contains one upload call (`tests/public-source-acquisition.test.ts:483-556`).

### Replacement stage/enqueue retry: closed

- Before any upload/document insert, the live adapter calls `stage_public_source_version` with the complete replacement identity. An exact existing shadow returns its document/version/owner and proceeds directly to enqueue; a missing result permits new staging (`scripts/fetch-approved-public-source-versions.ts:197-230`).
- The SQL RPC serializes per catalogue, locks the latest activation event and matching version/document rows, and compares the activation event, catalogue/canonical/exact version identity, upstream and staged hashes, content types/sizes, licence digest, owner, lifecycle, document storage identity, and policy/content-identity metadata. Any difference raises `Public source resumable shadow identity mismatch`; only an exact match returns `resumed` (`supabase/migrations/20260820121000_create_public_source_control_plane.sql:303-388`).
- A new stage is accepted only after the RPC row-lock and document/metadata proof. It returns the persisted identity as `created`; a concurrent exact winner is returned as `resumed`, and the losing temporary document/object is removed (`scripts/fetch-approved-public-source-versions.ts:228-279`; migration `:390-470`).
- The replacement CLI enqueues the returned document only after staging/resume (`scripts/check-public-source-changes.ts:166-191`). The shared enqueue owner is idempotent through the one-open-job-per-document unique constraint and treats a proven competing open job as `already_active` (`src/lib/ingestion-enqueue.ts:83-124`).
- The failure-injection regression stages once, fails the first post-stage enqueue, resumes the same document/version on the second attempt, uploads/inserts once, and leaves one open job (`tests/public-source-acquisition.test.ts:878-1002`). Static schema tests also pin the missing/resumed outcomes and mismatch checks (`tests/supabase-schema.test.ts:1669-1690`).

## Earlier-boundary regression check

- Healthdirect and link-only eTG/AMH identities remain excluded before acquisition. The same shared policy is enforced before enqueue and by the Edge worker/agent backstop; retained main-content markers quarantine, while chrome-only links are discarded.
- The HTTPS transport remains bound to a prevalidated socket address with SNI/Host for the reviewed host, checks the connected peer address, rejects private and special-use IPv4/IPv6 ranges, revalidates every redirect, limits redirects/body size, and fails closed on disallowed/opaque content types without an exact trusted inspector.
- Exact upstream and canonical hashes remain separate. The stored document hash/file type/file size refer to the exact canonical bytes, while only upstream digest/type/size metadata is retained.
- Source activation remains separate from exact version publication. Activation is latest-event and exact-policy bound; publication still requires the exact accepted P02 receipt, manifest/state/index-generation identity, and owner transition. Staging remains owned `shadow`, with no automatic activation or supersession.
- Activation rows remain append-only; version identity remains immutable outside explicit lifecycle fields. SQL uses service-role-only grants, fixed search paths, row/advisory locks, one-active-per-source and version/document uniqueness, and atomic retry-safe withdrawal tombstone/review handling that can withdraw only the actual active identity.
- Generated database types remain aligned with `stage_public_source_version(jsonb) -> Json` and the withdrawal RPC signature (`src/lib/supabase/database.types.ts:3062-3073`).
- All three CLIs remain import-safe and dry-run by default; JSON/errors/logs remain content-free and do not include response bodies, URLs containing secrets, raw bytes, provider content, or database diagnostics.

## Commands and results

- Exact base/head/merge-base resolution, branch/status, four-commit log, full-range stat, and `git diff --check` — exact range confirmed; diff check passed.
- Updated artifact SHA-256 checks — implementer report and canonical review package both matched the controller-provided hashes.
- `npm run ledger:lookup -- 62adef3b97906f6164f3d568712141dd9cd4117d --scope "P05/ingestion/task-2 SDD review-4"` — `NOT REVIEWED at this HEAD and scope`.
- `node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/ingestion-enqueue.test.ts tests/indexing-v3-agent.test.ts tests/supabase-schema.test.ts tests/function-grants.test.ts` — PASS; 5 files and 136 tests passed. The function-grant failure messages are expected negative-fixture output inside the passing suite.
- `npm run check:migration-role` — PASS; hosted tooling retains the required postgres role and immutable applied migration history.
- The implementer report records the exact expanded brief selector (6 files, 135 tests), typecheck, function-grants, migration-role, and maintainability gates passing at TASK_HEAD. This review independently ran the focused correction selector and migration-role gate rather than duplicating every unchanged broad gate.
- Browser checks, live TLS/DNS, hosted SQL replay, provider gates, database/migration apply, and broad suites were not run because they would not add proportionate offline evidence or would cross the explicit no-live boundary.

## Residual risk

The SQL lifecycle/resume proof is static and mocked rather than a hosted migration replay, and the real TLS/Storage/queue integration remains environment-gated. Concurrent-race cleanup failure can leave an unreferenced temporary owned document/object for later operational cleanup, but it cannot replace the exact resumed version or create a second version/job. These limitations do not contradict the task's source-only acceptance boundary.

## No-live and no-document confirmation

No actual source or document was fetched, uploaded, stored, extracted, chunked, embedded, summarized, indexed, activated, tombstoned, or processed. No corpus/provider data was read. No network request, provider call, Supabase/database connection, Storage operation, queue/worker mutation, migration apply/replay, deployment, push, or PR action occurred. Verification used repository source, SQL text, explicitly synthetic fixture/in-memory data, and dependency-injected tests only.

No product code was edited. This report is intentionally uncommitted and unstaged.

SPEC_VERDICT: PASS

QUALITY_VERDICT: PASS
