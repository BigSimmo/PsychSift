# Full Deep remediation: local implementation and acceptance

This is an engineering handoff for the [remediation spec](2026-10-17-full-deep-remediation-spec.md)
and [parallel implementation plan](../superpowers/plans/2026-10-17-full-deep-remediation.md).
It is not a new audit score, canonical task ledger, clinical validation or deployment record.
The later explicitly approved staging-only default-grant repair is recorded below under
“Approved staging execution”; it changes no production state and does not clear release holds.

Original baseline: `b0edabf0b73a806535aa3289e5de8023cf39997f`, branch `work`. Six isolated
implementation lanes were integrated into one uncommitted local change. Original audit findings
and evidence remain preserved. No provider mutation, publication, commit, merge or deployment
was performed. The draft migration must not reach `main` outside a specifically approved database
window: merging it applies the SQL to production automatically.

## Original-tree continuation — 2026-10-18

The owner approved completing the outstanding task after the specific new-hash request.
The native append-only sealer added only
`20261017221129_audit_durable_recovery_pairing_and_cache_fences.sql`, with normalized SHA-256
`f0667fed9f0294c1f5ba40252d11ee66e6de07be340a1ec789e0503a1192f2ac`.
All 317 previous entries are unchanged; the manifest now contains 318 seals. The actual
immutability guard and complete 10-case owning test file passed. This records draft bytes
locally and applies no SQL. The two initial migration-seal test failures are resolved.

Later on 2026-10-18 the same bytes (`f0667fed…`) were renamed to
`20261018082910_audit_durable_recovery_pairing_and_cache_fences.sql`, so that the migration sorts
after main's newest migration, and resealed with `npm run migrations:reseal`. The owner approved
this at 16:17 AWST, relayed by Grok Bot, and confirmed option (b) at 16:33 AWST: reseal only the
reviewed bytes, reverting the unreviewed post-seal edit in `a62fc95418`. No SQL was applied.

Three disposable, task-generated webpack caches were removed to recover approximately 6.6 GiB.
All 3,600 retained non-cache production build files have identical before/after hashes. Source,
dependencies, test evidence and the production artifact remain preserved. The one exact-image pull retry still failed after 208.4 seconds during Docker VFS layer
registration, despite 21,823,168,512 free bytes before retry. No usable image or container was
created and schema replay never started. Both failures remain recorded. Task UID 1000 cannot
inspect the root-owned daemon layer directory; the exact transient storage requirement is
unproven. At that checkpoint, a suitably provisioned isolated Docker environment was the identified route; no blind retry, driver
change, unrelated deletion or hand-edited drift manifest was used.

Twelve of the original 13 unit failures are now addressed by complete affected-file passes;
one remains: actual drift-manifest freshness. The original
full-unit execution is preserved, not relabelled green. Installed-dependency parity and the
migration-role guard passed again. All 86 prior application/test/SQL fingerprints and the
retained runtime build are unchanged, so earlier browser/build/native checks remain attributable
evidence rather than newly executed tests.

The same canonical local receipt has been refreshed with these new proofs and still reports
**Blocked**, not Completed: storage/replay and external clinical/privacy
conditions remain unmet. No external task synchronization occurred.

The owner subsequently confirmed the read-only GitHub fetch under AGENTS.md:216. The exact
fetch succeeded and obtained genuine `origin/main` at
`54559adabe5b51396c2d1c0eb395f2cf79b43fbf`; the assessed HEAD and all 87 frozen implementation
paths remain unchanged. The complete package-parity owning file passed all 18 tests, and the
default RAG package/receipt, ledger, diff-integrity and mockup checks passed. Independent source,
log and fingerprint review confirmed this closes the missing-ref comparison condition.

Fetched main is 18 commits ahead of the assessed HEAD; no merge or rebase was performed. The
separate RAG programme publication/P00 requirement to reconcile its pinned base against current
main remains applicable before executing that programme. These snapshot checks establish no
publication readiness or verification of those 18 later commits. No live database operation,
paid evaluation, clinical approval or deployment was performed. The following original-handoff
sections retain their dated execution history; this continuation records subsequent status changes.

## Current-main candidate — 2026-10-18

The owner subsequently requested current-main reconciliation. A separate candidate at
`/workspace/psychsift-remediation/current-main` starts from genuine main
`54559adabe5b51396c2d1c0eb395f2cf79b43fbf`; the original `/workspace/PsychSift` tree at
`b0edabf0b73a806535aa3289e5de8023cf39997f` and its 87 frozen implementation paths remain
preserved. The 103-path remediation patch was applied to this candidate, with four text conflicts
and the additional calculator-page test mismatch resolved. No commit, publication, merge,
deployment or live SQL followed. The earlier original-tree counts remain historical evidence.

The integration keeps main's stable favourites callbacks and record-open throttling alongside
the remediation's account/epoch fences. Main's owner decision to hide the entire physiological
panel on the calculators page is preserved; the retained component separately enforces its
clinical hold. Main's unsigned therapy/DID restrictions remain. The native static manifest
regenerated with exactly eight Factsheet content/lineage changes, without changing their
eligibility/status fields. Independent source review found no concrete counterexample in these
bounded overlaps; it is separate from runtime proof or clinical validation.

The seal union now contains **319 entries**: all 318 genuine-main entries and all 318 prior
remediation entries are preserved, with zero existing hash changes. The only remediation draft
still has the previously approved
`f0667fed9f0294c1f5ba40252d11ee66e6de07be340a1ec789e0503a1192f2ac` hash. Main's teaching
null-creator revoke guard remains intact. The native append-only sealer carried forward the
approved draft entry; this was no reseal or live SQL application. Earlier 318-entry results describe
the original tree, not this union.

AD01 is locally resolved **in this candidate only** by genuine main's existing `argparse` 2.0.1
override; neither the override nor its lock was invented by this remediation. Actual installed
Mammoth 1.13.0/argparse 2.0.1 checks passed all **13 cases**: five CLI help/error cases, six real
CLI conversions, one library raw-text case and one production dependency-closure case. A fresh
production-only npm audit reported **zero vulnerabilities**. This supersedes the earlier
no-compatible-fix finding for this dependency graph; it does not assert the original preserved
installation was changed or that audit output proves every security property.

The fresh complete unit/DOM execution recorded **32,414 passed, three failed and two skipped
out of 32,419**, in 820.298 seconds. Two failures correctly detected host npm 11.9.0 where the
new main Cloud contract requires 11.17.0; the third is the known stale drift manifest. After
installing genuine integrity-verified npm 11.17.0 into a private runtime prefix, exact-lock offline
installation and full installed-tree parity passed. The complete Cloud platform owning file
then passed **22/22** through its supported `CLOUD_PLATFORM_NPM_HOME` route; no fake version
wrapper or test/source weakening was used. The 13-case installed Mammoth proof passed again
after that installation. Required package versions stayed unchanged; seven optional WASM-only
locations were omitted by the corrected npm installation. The raw full-suite result remains
failed. Complete owning-file followthrough now addresses all three failures: Cloud 22/22 resolves
the runtime cases and drift detection 21/21 follows actual manifest regeneration below. This is
not a fresh green full-suite rerun.

Independent provenance review found that the installed Mammoth probe's local `npm ls`
subprocess resolved the ambient npm 11.9.0, although installation/parity and the Cloud
followthrough used genuine 11.17.0. Its update notifier attempted a registry lookup that
failed with `EAI_AGAIN`; this probe is therefore not described as making zero network
attempts. The observed installed dependency closure and real CLI/library outputs remain
valid. The private review preserves this distinction and the failed lookup evidence.

Repository lint passed in 139.382 seconds and the nonincremental source typecheck passed in
102.611 seconds. A fresh isolated production build completed, but the first browser attempt
failed before test cases because the private global-setup harness loaded an ES module through
an incompatible transformed import (`exports is not defined in ES module scope`). Only that
private harness was corrected. The retry reused the same build: all **3,584 non-cache artifact
files** retain identical hashes. The complete selected production Chromium `ui-tools.spec.ts`
and `ui-smoke.spec.ts` owners then passed **217/217**, with zero failures, skips or flaky cases,
in 363.291 seconds for the wrapper (360.299 seconds in the Playwright report). The existing
quarantine/mockup exclusions remained explicit. `ensure` ran and the actual production
`/api/local-project-id` identity was verified before browser journeys. The production client
bundle secret-marker check also passed. This remains local custom-Chromium evidence, not
hosted deployment, physical Safari/PWA or an unselected browser-matrix run.

The prior Docker/VFS capacity failures remain real historical results. The same-image rootless
route then verified the exact OCI index/child/config, all 29 compressed layers and ordered
uncompressed diff IDs, and trusted signed Debian/package umoci provenance. Actual native image
bootstrap plus genuine main's complete schema produced **zero catalog differences** from its
committed expected snapshot. This baseline proof preceded implementation of the optional backend.

The maintained native generator's explicit rootless backend now passed against the integrated
schema in **42.420 seconds**. It uses the original pinned image, native initialization, postgres
role bootstrap, dynamically discovered Storage owner, complete schema replay and actual catalog
capture. The emitted manifest SHA-256 is
`06bf813db741c9adb7bcbf52fc1545b3541944deee47ff094f3876be6d8fd280`, bound in private evidence to
schema hash `5a095aebcb31d373f9ab80243a93ce47dd8546e136d4f154a7961f73453bff1e`.
Its actual **335-function** snapshot equals the independently captured complete integrated schema
mirror. Guest pg_ctl/server cleanup returned **0/0**, supervisor exit was **0**, no forced stop
occurred, and the owned disposable run was removed. Only then was the manifest atomically
published locally. Docker remains the default; generator/image identity and strict freshness
fields remain unchanged. No hash-only catalog edit, fabricated snapshot or broadened allowlist
was used. **The local full-catalog and stale-manifest blocker is closed.**

The first maintained native attempt did replay roles/scaffold/full schema but failed removing
readonly Nix directories; it left the old manifest unchanged. That failed attempt remains recorded.
Cleanup now validates owned directory identity and makes only owned directory file descriptors
removable, without following external symlinks. The preceding focused test run recorded
**134 passed, three failed**: known stale drift plus two new fixture mode expectations affected
by the restrictive host umask. Explicit fixture chmod establishes the intended exact modes;
no application assertion or safety control was weakened. After actual manifest regeneration,
the complete four owning files passed **137/137**: 82 CI cache safety, 21 drift detection,
eight deep freshness and 26 rootless backend cases. New post-backend repository lint passed
in **2.909 seconds**, and migration-role and organisation checks passed. The final nonincremental
post-backend typecheck passed in **101.327 seconds**. Its preceding failure caught the project
ProcessEnv requirement for NODE_ENV and optional process-handle typing; the corrected minimal
host-tool environments and directly typed handle passed. The sandbox still clears the inherited
environment and retains the original image environment. A final actual replay of this exact source
passed in 42.420 seconds; the earlier accepted 38.459-second manifest is preserved privately.
Only generation time and replay duration differ between those accepted catalogs. The final four
owning files passed **137/137** again after the type correction; earlier failed checks remain recorded.

Five unchanged maintained SQL files also passed against the full same-image schema mirror,
including actual 200,000-row limits and two-user privacy checks. The private harness used the
native SQL runner's documented Auth shim and one rollback transaction per test. A separate fresh
manual replay passed **all 319 unchanged sealed migrations**, one transaction per file, including
the exact approved f066 draft. The earlier autocommit-harness attempt stopped at file 304 when
its ON COMMIT DROP preimage vanished; it was diagnosed as a transaction-contract mismatch and
retained, rather than editing or skipping immutable SQL. The native strict chain/mirror comparator
reported **No divergence**. The same-image comparison left its existing pg_net allowance unused;
no allowance was changed to make it pass.

Actual effective-privilege queries verified all eight audited functions are owned by postgres,
with **16 effective anon/authenticated EXECUTE denials and eight service_role grants**. The
SQL waves also closed with graceful pg_ctl/server **0/0**. These runs were not warning-free:
the corrected chain emitted **14 already-in-transaction** and **14 no-transaction-in-progress**
warnings where existing BEGIN/COMMIT files interact with per-file wrappers, with zero SET LOCAL
outside-transaction warnings. Two immutable platform-role warnings also remain: postgres cannot
alter the reserved platform role's default privileges or assume that role for its probe, so the
probe was skipped. **Operator verification of the reserved role's default-privilege posture
remains open.** Passing actual function ACLs and two-user privacy tests do not supply that proof.

Independent reviews challenged the backend, baseline catalog and SQL evidence. This is actual
local schema replay, manual same-image migration execution and a native strict comparator;
it is not Supabase CLI/emulator execution, Auth HTTP, a real Storage service, hosted deployment
or production acceptance. The maintained native generator receipt is
`controller/current-main-rootless-native-manifest-cleanup-corrected.json`; its bound private
provenance is `rootless-replay/native-evidence/integrated-manifest-cleanup-corrected.json`.
The complete SQL warning/failure qualifications remain in `rootless-replay/sql-wave-report.md`.

The current-main execution receipts, raw JSON/logs, seal union, artifact fingerprints and
independent review are retained under the session-local `/workspace/remediation-results/`
`controller/` and `current-main/` directories; rootless provenance is under `rootless-replay/`.
This update is not a new audit score, readiness verdict or task-receipt export. Local acceptance
remains **Blocked** by the retained external conditions and operator proof gap: four privacy/provider
obligations, qualified clinical review, authorised provider evaluation, hosted operational
acceptance and reserved-platform-role default privileges. Calculator and real-staff holds remain. RAG programme history/reconciledBase and
accepted receipts were not reset; materializing this remediation on current main does not
establish fresh formal programme/P00 acceptance or authorise its execution.

## Final acceptance and bounded staging investigation — 2026-10-18

The subsequent complete offline unit/DOM run used genuine npm 11.17.0 and the final actual
catalog. It recorded **32,442 passed, one failed and two skipped out of 32,445**, in
814.648 seconds. The remaining failure was a stale source-shape assertion in
`tests/hosted-migration-role-guard.test.ts`: it expected the former Docker-local
`psql(storageSchemaOwner, scaffoldSql)` call after the shared replay had changed to
`await sql(storageSchemaOwner, inputs.scaffoldSql)`. Only that expectation changed. Dynamic
owner discovery, reserved-role rejection, the immutable historical hash and both replay
transports remain intact. The complete guard and rootless owning files then passed **45/45**
(19 plus 26), and the actual migration-role check passed. This resolves the observed final
failure; it does not relabel the raw complete-suite execution green or assert another full rerun.
Prior application/build/catalog evidence is reused only within its unchanged source scope.

Newly available connectors permitted bounded read-only inspection of Psych Sift Staging
(`ikoiolksxqxfxgiyqpnu`) and the PsychSift Railway staging environment. No credential values,
clinical records or document contents were read. The current app deployment is
`62558e5c7cb6fa2cbc12944093d0d053240cb351`, distinct from this uncommitted candidate. An
existing staging worker was already building; this task neither started nor stopped it. That
state does not meet the isolated tenancy harness's no-worker precondition. Executor provider
credentials and direct HTTP permission are absent; the passive one-hour response-time read
returned no samples. Hosted candidate Auth/Storage, provider-backed RAG, cache/performance
and rollout acceptance therefore remain unverified. Later remote-main changes are not silently
included in the pinned `54559ad` reconciliation.

**SF01 — Staging future-default ACL contract gap (confirmed operational finding, P2).**
For future public objects created by `postgres`, effective defaults deny browser roles but also
lack the required service-role table CRUD, sequence USAGE/SELECT and function EXECUTE.
For the reserved creator, effective defaults grant broad table/sequence/function privileges to
browser roles. Raw catalogs confirm explicit public grants plus built-in global PUBLIC function
EXECUTE. This is evidence about future-object defaults, not proof of existing-object exposure,
production state, a service outage, or a reachable exploit. The connector is non-superuser
`postgres` and cannot administer the reserved creator. Browser roles cannot assume or inherit
`postgres` or `service_role` at the observed time.

A separate, private `staging-postgres-defaults-proposal.sql` restores only the seven required
service privileges on future public objects created by postgres. It contains role/ACL guards,
bounded transaction timeouts and postconditions. A real disposable PostgreSQL 17.6 proof ran
under a nonsuperuser active postgres role: all 45 individual privilege assertions, actual service
CRUD/identity/sequence/function controls, browser operation denials, intended negative guard
failures, mid-transaction rollback, idempotence and unchanged existing/global/non-public/other-
creator sentinels passed. Its owned server stopped successfully and was confirmed stopped.
This synthetic proof does not establish hosted execution or RLS/API acceptance. Independent
source review found no blocking defect for the observed baseline; target binding is an external
operator prerequisite. **The proposal has not been applied.**

The separate reserved-creator repair needs platform authority and a compatibility decision:
a global PUBLIC function revoke affects future functions in every schema and cannot be
replaced by a public-only subtraction. No historical migration was edited/resealed, no reserved
role was granted/assumed, and no live SQL/settings change was made. Exact staging approval
for the postgres proposal would not authorize that broader platform correction or production.

The Notion research/documentation skill was used for bounded project-page discovery. The
two retrieved PsychSift planning pages supplied no qualifying clinical, legal, privacy or provider
approval. This is not proof that no approval exists elsewhere. Existing four privacy/provider
conditions and qualified clinical/staff activation requirements remain pending; safe holds stay.
Cloud runtime and systematic-debugging guidance supported the executed verification;
Supabase and security-fix guidance supported catalog interpretation and the independently
reviewed draft. The security skill's supplemental artifact reference was unavailable after bounded
lookup; existing private artifact conventions were retained. No external task synchronization,
support message, publication, provider spending, merge or deployment occurred.

The private `final-acceptance/` directory contains raw suite output, the 45-case follow-through,
read-only staging catalogs/inventory, exact draft SQL/hash, local proof and independent reviews.
The canonical handoff preserves all 19 original issue IDs and records SF01 separately as a new
staging operational finding. No new quality score is calculated. Overall release acceptance
remains **Blocked** by genuine approval conditions, with hosted and platform conditions visible.

### Approved staging execution — 2026-10-18

The owner answered “Yes approve” to the exact postgres-only SQL proposal and named staging
target. Project metadata freshly confirmed **Psych Sift Staging** (`ikoiolksxqxfxgiyqpnu`),
PostgreSQL engine 17 / Supabase version 17.6.1.147. The approved file's SHA-256 remained
`7226caf7e7ab68c0746cbfd58dab11537fdbd692e51c3aa6bb454f577058dbbd`.
Its bytes, including the original draft comments, were preserved; the separate approval record
supplies execution authority. Fresh preflight rechecked active/session postgres, absence of
reserved-role administration, client role membership and the exact missing-service baseline.

The exact transaction was then executed through the PsychSift account connector against the
explicit staging ref, without a migration/history operation. The SQL operation succeeded.
A separate post-commit catalog read returned **Passed**, with all **eight checks true**:
identity and client roles unchanged; all global/non-public/other-creator defaults unchanged;
existing object ACL/RLS/owner metadata unchanged; browser future privileges denied; exact
required service defaults present; reserved-creator defaults unchanged; and the complete
18-row effective-default matrix retained. The existing-object metadata comparison covered
986 catalog entries with an unchanged fingerprint. No patient/document data was read, and
no hosted synthetic objects were created.

For future public objects created by postgres, service_role now receives exactly table
SELECT/INSERT/UPDATE/DELETE, sequence USAGE/SELECT and function EXECUTE; anon and
authenticated receive none. This closes **SF01 Part A** at the hosted default-catalog layer.
It supersedes the earlier “not applied” status for that part only. The reserved creator's broad
defaults are deliberately unchanged: **SF01 Part B remains open**, requiring platform authority
and a reviewed global/non-public compatibility decision. Existing-object/application/Auth/Storage
behavior is not established by these default-ACL checks. Clinical/privacy holds, provider-backed
RAG and candidate-matched hosted acceptance remain unchanged. Production was not touched.

Approval, exact query/hash, preflight, raw execution result and post-commit evidence are in
the private `final-acceptance/approved-staging-execution/` directory. The local task receipt
and canonical handoff distinguish this approved staging mutation from absent production,
reserved-role, migration, merge and deployment operations.

## Issue disposition

“Implemented” below means local source and regressions exist. Acceptance checks and operational
conditions are listed separately; it never means deployed or clinically approved.

| Audit ID | Local implementation or retained condition                                                                                                                                              | Acceptance boundary                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01      | Account favourites reject stale success, errors, 401 and rollback after identity change.                                                                                                | Actual DOM races and same-account controls; no claim about deployed sessions.                                                                                             |
| F02      | CME removal atomically records exact-object cleanup with the tombstone; retries reuse the obligation. New caller uses versioned RPC.                                                    | Draft SQL, full local schema/manual-chain replay and isolated transaction/rollback tests; real Storage service and hosted acceptance remain pending.                      |
| F03      | Both recovery CLIs share current-lease snapshot/CAS and one atomic recovery RPC. They preserve served artifacts and refuse managed-generation recovery.                                 | Actual two-session PostgreSQL claim/recovery tests plus CLI/helper tests. Old recovery binaries must not be run after SQL deployment.                                     |
| F04      | Roster identifies failed rotation/course-booking sources and retries only the selected failed source.                                                                                   | DOM and hook tests preserve successful data.                                                                                                                              |
| F05      | Upload and fatal-worker diagnostics use fixed classifications and opaque object references. Duplicate cleanup failure is awaited and safely caught.                                     | Actual POST and fatal-worker regressions inspect logs/webhook payloads using invented data. Exact object paths remain in the scoped cleanup queue.                        |
| F06      | Existing four pending/partial privacy release conditions are retained with a concrete evidence handoff.                                                                                 | **External blocker retained.** No engineering test supplies legal/provider approval; see the [handoff](../governance/clinical-release-remediation-handoff-2026-10-17.md). |
| F07      | Physiological bedside tools are withheld pending sourced, accountable clinical review. Dedicated pending inventory and drift contracts added; psychometric tools remain available.      | **Contained, not medically validated.** See the [calculator hold](../governance/physiological-calculator-hold-2026-10-17.md).                                             |
| F08      | Worker rebuild selection includes the model artifact manifest and verifier.                                                                                                             | Isolated watch-selection tests; hosted deploy selection not observed.                                                                                                     |
| F09      | Optional Python 3.12 cloud input/lock resolves compatible Cython and Thinc dependencies.                                                                                                | Native generated lock, clean hash-enforced install, `pip check` and full 61-test native suite passed. Canonical Python 3.11 lock unchanged.                               |
| F10      | Mounted Roster state and pending destructive actions are invalidated on account transition and unmount.                                                                                 | DOM tests cover mounted A→B and legitimate same-account undo/save; already-dispatched A requests cannot be undone by this guard.                                          |
| F11      | Pay requests both complete fortnights, handles history failures/loading and accounts for UTC read boundaries.                                                                           | Actual component prefill and boundary tests; advisory hours only, no payroll transfer.                                                                                    |
| F12      | Open Shifts, cover and Teaching conversions use selected-zone helpers; unchanged Teaching times preserve their instant across ambiguous DST.                                            | Perth/Sydney/fractional-zone and skipped-time tests. No physical-device claim.                                                                                            |
| F13      | Fresh durable scope revisions fence answer/search caches, late writes, shared reads and in-flight coalescing. Same-process epochs remain part of the fence. Missing RPC disables reuse. | Cache/entrypoint regressions, actual scope RPC and ACL probes. Old replicas must be drained; hosted scope-hash cost remains unmeasured.                                   |
| F14      | Teaching locks pairing authority before dependent log/confirmation/note changes, using parent-before-child order.                                                                       | Actual PostgreSQL registrar-edit/supervisor-confirmation orderings plus full local schema/manual-chain replay; hosted acceptance remains separate.                        |
| F15      | The real-staff hospital sick endpoint refuses before creating a reader/admin client when its existing release flag is held. Enabled requests retain auth/rate/role/hospital checks.     | Held/enabled route and actual role-reader tests; enabling remains an approval decision.                                                                                   |
| F16      | SLO runbook names all 12 current alert codes, exact thresholds/filters and operational responses.                                                                                       | Contract tests and source comparison; configured alert delivery is not observed delivery.                                                                                 |

Additional audit leads were resolved within these changes: HY01/HY04 account consumers gained
request fences; HY02 diagnostic prose paths were removed; HY03 Factsheet projections preserve
demo-use/content-month context without changing eligibility; HY05 team moves revoke whole-team
authority transactionally and reject stale grants; HY06 pairing/confirmation orderings are
serialized. HY07 deployed proxy/cache assumptions remain unverified. At the original baseline, the transitive CLI-only
sprintf advisory AD01 had no compatible upstream resolution in that installed Mammoth range;
no application exploit was established and no unsupported override was introduced. The current-main
candidate resolution and its actual installed proof are recorded above.

## Additional defects found during acceptance

- **RF01 — Defunct coordinator owners:** a terminated check left a Linux zombie holding a lease because `kill(pid, 0)` succeeds for unreaped processes. The coordinator now recognizes a terminal process only with evidence that no other threads remain; live/unknown cases stay conservative. Real process fixtures and existing sharing/token checks verify normal admission, with no forced lock deletion.
- **RF02 — Node startup code in the Edge graph:** local `npm run ensure` returned 500 because a negative runtime early return did not stop webpack resolving the Node-only web-push dependency. An explicit positive Node runtime branch now encloses all Node startup imports; production boot guards remain intact. Actual installed-webpack Edge/Node graph regressions accompany the startup retry.
- **RF03 — Sentry conditional export compatibility:** the installed SDK's Node entry exports the conversation convenience setter, while its Edge entry omits it. The wrapper now uses the public isolation-scope setter exposed by both entries and rejects non-UUID syntax. This is not a claim that Node monitoring was broken, or that UUID syntax alone establishes an identifier's provenance. Actual SDK scope tests run without initializing transports.

## Verification and independent review

The controller maintains the exact sanitized execution register, commands, logs, frozen patches,
content hashes and review reports outside the repository at `/workspace/remediation-results/`.
This path is session-local and is not a hosted evidence service. The final exported handoff must
carry those artifacts if another environment needs to reproduce the results.

Independent reviews covered account fences, workflow/time boundaries, clinical holds,
cache/coalescing/RPC scope, database/application compatibility and diagnostic minimization.
Reviewers inspected underlying source and negative/positive controls. Review found and corrected
additional in-flight epoch, UTC-boundary and upload error-prose cases. Agreement is not counted
as separate runtime execution.

Fresh isolated PostgreSQL 17.6 checks passed all 17 scenarios, including execution of the draft
RPC revoke/grant statements against synthetic `anon`, `authenticated` and `service_role` roles.
These use actual current function bodies with reduced fixture dependencies. Two fixture errors
were diagnosed and corrected: a missing parent primary key and Node's truncation of database
microseconds. Failed attempts remain in the evidence register. This is not full-chain migration,
Supabase RLS, real Storage or deployed service-role verification. The owned server was stopped.

Integrated broad/static/build/browser results are recorded in the final local execution register.
A passing targeted test is never represented as a passing full suite. Missing comparison refs,
provider authorization, supported configurations and runtime evidence remain explicit limitations.

## Original-tree broad acceptance results

The complete selected unit/DOM run executed 32,186 cases: **32,171 passed, 13 failed,
and 2 were skipped**. The raw JSON and logs are retained. Failures were traced to omitted
revision-RPC fixtures, a calculator expectation predating the intentional hold, a moved source
anchor, a stale drift manifest, the unsealed new migration and the unavailable genuine
`origin/main` reference. Followthrough runs are separate evidence; they do not rewrite that
full-suite result or establish a green full rerun.

The corrected nonincremental TypeScript check, repository lint, worker build, RAG fixture gate,
Python-lock static gate and all-changed-file format check passed. The static readiness script
passed with a public project-URL configuration fixture and 13 warnings; it made no provider
request and establishes no connected operational readiness. The actual privacy release gate
continues to fail on its four pending/partial obligations.

The calculator followthrough retains the original renderer/input assertions under an isolated,
explicitly synthetic review fixture, adds a real-default release-hold assertion, and passed all
17 owning-file cases. An independent reviewer verified that production governance is unchanged.
The complete clinical source-anchor file also passed after its one moved link was corrected.

The complete three-file RAG fixture followthrough passed **196/196** cases. It first proves
actual local answer/search hits with explicit, faithful fixtures, then verifies governance-change
rejection and all six expected read fences. An independent reviewer accepted the assertions.
Nine of the original 13 unit failures are addressed by complete affected-file passes. Four
remain blocked: drift-manifest freshness, two new-migration sealing cases and genuine
`origin/main` comparison. No unchanged full suite was rerun merely to replace its recorded result.

The isolated production build completed after one diagnosed environment correction: Next's
TypeScript child exhausted its default 4 GB heap, while the repository's normal production build
already supplies inherited `NODE_OPTIONS`. Retrying with that same 8 GB setting completed the
unchanged build and type checking. The running artifact returned the expected project identity
and its actual client bundle passed the repository secret-marker gate. The selected **765-test**
production Chromium suite completed: **764 passed, one skipped, zero failures**. The maintained
iPhone/iPad install-hint case skips this desktop project by platform condition; its underlying
iOS behavior remains unverified here. Both new phone/desktop calculator-hold journeys passed.
The corrected pipeline took 1,468.3 seconds; Playwright reported 21.6 minutes for the tests.
The owned production listener and active browser processes stopped after completion. This uses custom Chromium
153.0.8010.0, explicitly distinguished from Playwright's pinned browser revision.

At the original handoff, genuine local Supabase catalog replay was blocked: the exact pinned image downloaded from the workspace-permitted Docker registry but
failed registration with `no space left on device` under Docker's VFS storage driver. No usable
image, replay container or manifest was created. Unrelated caches and Docker configuration were
preserved. Reduced PostgreSQL proofs do not close this full-catalog condition.

## Acceptance-stage limits

At the original handoff, the default main-branch comparison checks could not resolve
`origin/main` in that checkout. Snapshot
checks against the recorded baseline pass without creating a substitute remote ref. Existing
sealed hashes for all 317 previous migrations are unchanged. The new draft was unsealed at the initial handoff; the 2026-10-18 continuation above records its
specific approval and successful append-only seal. No applied migration or existing hash is rewritten.

Cache changes preserve scoring/comparator order. The Factsheet context correction changes eight
retrieval text hashes; any required provider-backed before/after evaluation evidence remains
unrun and is a deployment acceptance condition, not implied by the offline tests.

## Remaining work and owners

| Owner role                   | Finding or condition         | Next action and acceptance                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository/database owner    | New draft seal               | **Completed 2026-10-18:** exact approved entry preserved; current-main union has 319 seals with no old hash changes. Original-tree 318-entry guard and all 10 owning tests passed. This authorizes no SQL application.                                                                                                      |
| Database/platform maintainer | F02/F03/F13/F14, HY05/HY06   | Local catalog generation, 319-file manual chain, strict parity and five SQL files passed. Retain operator proof for skipped reserved-role default privileges, actual service/Storage and hosted acceptance. No hash-only manifest update or weakened allowlist.                                                             |
| Privacy/service owners       | F06/F15                      | Supply the four genuine provider/privacy decisions and the covered staff-service release decision. The actual release validator must accept the evidence; retain held paths until then.                                                                                                                                     |
| Qualified clinical lead      | F07                          | Establish authoritative formula/source mappings, representative clinical evaluations and accountable dedicated review. Engineering arithmetic and synthetic test fixtures do not authorize restoring bedside advice.                                                                                                        |
| RAG/platform maintainer      | F13, HY03/HY07               | Obtain authority for the provider-backed evaluation pair covering eight text-hash changes; measure scoped revision hashing and complete hit/join paths on representative authorized data; verify deployed proxy/cache assumptions. Drain old replicas and incompatible recovery clients within the approved rollout window. |
| Repository maintainer        | Genuine comparison ref; AD01 | **Current-main candidate prepared:** genuine 54559ad base; original tree preserved. AD01 locally resolved by existing main override, 13 actual installed cases and zero-vulnerability production audit. Formal programme/publication and hosted conditions remain separate.                                                 |

After storage/access/authority is supplied, allow roughly 1–3 hours of engineering verification
for the combined local gates and isolated integration scenarios, assuming reproducible setup and
no new failures. Contractual, provider and clinical review lead times are unknown and excluded.
Only explicitly marked completed conditions in this table are closed by this handoff.

## Required operator sequence

1. Complete local acceptance and independent review on the exact final content, then obtain
   ordinary publication authority separately if desired. Preserve the draft migration's merge gate.
2. Before deployment, obtain specific database-window approval and test full migration replay,
   Storage/RLS behavior and production-role compatibility in an authorized isolated Supabase setup.
3. Stop old recovery CLI executions. Disable legacy RAG cache TTLs and drain old application replicas
   and in-flight requests before relying on revocation. Prefer SQL first, then the matching application;
   app-first missing RPCs intentionally refuse mutations or disable cache reuse.
4. Measure complete-scope hashing on representative authorized data. Typical eligible local answer
   hits now need three revision RPCs and joined waiters two. Keep caches disabled if capacity or
   revocation evidence is insufficient. Do not roll back to an unfenced recovery path.
5. Validate deployed artifact identity, health, bounded account/owner transitions, source revocation,
   cleanup-worker completion, alerts and migration drift/history. Local evidence cannot replace them.
6. Obtain the actual privacy/provider/legal decisions and named clinical review before any covered
   clinical production activation. Do not remove the calculator/staff holds to make acceptance pass.

Canonical task reconciliation remains unavailable/unperformed. A sanitized local receipt reuses
`psychsift-repository-audit-2026-10-17-b0edabf0`; local completion, user acceptance, publication,
release approval and deployment remain distinct.

## Original-tree final local handoff status

This section records the original-tree export; the current-main candidate results above are
a subsequent snapshot. All four planned review waves are complete. Local implementation and the available selected
verification are recorded; **local acceptance and clinical production readiness remain Blocked**
by the explicit conditions above. Completing this engineering handoff does not close those
conditions or assert that every original issue is fully resolved.

The local-only canonical receipt exported successfully with status **Blocked**. Its stable task
identity is unchanged, and no external synchronization occurred. The final machine-readable
handoff validates all 19 issue records, evidence links, 87 frozen implementation paths, actual
test counts and the append-only approved migration seal. The private source patch preserves the full
uncommitted diff. The final production pipeline ran for 24.5 minutes, including build/type
checking; the test phase reported 21.6 minutes. Four review waves were planned and completed,
with no explicit user time cap. Earlier audit time is excluded from these verification figures.
