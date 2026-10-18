# Remaining merged-review repairs and acceptance handoff

This follows `2026-10-18-merged-pr-resolution.md` and PR #3638. The owner requested a new PR for every remaining item, including the browser, durable-alert, PDF, database, clinical and ledger boundaries. This branch starts from main `1bd7ea309` and incorporates original PR head `c02f718467195dc9ef11e8071b3e6748e0d7901e` to preserve the earlier fixes alongside the remaining repairs in a consolidated new PR against main. PR #3638 remains unchanged by this follow-up. Neither PR has merge or production-deployment authority.

## Confirmed defects and repairs

### PS-008: device-level offer delivery

Confirmed the aggregate `sent > 0` receipt permanently suppressed failed devices and process-local promises did not serialize independent instances. Replaced that authority with a draft database outbox. A trigger on the committed `roster_open_post_keys` insert queues an event in the same transaction as `open.post`. It does not backfill older staff openings. The opening is bounded by its start or six hours, whichever comes first.

The service-role-only invoker RPC claims events with `FOR UPDATE SKIP LOCKED`, a random token and ten-minute expiry. It snapshots active eligible owners' device IDs once and keeps each device pending, sent or skipped independently. Transient failures retry with a bounded delay; acknowledged devices are excluded. It validates wall-clock expiry **after acquiring the row lock**, including when a waiter started before expiry. The consumer handles at most 25 devices per batch and rechecks current opening state, eligibility, membership, preferences, quiet nights and device ownership. Lookup errors remain retryable rather than becoming an authoritative empty recipient list. Payloads contain only the existing `offer` type code; endpoints and identities are not logged or stored in these receipts. Web push has a ten-second timeout and a TTL no longer than the event's remaining lifetime.

The worker owns a non-overlapping one-minute retry consumer and drains its current batch at shutdown. Existing staff-release and web-push configuration gates remain in force. Events and device receipts expire; subscription/account/team deletion cascades through the receipts. Missing durable schema has no legacy whole-recipient fan-out fallback.

**Delivery semantics are at least once.** A provider can accept a push before the process crashes or loses its acknowledgement. That device can receive a duplicate after lease recovery. A provider acceptance is not proof that a person saw the notification. No production staff delivery, provider push, release activation or settings change was performed.

### PS-029: ambiguous PDF edge text

Confirmed lowercase, bullet, numeric and multicolumn text outside a detected table could become clinical cells solely from alignment. Edge rows now require actual visible four-sided PDF cell ruling. Filled backgrounds and invisible strokes confer no cell authority. Text without that evidence stays separate as `unassigned_edge_text` with its bounding box and an `edge_recovery_needs_review` signal, rather than becoming a dose/action row. Extraction warnings carry the review limitation onward; table facts only consume admitted `table_rows`.

A second confirmed defect could discard an outside safety note sharing a native block with table text. Table-aware text assembly now excludes only fully contained native lines before grouping. Complete instructions that overflow a detected table remain in page text. Boundary lines may duplicate table text; preservation takes precedence over silently losing a qualification. The extractor version records this behavior change. Native raw text is still represented by a provenance hash, not an independent complete text archive.

Synthetic native-PDF regressions cover note forms, multicolumn abbreviation keys, ruled deliberate dose/bullet lines, filled/invisible rectangles, shared-block outside notes and complete overflowing instructions. Existing hard-table, reading-order, budget, hostile-input, page-edge and geometry tests remain intact. This is conservative source association, not clinical appraisal of a production PDF corpus.

### Latest original-PR CI failures

Hosted run `39107398901` on original PR head `c02f718467195dc9ef11e8071b3e6748e0d7901e` failed compilation because an automated commit appended a malformed duplicate tail to `ingestion-enqueue.ts`. The follow-up removes that tail. Its database-owned mutation UUID also lacked optional Insert/Update typings, breaking registry rollback compilation; those generated-compatible types are completed. Enqueue/quality fixtures now model the returned mutation UUID, including a later writer with the same timestamp but a different identity, preserving the actual concurrency assertion.

The later CET wording correction also left its browser catalogue stale. Regenerated the current full asset as `therapies.5f2d28d5d88a81d5.json`, retaining main's actual previously shipped `therapies.9be87b25ad2919f8.json` rather than the unmerged intermediate asset. The expected current-catalogue fixture was rebuilt: 1,081 logical IDs preserved, 205 lineage digests changed, and every content hash, governance field, eligibility value and exclusion reason unchanged. Frozen database seeds and clinical attestations were not changed. The therapy-index and exact static-manifest checks pass.

That hosted run also recorded red sealing/drift gates. Its migration replay reached drift generation successfully, then rejected the stale expected manifest. It is not evidence that the updated follow-up schema has replayed. Its unit failures include syntax cascades and database assertions; no fresh green full-suite run is inferred from historical passes.

## Verification

Evidence on corrected source `72b9a22e77039350e248bf43a3c539be95ce9c0b` unless qualified below:

- Python extractor scope: `Ran 60 tests` / `OK`. This includes the new native-PDF cases and existing hard tables, rotations, budgets, page-edge and hostile inputs.
- Focused TypeScript scope: `Test Files 7 passed (7)` / `Tests 50 passed (50)`, covering delivery, strict opening lookup, replay, existing alerts, PDF table recovery, enqueue and ingestion-quality behavior.
- Fresh complete source/test typecheck passed after correcting the inherited mutation types.
- Local PGlite SQL execution passed atomic enqueue rollback, device retry, token fencing, completion, RLS/privilege and TTL checks.
- A network-isolated disposable PostgreSQL 17.6 container passed the committed minimal-schema fixtures. Two independent connections proved `SKIP LOCKED` excludes an uncommitted claim, a committed lease excludes another consumer, expiry creates a new token, stale acknowledgement fails and acknowledged devices remain terminal.
- A separate lock-wait-across-expiry regression failed the initial draft (returned a result after expiry), then passed the corrected function (returned no work). This specifically tests fresh wall-clock validation after locking.
- Independent read-only PDF and alert reviewers found the filled-background, safety-note, transient-lookup and lock-wait defects described above; all were corrected and rechecked. No remaining actionable finding in those bounded reviews. Requested reviewer model settings are not independently verified execution telemetry.

PostgreSQL fixture proof is **not** a complete Supabase-chain replay. The pinned Supabase image again failed registering a layer with `no space left on device` despite available workspace storage; no image substitution, historical hash rewrite, forged expected drift or safety-gate change was used. The small PostgreSQL image was used only for the explicitly scoped transaction/concurrency proof.

Fresh browser proof: the complete assessment spec passed **7/7** on system Chromium `151.0.7922.173`, including unchanged 2px gesture assertions in browser/installed layouts, normal/reduced motion, widths 320–1920, 200% text, forced colours, focus clearance and performance capture. The complete Teaching spec passed **16/16**, reusing that same production build. The captured assessment trace had 4 layouts (maximum 0.177ms), 1,355 tasks and no tasks of at least 50ms; this is local developer evidence, not physical-phone performance. Screenshots were inspected and retained locally. The build includes the corrected application code; subsequent catalogue regeneration changed only generated data/lineage and is checked separately.

Fresh lint passed with zero warnings. Migration-role, function-grant, owner-scope, maintainability and dependency/export checks passed. Offline RAG fixture/adversarial contracts passed, including 25 harness tests. CI-mode production-readiness structure passed with its expected outstanding-acceptance warnings; its `READY` line does not attest to production readiness. Read-only clinical review printed `Report only; no file was changed.`

The first Chromium attempt compiled webpack but its TypeScript child hit the default approximately 4 GiB heap limit before browser tests; it is a failed infrastructure attempt, not a product-test result. The retry explicitly supplies the repository's supported 8 GiB Node heap. Physical Safari, an installed PWA and assistive technology still require their own observed acceptance.

## Precise remaining owner and integration gates

| Item                               | Work prepared here                                                                                                                                                                                                           | Remaining authority/evidence                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database proposal                  | Draft `20261018073435_durable_roster_offer_device_outbox.sql`, mirror, privileges, transaction and real two-session tests                                                                                                    | Specific owner approval for this database change and an approved production merge window. No live application performed.                                                                                                                                                                                                                                                    |
| Migration seals                    | Three unsealed proposals exist in the integrated branch: `20261018055300_atomic_training_milestone_mirror.sql`, `20261018073435_durable_roster_offer_device_outbox.sql`, `20261018100000_fence_document_queue_rollbacks.sql` | Owner permission to append these new hash entries only. No existing hash entry needs resealing. `AGENTS.md` explicitly includes editing `supabase/applied-migration-hashes.json` in its permission boundary.                                                                                                                                                                |
| Schema replay/drift                | Actual local transaction tests; original CI replay evidence identified                                                                                                                                                       | Replay the exact follow-up tree on the pinned Supabase image and commit its genuinely generated expected drift artifact. Do not reuse the original PR artifact against this changed schema.                                                                                                                                                                                 |
| PS-003 scroll                      | Original 2px assertion and complete assessment browser spec preserved                                                                                                                                                        | Fresh engine results; physical-device acceptance cannot be manufactured from emulation. No speculative CSS reserve patch or tolerance change.                                                                                                                                                                                                                               |
| Clinical/legal/cultural acceptance | Conservative PDF association, withdrawn evidence and release holds preserved; rollback and privacy implications documented                                                                                                   | Named accountable owners review the exact content/behavior. `docs/clinical-sign-off-how-to.md` states “Only you can sign off” and requires a person at a real terminal. No attestation was invented or activated.                                                                                                                                                           |
| Canonical issue ledger             | Original immutable correction/reopen requests retained                                                                                                                                                                       | Requests in still-unmerged PR #3638 must land before the dedicated fresh-base, serialized `issues:reconcile` workflow can apply them. This follow-up does not directly edit the canonical ledger or pretend queued requests are applied.                                                                                                                                    |
| PR integration                     | Consolidated follow-up targeting main                                                                                                                                                                                        | The original PR remains open; do not merge both independently. Specific authorization is still required for a production-bound merge. A stacked base was considered, but main CI filters main/release PR bases and the available connector cannot manually dispatch a run; the new main-target PR therefore preserves the original fixes and receives normal configured CI. |

## Rollback and clinical implications

Revert the application/extractor changes before release if their acceptance fails. A database rollback requires an explicitly approved forward migration, never an edit to applied history. The alert outbox has no clinical payload and preserves account/team/device ownership. The PDF change can reduce structured edge-row recall where ruling is absent; source text and coordinates remain available for review instead of asserting an uncertain clinical relationship. It can change retrieval inputs, so live RAG before/after canaries remain separately approval-gated. This engineering review does not determine TGA/SaMD classification or provide clinical activation approval.

## Final local handoff checks

The owning worker/PDF/roster/catalogue suites plus architecture, route reachability,
React server boundaries and the configured design-preview TypeScript contract
reported **`Test Files 131 passed (131)`** and **`Tests 1805 passed | 1 skipped
(1806)`**. These overlap earlier focused evidence and are not a fresh complete
repository unit run.

`verify:pr-local` completed every selected static stage through
`check:migration-role`, then failed `check:migration-immutability` on the three
explicitly listed unsealed drafts. It did not execute its later stages. Function
grants, owner scope, lint, complete typecheck, the production browser build, owning
unit suites and offline RAG contracts have the separate evidence above. No
complete PR-local or production-readiness pass is claimed. Whole-repository
Prettier completed without changes; later metadata edits were formatted before
commit. Diff integrity passed **846 → 897 cases in 39 changed test files**, with
27/27 self-tests. The comparison base was current main `1bd7ea309`.

The new catalogue ownership pointer was updated to its actual generated asset,
and the disposable roster SQL fixtures were placed in the existing Personal
practice organisation map. No canonical ledger or historical sealed migration
was edited. Permission to append only the three new migration hashes was
requested separately; absence of a response is not approval.

## Hosted follow-up CI and provenance correction

Run [39110057708](https://github.com/BigSimmo/PsychSift/actions/runs/39110057708)
tested PR #3641 head `7fc7de0ea248d52b7dfafa898ceab6ac58e24862` against
main `1bd7ea309`. The migration chain applied, database behaviour tests passed,
and the exact pinned Supabase image replayed `schema.sql` and generated its
manifest. This supersedes the local image-extraction limitation for these hosted
steps. Freshness then failed against the committed old manifest; chain/mirror
parity was consequently skipped and remains unproved.

The generated replacement is artifact **12129961926**, named
`drift-manifest-39110057708`, ZIP digest
`93546b59639d123947eac8967f4fea2250b8f6c7792bf932132b1d8857cf0f54`.
Its workflow metadata identifies the exact head above. Generation reported
normalized schema SHA-256
`ba60b09ee6307eed83bfa94a8a9160c3abd9c36b05f08088680901852d22e5ca`.
The GitHub connector returned a File Service download reference, but its signed
URL returned HTTP 403 from this execution environment. No archive bytes were
retrieved or substituted and no manifest was fabricated. Download that actual
artifact, verify its archive digest and schema hash, and commit it before the
next replay. The protected migration-hash file remains untouched pending the
specific owner response.

Hosted production build, bundle budget/boot checks, Playwright build, Lighthouse,
safety/configuration, ingestion SAST, source contracts, platform smoke, secret scan
and SAST passed. Static checks passed through the immutability guard, which failed
on exactly the three unsealed drafts; its later lint/typecheck stages were
skipped (separate fresh local results are above). Container work was cancelled
before complete image/smoke/vulnerability proof; an empty scan summary is
unassessed, not a vulnerability finding or a pass.

Unit partition 1 reported **14,366 passed and one failed**: the TypeScript
provenance fixture still named extractor version v6 after Python moved to v7.
The follow-up aligns only that fixture with the declared
`2026-10-18.ruled-edge-provenance-v7`, preserving the equality assertion. Its
focused rerun passed **9/9** (`/tmp/psychsift-followup-provenance-version.log`).
Partition 2 reported **18,004 passed, three failed and one skipped**: one stale
manifest test and two migration-seal tests. These are overlapping evidence,
not a green complete repository run. The required aggregate cannot pass while
sealing and the expected drift file remain unresolved. No full hosted pass is
claimed for the fixture-only correction until its own run completes.

Three automated commits arrived during the first hosted run and cancelled it.
They were merged locally to preserve concurrent work. Their batch-draining
improvement is retained, but removing per-device eligibility checks reproduced
two roster regressions, and excluding intersecting PDF lines reproduced two
native-PDF safety-instruction regressions. Correction `11a29e1d3` restores fresh
per-device eligibility/settings/night checks and fully-contained-line exclusion,
while retaining bounded device-page and event draining. A new 26-device test
crosses the page boundary under one durable claim. Fresh correction evidence:
**35 TypeScript tests in four files**, **60 Python tests**, full zero-warning lint
and full source/test typecheck passed. Independent PDF and alert reviewers
rechecked this composition with no new material finding; these are bounded
engineering reviews, not clinical signatures.

The concurrent unsealed queue draft now uses one `ADD COLUMN ... uuid NOT NULL
DEFAULT gen_random_uuid()` with lock/statement timeouts, avoiding document UPDATE
trigger side effects during backfill. Its intended fresh-schema catalogue is
unchanged; historical sealed files and the schema mirror are not modified by
that correction. The outstanding hash-approval question must be assessed against
these final draft bytes. The first run's artifact remains applicable only after
verifying its schema hash matches the final unchanged `schema.sql`; its bytes are
still unavailable through this environment's transfer path.

Final pre-push hosted snapshot: run
[39110598058](https://github.com/BigSimmo/PsychSift/actions/runs/39110598058)
on concurrent head `6ad017616` settled red. Its unit failures are the old
provenance fixture, the two reproduced per-device regressions, stale drift and
unsealed hashes. Its worker image failed the same two reproduced PDF safety-text
regressions (68 Python tests, two failures, one skip), so downstream image scans
were unassessed. The corresponding code/fixture regressions are corrected and
locally verified above. Both hosted builds, Lighthouse and safety checks passed;
no fresh complete hosted pass is inferred for the successor correction. Final
diff integrity passed **855 → 907 cases in 40 changed test files**, 27/27 self-tests.

A broader local `test_*.py` attempt discovered 68 tests but failed to import the
unchanged assertion-reader module because `medspacy` is absent from this shell.
It is recorded as incomplete infrastructure evidence, not a complete worker
Python pass. The targeted 60-test PDF scope passed; hosted worker images install
their separately pinned requirements and still need a fresh complete pass.

## Owner-approved migration sealing and drift recovery

The owner selected the two remaining database-proposal items and requested
“Resolve these please” on 2026-10-18. This authorizes append-only sealing of the
three already named, reviewed migrations and recovery of the genuine expected
drift manifest in this unmerged PR. It does not authorize a production merge,
live SQL, historical resealing or changes to drift exceptions.

`npm run migrations:seal` added exactly these new entries, preserving every
previous entry:

- `20261018055300_atomic_training_milestone_mirror.sql`:
  `ed1b24ba2eb486c9d3acca05908c1d28ee0b91aed15b74a32acad871a8ffcee2`
- `20261018073435_durable_roster_offer_device_outbox.sql`:
  `5ece69d4b218a16ddb67727ff1454e5cb694f56d3014b4956b2b91bf50e5c74e`
- `20261018100000_fence_document_queue_rollbacks.sql`:
  `54f26e207645fd9e90fe24cd67feab4ce65514adeec472978dba6fa4cda4ad9a`

The immutability guard now passes all 324 migrations. Ninety existing freshness,
immutability, chain-parity and CI-audit contract tests passed. A scratch harness
executed the actual modified workflow shell with controlled generation/check
commands: fresh output remains successful, stale output remains a failure, and
the emitted recovery JSON and SHA-256 are byte-exact. The workflow fallback only
prints the generated scratch-schema inventory on freshness failure, with clear
markers and a file checksum; it contains no row data and still exits nonzero.
This provides a supported GitHub-log recovery path while the execution
environment blocks the artifact download host. No expected catalogue is edited
by hand.
