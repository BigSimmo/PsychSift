# Backend audit: local remediation and remaining acceptance

Recorded 5 November 2026. Implementation source: `33f6478c63aedf9c2d79effd9890951035f552b2`; original audit: `c92e78113abd936c53f88e7e069b2c7331c735a2`. This packet records local corrections and remaining work. Merge, deployment, live SQL, paid provider execution and specialist approvals are separate.

The audit classified 67 dispositions: 19 original findings, 3 later repository observations and 45 followups. They include defects, supported risks, improvements, intentional constraints and acceptance gaps. They are not 67 new software bugs. All disposition IDs appear in the crosswalk below.

The code changes prevent delayed private callbacks crossing account boundaries, preserve generation evidence during document maintenance, purge all 17 private SQL representations on future permanent deletions, enforce coherent CPD/Teaching/hospital transitions, guard stale OnCall attestation, bound Clinical Ask requests and correct monitoring/recovery/build tools. New source admission remains unavailable and explicitly refuses before persistence. Eight new forward migrations are drafted: the original seven plus `20261107000800_audit_fix_maintenance_snapshot_fence_aliases.sql`, which corrects the maintenance snapshot fences in the fourth; all 349 historical migrations remain unchanged. No ranking thresholds, clinical fixtures or activation holds were weakened.

## Verification and limits

- Four completed native unit partitions: 2,152 actual files; 34,453 passed, zero failures, two existing conditional skips. This is earlier evidence, not a full rerun on the final dependency graph.
- Subsequent commit-phase and build corrections passed 94 and 47 affected cases. Final dependency changes passed 203 tests across 15 affected files, whole lint/typecheck, normal production and isolated browser builds, and both output marker scans. Latest overlapping per-file evidence yields 34,459 passes and two skips; it is a controller reconciliation, not a fabricated native full-run report.
- Real PostgreSQL roles, policies, transactions and lock contention: fresh-seven/upgrade parity has151 public tables,382 functions and59 private objects. That parity evidence predates the eighth migration and has not been rerun with it. Original bare-image history fails at existing SF01; a separately stronger baseline executes the remainder conditionally. Faithful pinned CLI/journal and hosted acceptance remain open.
- Actual small synthetic6.28MB database/Vault restore and18 local object bytes pass fingerprints/SHA checks. This does not establish hosted Auth/StorageHTTP or production RPO/RTO.
- Native dependency-consumer probes:32 matching before/after cases plus6 glob/rimraf controls; patched follow-redirects has confined loopback negative/positive proof. The three returned installed NPM candidates are patched. This is not a vulnerability-free or bundled-CodSpeed certification.
- Six current Chromium151 guest scenarios pass at desktop/phone widths, including Escape/focus restoration; no page exceptions/overflow/unexpected external or mutation requests. Required Chromium156 download remains blocked. Real Auth, installed PWA, physical Safari and accessibility conformance are separate.
- Detailed sanitised local evidence remains in the owner review package; no credentials, private logs, model weights or production backup are published in this packet.

## Task authority and deduplication

[Canonical PsychSift task ledger](https://app.notion.com/p/3ec7889e8a2281e4bab9ca667a2a76df) owns lifecycle/blocker/next action. Repository issue history uses [the immutable inbox](outstanding-issues-inbox/README.md); this branch does not edit [the protected canonical ledger](outstanding-issues.md). Seventeen validated requests comprise10new proposals,6existing updates and1update targeting the existing SF01 pending-add identity. Two existing packages are reused. Existing owner decisions, pending requests and unrelated canonical tasks are preserved. Reconciliation occurs only after this PR lands, on its dedicated fresh-main transaction.

## Remaining work packages

### ROLLOUT — Review and safely roll out the audited app/worker fixes and eight draft migrations

Repository: #36XZRQ. [Immutable request](outstanding-issues-inbox/dd15ac8c-3ea7-4b63-ad95-deae8c36faa8.json). State: Needs you. Suggested owner: Delivery + Database + owner.

Blocker: Local corrections are committed and checked; target deployment, supported CLI/journal replay and old/new fleet acceptance are unverified. Opening a PR does not authorize merge, live SQL or deployment.

Next action: Review candidate PR and all eight immutable forward drafts (including `20261107000800_audit_fix_maintenance_snapshot_fence_aliases.sql`), rerun parity/replay with the eighth, verify exact target/project/default-ACL prerequisites, rehearse supported replay and mixed versions, quiesce old maintenance/unconditional verification handlers; obtain separate rollout authority.

Acceptance: Correct owner/role validation, actual hosted RPC contracts, private drift coverage, malformed historical booking timestamp preflight, stale/concurrent mutation refusal, calendar rollover and versioned-client failure behavior; no old unsafe writer persists. No protected clinical content/flags/history edits.

### ADMISSION — Define authenticated provenance admission before restoring new backend document intake

Repository: #QQ29E9. [Immutable request](outstanding-issues-inbox/7f71bf93-fd2d-4969-ab2c-77f32fd16a94.json). State: Needs you. Suggested owner: Source intake + Security + owner.

Blocker: admit_backend_document is absent; existing admitted resume/force is repaired, new intake now refuses before bytes/writes. Roles/source classes/provenance/review contract is not settled.

Next action: Owner defines admission authority per source class and mandatory review/provenance; implement atomic idempotent backend admission and entry-point negative/retry tests before enabling new intake.

Acceptance: No persisted bytes/job orphan on refusal or partial failure; authenticated owner/resource authority and provenance enforced at durable writer; retries reconcile one intent. Preserve upload-local/rights/scanner/reindex holds.

### READ_POLICY — Set private-read and independent bearer/feed revocation semantics

Repository: #6WD257. [Immutable request](outstanding-issues-inbox/3871a4f5-fd70-4ebe-a62f-c516271fda12.json). State: Needs you. Suggested owner: Identity + product owner.

Blocker: Immediate private GET revocation policy remains unsettled; established verified-token read fast path and separately issued bearer/feed scope/expiry remain intentional constraints.

Next action: Specify which private reads need live account bans/revocation, freshness bounds and behavior for independently issued feed/signed credentials; then implement and verify only the selected policy.

Acceptance: Real Auth two-user expired/revoked/blocked/session-refresh tests match documented policy across HTTP/cache/export/feed paths. Do not equate sign-out with automatic revocation of every independent credential.

### AUDIO — Choose and enforce a trusted server decoded-audio duration limit

Repository: #6909Z0. [Immutable request](outstanding-issues-inbox/044a35cd-2e56-455b-b742-cfab7318f11b.json). State: Needs you. Suggested owner: API + Delivery + product owner.

Blocker: 120second synthetic WAV reaches mocked provider with absent/forged duration metadata. Byte/rate caps exist; no trusted duration cap across accepted compressed formats or declared decoder/runtime contract.

Next action: Choose supported duration/formats and bounded trusted decoder; verify package/image supply chain and time/memory limits before enforcing decoded duration.

Acceptance: Actual synthetic accepted-format boundary, forged metadata, malformed/oversized/decompression/cancellation and decoder failure tests refuse safely before provider work. No WAV-only or client-metadata substitute.

### DEPENDENCY_IMAGE — Worker image dependency acceptance: retain advisory policy and validate the Pillow/Docling security upgrade

Repository: #CK9GBW. [Immutable request](outstanding-issues-inbox/b7a42470-1b20-402c-a85e-d255fd6e6d87.json). State: Blocked. Suggested owner: Extraction + Delivery/security owner.

Blocker: Current Docling2.139 caps Pillow<13; candidate2.142 permits13 but model/dependency/image compatibility is not verified. Python3.11 works; one new host-root probe meets proxyCONNECT403, earlier per-model errors remain individually unclassified.

Next action: Append current source facts to #CK9GBW while preserving its24finding history and2December policy. Establish permitted artifact route and actual resource bounds, regenerate hash-correct candidate lock/model tree, run real raster-PDF/OCR and image assessment.

Acceptance: No guessed hashes/model identities, suppression expiry renewal, scan threshold change or clinical activation. Exact candidate runtime/models/normal image controls pass and fresh accepted/advisory applicability is recorded.

### DATA_LIFECYCLE — Complete historic evidence retention and deletion across derived stores and replay paths

Repository: #YK1BX8. [Immutable request](outstanding-issues-inbox/8901d677-1944-492b-b471-21b2e68a98cc.json). State: Needs you. Suggested owner: Data + privacy owner + operations.

Blocker: Prospective permanent deletion now purges17private SQL representations, but historic orphan/abandoned evidence, StorageHTTP removal, worker/queue replay, backups and legal-hold treatment are unverified. No live occupancy/sweep was performed.

Next action: Agree retention/legal holds and run read-only synthetic-target inventory; design owner-approved cleanup/reconciliation and deletion reapplication after restore.

Acceptance: Actual isolated Auth/Storage/worker deletion removes only intended owner data and derivatives; delayed jobs/reindex/restore cannot resurrect or disclose deleted records; legitimate retention is explicit. No live sweep is authorized by task logging.

### WORKER_RECOVERY — Verify worker parser isolation and crash/retry/ambiguous-ack recovery on an isolated stack

Repository: #QD32S0. [Immutable request](outstanding-issues-inbox/539e7e69-ea40-4964-957c-d5930fffb77f.json). State: Blocked. Suggested owner: Workers + Database + integrations + Delivery.

Blocker: Actual SQL claims/fencing/rollback pass, but full process crash around external effects and acknowledgement, retries, revocation/deletion replay, parser OS/network isolation and cancellation are not established.

Next action: Prepare owned isolated real-stack fixtures with fault injection and bounded provider test contracts; inspect target/side effects/cost before any provider-backed run.

Acceptance: Crash at durable write/external acceptance/ack boundaries; duplicates/out-of-order/revoked owner/stale lease/delete-replay produce intended effects only, bounded retries/cost and diagnosable state. Env stripping/offline flags are not an OS sandbox.

### STAGING_AUTH — Obtain exact-candidate two-user Auth/HTTP ownership and account-switch proof

Repository: #F9HZEG. [Immutable request](outstanding-issues-inbox/dce12b53-ef7e-44b1-94ff-98a6ed9fe36a.json). State: Blocked. Suggested owner: Identity + app/Teaching owners + staging operator.

Blocker: Component/SQL roles are strong local evidence; six guest flows do not exercise real Auth/JWT/HTTP ownership or two signed-in identities. Existing staging rebuild/SHA alignment gap remains.

Next action: Append audit acceptance to #F9HZEG, retaining existing staging blocker; use exact deployed candidate and two synthetic users/roles to exercise delayed account switch, stale/refused mutations and privileged/anonymous/cross-owner paths.

Acceptance: Identity/deployedSHA verified; same-owner success, other-owner/nonexistent/anonymous/denied role refusal, stale callbacks/cache/exports after switch/revocation tested at enforcement owner. No success credited from tolerated scheduled failure.

### RECOVERY — Complete hosted-service recovery acceptance; small synthetic database/local-byte restore now passes

Repository: #QVVS6W. [Immutable request](outstanding-issues-inbox/a3ff5894-2b9a-4589-ac74-224bbf68469b.json). State: Blocked. Suggested owner: Operations + Database + owner.

Blocker: New6.28MB synthetic restore matches17private fingerprints/Vault/CPD and18local object bytes, but hosted Auth/StorageHTTP, production backup, lost-key and production RPO/RTO remain unverified.

Next action: Update #QVVS6W title/detail with exact narrow new proof, preserving original plan; schedule separately approved isolated full-service restore, roll forward final migrations and reapply deletion policy.

Acceptance: Verified target; restored sign-in/session/storage bytes/download and core workflows usable with owner/other-owner controls; measured time/data loss and cleanup recorded. Preserve accepted ~24hour RPO decision rather than re-opening paid PITR.

### SOAK_CAPACITY — Complete SHA-bound staging soak, mixed-version rollback and representative capacity/cost evidence

Repository: #057. [Immutable request](outstanding-issues-inbox/869ecf69-784e-4124-94a7-8243083eda15.json). State: Blocked. Suggested owner: Delivery + performance owner + operator.

Blocker: The local small fixtures/build timings are not representative capacity/cost proof. Existing #057 staging deployment alignment/soak/rollback remains pending.

Next action: Append tested-boundary gaps to #057 and reuse #H69FNZ for hydration attribution; on approved isolated candidate disclose synthetic dataset, concurrency, caches, resource/cost caps and sampling before bounded measurements.

Acceptance: Meaningful latency/error distributions/sample counts; no silent lost writes, starvation or unbounded fanout/retries/cancellation work; old/new fleet rollback compatible and observed. Distinguish public metadata/free setup from billable provider work.

### OPS_MONITOR — Verify deployed failure and recurring-error visibility under the daily health-summary policy

Repository: #5EQXXF. [Immutable request](outstanding-issues-inbox/ebe37fb2-e909-4748-8af9-088ac635e90f.json). State: Blocked. Suggested owner: Delivery + operations owner.

Blocker: False-green monitor summary is repaired locally; current deployed notification delivery, recurring Sentry-group coverage and release-correlated diagnosis remain unverified. New-group webhook semantics alone do not prove recurrence detection.

Next action: Verify exact current app/worker/release selectors and alert configuration, then use approved harmless synthetic failures to prove failed/delayed/partial/recurrent operations reach the existing daily digest and operator.

Acceptance: A known failed/unavailable run never renders healthy; recurrence is visible under the agreed7amPerth digest policy; diagnosis links request/job/release without sensitive payloads. Do not enable parked sourcemap uploads or send real notifications without separate authority.

### DEPLOY_POLICY — Verify actual deployment gate and preserve the approved Wait for CI policy

Repository: #HYSWAF. State: Needs you. Suggested owner: Owner + Delivery.

Blocker: Existing owner decision is Wait for CI OFF until a narrower safe gate; current provider settings were not read.

Next action: Reuse #HYSWAF and verify current app/worker selectors/settings with applicable authority; do not ask the owner to decide the same OFF policy again.

Acceptance: Record actual selectors/deployment/check identities; any narrower gate change is separately approved. No blanket enable-WaitForCI task.

### SCHEMA_PLATFORM — Supabase support: assess reserved-creator schema and global default-privilege prerequisites

Repository: #MXHK8F. [Immutable request](outstanding-issues-inbox/d32690bf-8a80-4582-9d5c-b06e17badb64.json). State: Blocked. Suggested owner: Supabase platform owner + Database.

Blocker: Existing support task is already pending and owner-deferred. Isolated bare-image replay additionally shows globalPUBLICfunction default cannot be subtracted by per-schema revoke; hosted global state was not read.

Next action: Append the new isolated global-default diagnosis to the existing pending add via targetUlid; preserve its original owner support deferral and schema-specific facts. Have platform owner inspect namespace0/global and schema ACLs before proposing broader changes.

Acceptance: Original143payload success/144thSF01 failure retained; stronger synthetic continuation is conditional, not faithful CLI/hosted replay. Any global correction is platform-approved with cross-schema compatibility review; no reserved-role escalation/history repair/allowlist widening.

### PINNED_BROWSER — Complete pinned browser/UI acceptance; current Chromium151 demo evidence is exploratory

Repository: #WR6FAW. [Immutable request](outstanding-issues-inbox/e1ca65c7-e74e-4abb-8c42-f9e1a5c5932b.json). State: Blocked. Suggested owner: Delivery + test environment owner.

Blocker: Playwright1.64.1 requiresChromium156revision1248; official download403. Six currentChromium151guest flows pass, but historical three-failure floor belongs to an older host/browser and is not independently established here.

Next action: Append current source/runtime evidence to #WR6FAW and link existing #PM71Z1/pending host update rather than another competing mutation; obtain official pinned runtime on a permitted host and run unchanged selected UI gates.

Acceptance: Exact candidate/build/session/role/browser identity; required pinned proof passes without changing assertions, pins or host security. Do not infer physical Safari/PWA/Auth/conformance from151emulation.

### PHYSICAL_DEVICE — Complete physical iPhone Safari and installed-PWA microphone/task acceptance

Repository: #93E7YJ. [Immutable request](outstanding-issues-inbox/b3044672-a6dd-4bfa-81ad-a057b7c0b810.json). State: Blocked. Suggested owner: Product/device tester + clinical owner.

Blocker: No physical device/assistive-technology/installed-PWA acceptance occurred. Chromium viewport flows do not establish Safari microphone, software keyboard, offline lifecycle or assistive conformance.

Next action: Use synthetic inputs on an approved exact build; test actual iPhone Safari and installedPWA with permission/error/interruption/keyboard/overlay/focus/account-switch states.

Acceptance: Record hardware/OS/build/config and user roles; microphone consent/interruption/cancellation and task recovery work with no sensitive data or downstream cost outside approved scope. Keep conformance claims proportional.

### PRIVACY — Close already-tracked privacy provider, legal and clinical approvals

Repository: #BS3SN9, #XJ3N16. State: Needs you. Suggested owner: Owner + privacy/legal/clinical specialists.

Blocker: ZDR/project coverage, APP8, APP1/5 notices, PHI minimisation and contractual retention/region remain owner/specialist evidence. Source/tests cannot approve these.

Next action: Reuse #BS3SN9 and #XJ3N16 plus pending adviser/DPA records; attach audit crosswalk without duplicating or re-signing approvals or replacing existing drafts.

Acceptance: Dated project-specific provider/contracts and qualified adviser/clinical approvals recorded; existing no-identifiable-patient-data/launch holds preserved. No inference from environment strings or test pass.

### CLINICAL_RELEASE — Run exact-candidate release acceptance with remaining Clinical Ask seven-mode readiness evidence

Repository: #055. [Immutable request](outstanding-issues-inbox/a9bb0fe1-8342-4f9b-8189-b16ec08d9eb5.json). State: Needs you. Suggested owner: Owner + clinical authority + release operator.

Blocker: Existing #055 release gate is open. Deployed mode/flag/transcription/feedback-schema state, named clinical authority, seven-mode evaluation and protected staging canary are not established by deterministic offline checks.

Next action: Append L01-L05 acceptance to #055, preserve existing cross-browser/CI/review requirements and #TXVBAZ accepted diagnosis/treatment constraints. Obtain only the missing specific approvals/bounded evaluation authority.

Acceptance: Exact SHA/mode/config/provider-target evidence, real feedback migration presence, dated clinical authority, seven-mode usefulness/safety evaluation and approved canary meet unchanged gates. No flags/content/ranking/protected fixture changes or forged approvals.

### SECURITY_WORKFLOW — Record remaining specialised security-workflow acceptance when supported capability is available

Repository: #6PT217. [Immutable request](outstanding-issues-inbox/ef7c5dcf-1145-4611-81a6-f10784c2f6e6.json). State: Blocked. Suggested owner: Security owner.

Blocker: Required referenced Codex Security core/preflight capability was unavailable; no branded scan was registered or completed. Native threat/source/runtime review is separate valid evidence.

Next action: Assess whether a supported specialised workflow adds material assurance; if selected, verify prerequisites/target and bounded runtime/spend before one canonical scan. Otherwise retain explicit native-review scope and unavailable-branded evidence.

Acceptance: No fabricated canonical artifacts/equivalence or duplicate uncertain scans; any chargeable run has separately approved total/cap. This is an assurance recommendation, not a confirmed software vulnerability.

### WINDOWS_MAINTENANCE — Complete remaining Windows document-copy and dependency-consumer acceptance

Repository: #S1N8RH. [Immutable request](outstanding-issues-inbox/984893be-f977-4951-b1b3-029155589c8b.json). State: Blocked. Suggested owner: Developer tooling + Windows test owner.

Blocker: POSIX0700/0600copies and Linux32consumer cases pass. Windows ACL/path behavior, aggregate preparation peak memory and retained-history disk are outside that proof; scoped overrides and CodSpeed bundle qualification need maintenance.

Next action: On actual supported Windows/Node24, verify copied-document ACL audience and the bounded native consumer matrix. Measure aggregate resource/history behavior before choosing optional additional limits; review/remove overrides as upstream adopts fixed compatibility.

Acceptance: No private ACL broadening or unsafe existing-workspace repair; patterns/ignore/skip and owned deletion keep correct Windows paths; source preserved. Avoid claiming a proven Windows bug or arbitrary-pattern safety. CodSpeed bundle remains a qualification unless actual vulnerable reach is established.

## Complete audit-disposition crosswalk

A local correction awaiting rollout maps to its rollout/integration package. Intentional or fully verified local constraints do not become new defects.

- **ACCESS-01** — Late On Call mutation callbacks restore prior-account private entries after an auth transition. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, STAGING_AUTH.
- **ING-RAG-01** — Alternate intake and maintenance writers delete current index evidence before replacement is durable. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, WORKER_RECOVERY.
- **ACCESS-02** — Generation POSTs using optional authentication omit live blocked-account checks. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, STAGING_AUTH.
- **ACCESS-03** — Confirmation POST parses unrestricted form body before same-origin rejection. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, STAGING_AUTH.
- **DATA-01** — Permanent document deletion retains complete original bytes in private ingestion evidence. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, DATA_LIFECYCLE.
- **DATA-02** — Recurring schema drift inventory excludes private ingestion integrity controls. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, SCHEMA_PLATFORM.
- **DEL-01** — Fresh failed monitoring runs can be rendered healthy in the daily health summary. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, OPS_MONITOR.
- **DEL-02** — Storage recovery acceptance checks metadata rather than recovered object bytes. byte verifier corrected and synthetic database/local-byte recovery passed. Remaining: RECOVERY.
- **DP-01** — Closing CPD year can freeze requirement statuses from a different record. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, STAGING_AUTH.
- **DP-02** — Calendar feed loses previous year's March reporting deadline at January rollover. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, STAGING_AUTH.
- **DP-03** — Late On Call list response overwrites a newer successful mutation. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, STAGING_AUTH.
- **DP-04** — Closed-year CPD log offers copied-state updates that database always rejects. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, STAGING_AUTH.
- **EXT-ROLES-JOBS-01** — A stale hospital selection commits a team link to an archived hospital before returning 403. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, STAGING_AUTH.
- **EXT-ROLES-JOBS-02** — Legacy enrichment metadata writes can restore an obsolete committed generation pointer. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, WORKER_RECOVERY.
- **EXT-STREAM-01** — Clinical Ask dispatches a question cancelled before lazy client initialization. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, WORKER_RECOVERY.
- **EXT-STREAM-02** — Clinical Ask external search bypasses the common output ceiling and has no explicit tool-call budget. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, WORKER_RECOVERY.
- **ING-RAG-02** — Bulk import cannot recover a document persisted before its job insert fails. partly resolved; unsupported new admission explicitly refused. Remaining: ADMISSION.
- **ING-RAG-03** — Clinical Ask section headings bypass deterministic draft governance. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, CLINICAL_RELEASE.
- **EXT-STREAM-03** — Roster calendar fetch ten-second total deadline does not cover DNS observation. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: ROLLOUT, WORKER_RECOVERY.
- **RD-01** — Document draft copies broaden private POSIX file permissions under ordinary umask. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: WINDOWS_MAINTENANCE.
- **RD-02** — Document size rejection follows an unbounded per-file read. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: WINDOWS_MAINTENANCE.
- **DEL-03** — Isolated browser build loses its declared heap budget at the TypeScript child boundary. local correction committed; see scoped verification and remaining hosted acceptance. Remaining: PINNED_BROWSER.
- **F01** — Private GET account freshness. unsettled policy. Remaining: READ_POLICY.
- **F02** — Independent bearer/feed revocation semantics. unsettled policy. Remaining: READ_POLICY.
- **F03** — EPA history older than fifty. implemented locally. Remaining: ROLLOUT, STAGING_AUTH.
- **F04** — EPA pending-link concurrency cap. verified local engine. Remaining: ROLLOUT, STAGING_AUTH.
- **F05** — Registry metadata stale replacement. implemented locally. Remaining: ROLLOUT, WORKER_RECOVERY.
- **F06** — Malformed/mixed-version OnCall responses. verified component contracts. Remaining: ROLLOUT, STAGING_AUTH.
- **F07** — Ordinary CPD stale full edits. verified local engine. Remaining: ROLLOUT, STAGING_AUTH.
- **F08** — Trusted decoded speech-duration cap. supported cost-control gap; policy pending. Remaining: AUDIO.
- **F09** — Pre-abort orchestration rejection ownership. implemented locally. Remaining: ROLLOUT, WORKER_RECOVERY.
- **F10** — CME eager101-year fanout. implemented locally. Remaining: SOAK_CAPACITY.
- **F11** — Supervisor double full-history payload. verified local engine. Remaining: ROLLOUT, SOAK_CAPACITY.
- **R01** — Seven accepted Pillow advisories. supported unresolved dependency risk. Remaining: DEPENDENCY_IMAGE.
- **R02** — Shadow parser environment and isolation. partly resolved. Remaining: WORKER_RECOVERY.
- **R03** — Suppression expiry and scan blocking policy. intentional policy plus review need. Remaining: DEPENDENCY_IMAGE.
- **R04** — WaitForCI and independent release approval policy. intentional policy; live state unverified. Remaining: DEPLOY_POLICY.
- **R05** — Report-only migration boot default. intentional operating mode. Remaining: ROLLOUT.
- **R06** — Sentry recurring-error detection. supported operational gap. Remaining: OPS_MONITOR.
- **R07** — Reserved-creator global future-function default ACL (existing SF01). confirmed isolated replay blocker; hosted state unverified. Remaining: SCHEMA_PLATFORM, ROLLOUT.
- **R08** — Public NPM advisory candidates and bundled dev code. all3inspectedinstalledcandidates corrected; currentgraphgatespass. Remaining: WINDOWS_MAINTENANCE.
- **V01** — Full schema and migration replay. final-seven parity (predates the eighth migration); conditional historical SQL execution. Remaining: SCHEMA_PLATFORM, ROLLOUT.
- **V02** — Actual role/RLS enforcement. substantially strengthened. Remaining: STAGING_AUTH.
- **V03** — Real browser account switch. unverified integration boundary. Remaining: STAGING_AUTH.
- **V04** — Durable primary end-to-end workflow. partially covered. Remaining: WORKER_RECOVERY.
- **V05** — Crash/retry/acknowledgement recovery. partially covered. Remaining: WORKER_RECOVERY.
- **V06** — Deletion across all stores. partially covered. Remaining: DATA_LIFECYCLE, RECOVERY.
- **V07** — Mixed version deployment. partially covered. Remaining: ROLLOUT.
- **V08** — Full synthetic backup restore. verified small isolated exercise; hosted recovery open. Remaining: RECOVERY.
- **V09** — Real provider delivery/cancellation/billing. unverified provider boundary. Remaining: WORKER_RECOVERY.
- **V10** — Physical device and installed PWA behavior. unverified physical boundary. Remaining: PHYSICAL_DEVICE.
- **V11** — Representative capacity and cost. unverified capacity guarantee. Remaining: SOAK_CAPACITY.
- **V12** — Normal locked dependency installation. verified local setup. Remaining: No new task: verified local setup strength; keep evidence and do not invent install debt..
- **V13** — Offline readiness profile. verified local structure. Remaining: CLINICAL_RELEASE.
- **V14** — Alternate Next build output scan. corrected locally. Remaining: PINNED_BROWSER.
- **V15** — Branded Codex Security scan. unavailable capability. Remaining: SECURITY_WORKFLOW.
- **G01** — OpenAI ZDR endpoint/project coverage. owner/provider evidence required. Remaining: PRIVACY.
- **G02** — APP8 cross-border basis. owner/legal evidence required. Remaining: PRIVACY.
- **G03** — APP1/APP5 notices. owner/legal evidence required. Remaining: PRIVACY.
- **G04** — PHI minimisation closeout. partially implemented; approval gap. Remaining: PRIVACY.
- **L01** — Clinical Ask deployed flags/modes/transcription. not a local-code defect. Remaining: CLINICAL_RELEASE.
- **L02** — Hosted feedback migration. hosted evidence required. Remaining: ROLLOUT.
- **L03** — Clinical authority approval. owner/specialist action required. Remaining: CLINICAL_RELEASE.
- **L04** — Seven-mode clinical evaluation. domain validation required. Remaining: CLINICAL_RELEASE.
- **L05** — Protected staging canary. bounded approval and environment required. Remaining: CLINICAL_RELEASE.
- **L06** — Contractual retention/region. provider/legal evidence required. Remaining: PRIVACY.
- **L07** — Physical iPhone acceptance. physical test capability required. Remaining: PHYSICAL_DEVICE.

## Compatibility and rollout

Review all eight draft migrations, including the snapshot-fence correction, against the exact target before any merge. Plan schema/app/worker ordering and drain old maintenance and unconditional verification handlers. New versioned RPCs fail closed when missing; older clients can require refresh. Inspect historical timestamp validity before typed overlap queries. The SF01 global-default prerequisite needs platform ownership and cross-schema review. Restore must roll forward to the intended release and reapply retention/deletion policy. Preserve the existing Wait for CI decision and all privacy, source-rights, scanner, canary and specialist holds.

The two remaining product policy decisions are trusted decoded-audio duration and immediate private-read revocation scope; source-admission authority/provenance is an additional unresolved contract. No answer, approval or provider allowance is inferred from publishing this packet.
