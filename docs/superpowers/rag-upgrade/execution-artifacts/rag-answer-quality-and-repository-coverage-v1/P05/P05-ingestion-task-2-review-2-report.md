# P05 ingestion Task 2 review 2 report

## Findings

### P1 — Compressed protected eTG/AMH content still crosses the storage and enqueue boundaries

- Evidence: `src/lib/public-source-acquisition.ts:534-541` checks non-HTML containers by decoding their raw bytes and applying a text regex. That cannot inspect compressed PDF streams or compressed OOXML parts. The live scan adapter is an unconditional accept at `scripts/fetch-approved-public-source-versions.ts:151-152`. The worker check at `supabase/functions/indexing-v3-agent/index.ts:1794-1815` runs only after the document has already been stored and enqueued, so it cannot satisfy the pre-storage/pre-enqueue contract.
- Trigger: an otherwise structurally admitted PDF whose `FlateDecode` stream contains `Australian Medicines Handbook protected excerpt`. The raw file does not contain that plaintext sequence.
- Expected: eTG/AMH protected content is rejected before storage and before enqueue, as required by the task brief at `P05-ingestion-task-2-brief.md:67` and the governing design at `2026-08-21-trusted-admin-document-ingestion-design.md:44`.
- Actual risk: the exact offline probe reported `{"rawContainsProtectedIdentity":false,"outcome":"accepted","staged":true,"enqueued":true}`. The worker may later notice extracted text, but by then protected content has already been stored, violating the hard source-policy boundary.
- Smallest fix/proof: replace the no-op live scan with a content-aware pre-storage inspection that examines decompressed/extracted text for every admitted container type, or fail closed for types that cannot receive that inspection. Keep the worker check as defense in depth. Add a compressed PDF and compressed OOXML regression proving `stageOwnedDocument` and `enqueue` remain uncalled.

### P1 — Automatic change detection cannot produce a usable replacement shadow version

- Evidence: the ordinary acquisition candidate adds `source_activation_event_id` at `src/lib/public-source-acquisition.ts:422-434`. The change-detection candidate built at `scripts/check-public-source-changes.ts:182-210` omits that field, while `stage_public_source_version` rejects a staging document without the exact activation ID at `supabase/migrations/20260820121000_create_public_source_control_plane.sql:324-342`. The live adapter therefore uploads bytes and inserts the owned document, then its version RPC fails and enters cleanup at `scripts/fetch-approved-public-source-versions.ts:216-237`.
- Evidence: even after adding the missing identity, `scripts/check-public-source-changes.ts:88-91` and `:179-215` only call `stageOwnedDocument`; there is no call to `acquisition.enqueue` anywhere in this CLI. A changed document that did stage would remain `uploaded` with no ingestion job and could not reach the separately approved publication path.
- Trigger: run confirmed change detection for an active exact URL whose observed hash differs from the reviewed current hash.
- Expected: a changed hash creates an owned `shadow` source version and staging document that enters the governed indexing/evaluation pipeline, without activating or publishing it.
- Actual risk: current code either fails version staging because its metadata cannot satisfy SQL or, after the narrow metadata fix, strands a non-enqueued replacement. The core change-detection workflow is broken.
- Smallest fix/proof: centralize candidate construction so initial and changed acquisition carry identical policy/activation metadata, then enqueue the successfully staged replacement through the guarded enqueue adapter. Add an offline composition test around `runCheckPublicSourceChangesCli` asserting the captured candidate contains the exact activation event ID and that enqueue is called only after successful version staging.

### P2 — Malformed manifest/current JSON can still disclose input content through CLI diagnostics

- Evidence: native parsing errors escape from `JSON.parse` at `scripts/plan-public-source-acquisition.ts:50`, `scripts/fetch-approved-public-source-versions.ts:270-271`, and `scripts/check-public-source-changes.ts:126-129`. Each executable entrypoint prints the native `error.message` at `scripts/plan-public-source-acquisition.ts:88-91`, `scripts/fetch-approved-public-source-versions.ts:307-310`, and `scripts/check-public-source-changes.ts:222-225`.
- Trigger/proof: Node 24 parsing `SENTINEL_SECRET_PAYLOAD_NOT_JSON` produced `Unexpected token 'S', "SENTINEL_S"... is not valid JSON`.
- Expected: document, manifest, current-state, provider, Storage, database, and queue diagnostics are mapped to bounded fixed messages with no input content or secrets.
- Actual risk: correction 1 closed scanner/provider adapter leakage but did not close malformed local evidence leakage; arbitrary manifest/current content can appear in stderr and collected logs.
- Smallest fix/proof: wrap file reads and JSON parsing at each CLI boundary and throw fixed public-source parse/read codes. Add import-safe CLI tests whose malformed inputs contain sentinels and assert neither stderr-facing error nor structured output contains them.

### P2 — Withdrawal tombstone and human-review queueing are not atomic or retry-safe

- Evidence: `src/lib/public-source-acquisition.ts:635-647` first commits `tombstoneCurrentVersion(event)` and only then calls `queueHumanReview(event)`. The live implementation performs the lifecycle RPC at `scripts/check-public-source-changes.ts:93-104` and a separate audit insert at `:105`.
- Trigger: the transition RPC succeeds and the following audit insert fails transiently.
- Expected: withdrawal immediately excludes the old version and durably queues human review as one controlled outcome.
- Actual risk: the version remains tombstoned without the required review event. Retrying with the same current evidence expects the former lifecycle and fails the transition, so the missing review event is not repaired by a normal retry.
- Smallest fix/proof: use one locked SQL RPC that transitions and writes an idempotent review/outbox event atomically, or make the post-transition review write independently idempotent and retryable against an already-tombstoned exact identity. Add a failure-injection test for the boundary between both operations.

### P2 — `--current` does not prove that the selected row is the current active retrieval version

- Evidence: `scripts/check-public-source-changes.ts:21-28` and `:46-63` accept `shadow`, `approved`, and `quarantined` rows as "current" evidence. The exact key/URL/version/hash checks prevent cross-source substitution, but they do not require the row to be the active/current retrieval row. The tombstone call then trusts the supplied lifecycle at `:93-102`.
- Trigger: provide a digest-confirmed `--current` entry for a matching shadow or quarantined row while another version for that source/URL remains active.
- Expected: a withdrawal check identifies and tombstones the exact current retrieval version so it is excluded immediately.
- Actual risk: the selected non-current row is tombstoned while the real active version remains retrievable, yet the CLI reports a tombstone outcome.
- Smallest fix/proof: require `lifecycle === "active"` for current-version evidence and have the locked SQL boundary prove the supplied row is the unique current active identity for the catalogue key/exact URL before tombstoning. Add a regression that a matching shadow row is rejected before dependency creation or mutation.

## Reviewed range and artifacts

- TASK_BASE: `0d5bb6a5012bd762bb53790ac24de16c7e3078c8`
- TASK_HEAD: `b54cc1aeb3dcf832fe1fa73afa841a2c1380a2f7`
- Merge base: exact TASK_BASE.
- Commits reviewed across the full immutable range:
  - `38bef52bf feat(sources): stage approved public source versions`
  - `b54cc1aeb fix(sources): harden controlled acquisition boundaries`
- Updated implementer report: `P05-ingestion-task-2-implementer-report.md`, SHA-256 `6946fc78e56f17cabe029668f6bd6afbf8dc94a109fb240a92e008561ecefcd1`.
- Repository-canonical full-range package: `P05-ingestion-task-2-review-2.diff`, SHA-256 `48fdc8d10f1171a3866452467a4cae73948771acb826b23e30c1450c05c18015`.
- The repository-canonical package, updated report, exact-head source/tests, governing plan/spec, and accepted P02/P04 publication/source-policy owners were reviewed. The range contains 19 files with 3,214 insertions and 2 deletions.
- `npm run ledger:lookup -- b54cc1aeb3dcf832fe1fa73afa841a2c1380a2f7 --scope "P05/ingestion/task-2 SDD review-2"` — `NOT REVIEWED at this HEAD and scope` before this pass.

## Prior findings disposition

1. Socket/DNS binding and the previously demonstrated `240/4`/documentation/private targets: the outbound connector is now address-bound and validates the socket remote address; the former concrete bypasses are closed offline.
2. Link-only retained content: key/HTML/plaintext and worker guards were added, but compressed admitted containers still cross storage/enqueue. Not closed.
3. Exact byte hash and P02 publication receipt: distinct upstream/staged hashes, immutable identity, unique staging document, and exact P02 receipt fields are now bound. Closed by static/offline evidence.
4. Stored canonical bytes/hash: the document stores the canonical staged bytes/hash while retaining separate upstream provenance. Closed by focused tests and source inspection.
5. Current-source identity before tombstone: cross-catalogue/key/URL/version/hash substitution is closed, but non-active rows are still accepted as current. Partially closed.
6. Diagnostic redaction: scanner, provider, Storage, database, and enqueue adapter messages are fixed, but malformed JSON still leaks input snippets. Partially closed.

## Commands and results

- `git rev-parse`, `git merge-base`, `git status --short --branch`, `git log`, `git diff --stat`, and `git diff --check` for TASK_BASE..TASK_HEAD — exact head/base confirmed; range diff check passed.
- SHA-256 checks for the updated implementer report and canonical review package — both matched the controller-provided hashes.
- `node scripts/run-vitest.mjs run tests/public-source-acquisition.test.ts tests/ingestion-enqueue.test.ts tests/indexing-v3-agent.test.ts tests/supabase-schema.test.ts tests/function-grants.test.ts` — PASS; 5 files and 129 tests passed. The function-grant negative-fixture diagnostics are expected test output.
- Synthetic in-memory compressed-PDF acquisition probe — FAIL for the required boundary: `{"rawContainsProtectedIdentity":false,"outcome":"accepted","staged":true,"enqueued":true}`.
- `node -e` malformed-JSON sentinel probe — FAIL for redaction: the native parse message included `SENTINEL_S`.
- Static address probes confirmed the previously reported private, `240/4`, and documentation examples are rejected. Additional globally reachable IANA special-purpose IPv4 ranges were observed as accepted but are not treated as a blocker in this report because the implemented boundary is explicitly global-routability based.
- Typecheck, broad test suites, browser checks, live TLS/DNS behavior, hosted SQL replay, and provider-backed gates were not rerun. The implementer reports typecheck and distinct static gates green; this review avoided duplicating them after the focused selector passed.

## No-live and no-document confirmation

No actual source or document was fetched, uploaded, stored, extracted, chunked, embedded, summarized, indexed, activated, tombstoned, or processed. No corpus/provider data was read. No network request, provider call, Supabase/database connection, Storage operation, queue/worker mutation, migration apply/replay, deployment, push, or PR action occurred. Review probes used only synthetic in-memory strings/bytes and dependency-injected local functions.

No product code was edited. This report is intentionally uncommitted and unstaged.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
