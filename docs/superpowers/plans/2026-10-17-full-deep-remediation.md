# Full Deep Audit Remediation Implementation Plan

> **For agentic workers:** Use the approved parallel subagent method in this plan, with the repository's instruction hierarchy and shared-check coordinator. Do not recursively delegate or publish changes.

**Goal:** Correct the audit's reproducible defects, investigate retained leads, and preserve explicit clinical/privacy/release conditions that code cannot legitimately approve.

**Architecture:** Six isolated implementation lanes share one pinned baseline and disjoint file ownership. The controller integrates patches in dependency order, owns expensive/shared checks, and assigns independent review to stable integrated changes. Existing APIs, owner/role checks, clinical safeguards and current lease protocols remain authoritative.

**Tech Stack:** Node 24/npm 11, Next 16/React 19, TypeScript 6, Vitest 5, PostgreSQL/Supabase SQL, Python worker locks.

**Spec:** `docs/audit/2026-10-17-full-deep-remediation-spec.md`.

## Global constraints

- Original baseline `b0edabf0b73a806535aa3289e5de8023cf39997f`; root integration checkout `/workspace/PsychSift`, initial branch `work`, initially clean source. The separately authorised current-main candidate and later evidence are recorded below.
- Agent worktrees: `/workspace/psychsift-remediation/{identity,workflows,cache,database,clinical,delivery}`. No agent edits another worktree or the integration checkout.
- One file writer. Database lane alone owns `supabase/schema.sql` and draft migrations. Lead owns organisation-map integration, issue-inbox metadata, plan/receipt and final verification.
- Application fixes are authorised; production/provider actions, approval fabrication, push/merge/deployment and commits are not part of this implementation stage. Keep recoverable local patches/checkpoints.
- No relaxed tests, auth, RLS, source governance, query boundaries, clinical safety or release conditions. Do not edit applied migrations or reseal migration hashes.
- Read root instructions, relevant local instructions and installed Next documentation before editing Next code. RAG protected-surface notification has been issued; no ranking comparator/prompt/evaluation rewrite.
- Reuse attributable baseline evidence for unchanged code. New regression tests must fail against baseline for the intended reason, then pass after correction.
- The controller runs all suites/install/build commands in sequence unless it explicitly grants one of the coordinator's two focused leases. Agents prepare test commands and fixtures without starting shared checks unannounced.
- No new dependency or lock installation during active repository checks. Inspect hooks before setup. No permanent watchers or other-project server changes.

## Review focus

1. An old account's success, failure, rollback, queued write or timer must not affect the next account; identity tests cover each owning lane's live consumer.
2. A revocation or lost response must not leave clinical evidence cache-valid or private bytes without durable cleanup intent; actual SQL/cache tests cover returned-error and process-interruption boundaries.
3. Concurrent identity/lease changes must linearize with dependent writes; database tests cover both orderings and ownership loss.
4. Unsupported/missing clinical approvals must remain unavailable rather than be inferred from tests or copy changes; clinical lane tests gate exposed dose advice and staff projections.
5. Dates and instants must round-trip through selected zones, full pay intervals and DST boundaries; workflow regressions cover Sydney/Perth and fractional-offset zones.

## Parallel waves and shared interfaces

Wave 1: lanes investigate and prepare regression tests on the baseline; lead schedules red runs. Wave 2: all six implement disjoint fixes; controller runs focused green checks and integrates stable patches. Wave 3: independent reviewers inspect critical integrated changes and challenge negative/positive controls. Wave 4: one coordinated broad offline verification, source/build/domain checks, closure ledger and handoff.

Existing public hook/component/repository exports stay compatible unless the implementing lane records a necessary interface change before editing consumers. Any new SQL RPC/schema dependency is handed to the database lane and integrated before its TypeScript consumer. No speculative cross-lane API is assumed.

## Lane A — Account state and delayed effects (`identity`)

**Owns:** F01, F10; investigate HY01/HY04. Existing `src/components/account-data-provider.tsx`, `src/components/roster/use-roster-settings.ts`, `use-roster-shifts.ts`, `roster-settings-page.tsx`, related user-scoped Roster hooks and identity regressions. Admin pay screen belongs to lane B.

- [x] Reproduce late favourite membership success, stale error/401/rollback, direct mounted A→existing-B Roster settings/shifts, and A's pending delete under B.
- [x] Read current AuthProvider epoch/event/reset contracts and working Teaching request guards; preserve hook signatures and same-account queues/undo.
- [x] Fence accepted state, request completions and queued/timed effects by captured/current identity; cancel pending deletion before dispatch after a switch.
- [x] Investigate additional live Admin/leave/share consumers; prove or reject each lead rather than infer failure from a pattern.
- [x] Add maintained regressions from the actual-module audit probes plus positive same-account/repeated-write controls; provide exact focused commands.

Acceptance: B never displays/commits A state; no A delayed destructive intent dispatches under B; stale A failures cannot expire B; same-account save/undo remains correct. No server owner-filter relaxation.

## Lane B — Work dates, pay completeness and truthful feedback (`workflows`)

**Owns:** F04, F11, F12. `src/components/roster/roster-month-page.tsx` and merged-source presentation, `src/components/work-screens/admin/pay-page.tsx`, date-range caller contracts, `src/lib/open-shifts/{mine,posted}.ts`, `src/components/teaching/organise-model.ts`, relevant cover/time conversions and tests. Do not edit lane A's shared Roster hooks without handoff.

- [x] Add failing component test for two 8-hour shifts on 22/28 September with 17 October 2026 now: preceding full fortnight must prefill 16, not 8 hours.
- [x] Request explicit date coverage for all displayed pay periods using existing hook options; preserve custom fortnight anchors and advisory-only payroll copy.
- [x] Add failing Sydney tests: midnight–08:00 counts 8 hours; outside seven local days excluded; room-only Teaching edit preserves exact instant.
- [x] Use existing selected-zone conversions and test Perth, Sydney daylight/standard time, fractional offset and invalid DST input where supported. Trace additional fixed offsets before changing intentional jurisdiction logic.
- [x] Add failed rotation/course-booking warning and targeted retry while preserving successful data and truthful empty/loading states.

Acceptance: date/instant and completeness contracts hold; each unavailable source is disclosed without erasing successful source data. Run owning DOM/pure helpers and selector-chosen browser proof when available.

## Lane C — Source revocation and cache freshness (`cache`)

**Owns:** F13. `src/lib/rag/rag-cache.ts`, effective review-route invalidation, related cache/answer tests and docs. SQL changes go only through lane D.

- [x] Reproduce both stale local reuse and same-process shared-delete returned-error reuse from the two audit tests; retain a fresh-metadata refusal control.
- [x] Design a durable governance-sensitive cache identity/read fence compatible with current APIs and legacy/candidate snapshots; record exact interfaces before coding.
- [x] Prevent local/shared answer and search reuse after eligibility changes, including failed deletion and in-flight writes; avoid relying solely on fire-and-forget deletion or wall-clock TTL.
- [x] Keep anonymous/skipCache/original-section/pilot/reviewed-loader exclusions intact; no governance ranking penalties or comparator changes.
- [x] Add current-to-outdated/decommissioned, matching shared/local, ordinary hit, returned error and concurrent/in-flight negative cases; disclose any live canary condition still unrun.

Acceptance: revocation is visible before a new answer can reuse old evidence, not merely when a deletion eventually succeeds. Code/SQL deployment compatibility must fail safely. Qualified clinical and hosted proof remain distinct.

## Lane D — Durable cleanup, recovery leases and concurrent team records (`database`)

**Owns:** F02, F03, F14; investigate HY05/HY06. Sole SQL/schema writer. Owns `src/lib/cme/evidence-repository.ts`, cleanup RPC/consumer contracts, `scripts/recover-ingestion-queue.ts`, `src/lib/ingestion-recovery.ts`, relevant current lease/reset SQL, Teaching supervision SQL, work-role team-move transaction if justified, and DB tests/runbook changes.

- [x] Reproduce postcommit lost-response/removal retry, obsolete recovery-lock/lease counterexample and Teaching empty-pairing reassignment vs old-registrar insert.
- [x] Record current database interfaces and create new draft migration(s) with the installed CLI where available; never alter applied migration/hash history.
- [x] Make private-object cleanup intent atomic with tombstone and retry idempotent; cleanup remains scoped to the exact owner/object.
- [x] Align destructive recovery with current lease ownership and fenced resets, including never-leased/exhausted/currently-running states; do not reset artifacts without holding the effective authority.
- [x] Serialize pairing authorization/insertion against identity/date changes with a consistent lock order; preserve normal logging, reassignment, confirmation and bounded counts.
- [x] Assess team move + supervisor revocation and confirmation/reassignment leads; fix established consistency gaps without activating dormant assessment access.
- [x] Prepare isolated PostgreSQL current-function concurrency/failure tests, not source-string-only success. Lead owns services and execution. Update runbooks with migration/application compatibility and rollout prerequisites.

Acceptance: interrupted removal retains a durable cleanup obligation; recovery cannot mutate a newer worker attempt; concurrent logs are attributed to the authorized pairing; state changes are idempotent and owner-bound. Full Supabase/migration replay remains a separately recorded gate if unavailable. Drafting SQL does not authorise live application.

## Lane E — Clinical and real-staff release boundaries (`clinical`)

**Owns:** F07, F15, HY03; F06 external-evidence handoff. Physiological calculator UI/governance inventory, hospital sick endpoint, short Factsheet projection policy/context and their tests/docs. No SQL writes or fabricated approvals.

- [x] Add held/enabled production hospital-sick route regressions: held must refuse without invoking the real reader, enabled retains auth/role/hospital scope.
- [x] Preserve the broad PIA real-staff hold unless an authoritative separate approval exists; do not invent it.
- [x] Exposed dose tools must not imply validated clinical recommendations without dedicated review. Preserve legitimate reference calculations with explicit formula/source/limitations where supported, but withhold unapproved dose/management guidance using the established policy.
- [x] Put physiological algorithms in explicit source/review inventory and drift tests, distinguishing engineering arithmetic from medical validation; do not label sources/reviewers approved.
- [x] Preserve Factsheet demonstration-use and content-month context through adapter projection without asserting `locally_reviewed` itself is false. Encode only the supported policy; record unresolved owner interpretation.
- [x] Produce exact F06 approval/evidence checklist and affected scope. Keep its four pending/partial statuses and validator unchanged until genuine authorised evidence exists.

Acceptance: held real-staff path never reads named sick data; unvalidated dose/management advice is not presented as clinically approved; provenance and limitations are inspectable; no misleading evidence status is generated.

## Lane F — Delivery inputs, optional native lock and operator guidance (`delivery`)

**Owns:** F08, F09, F16, AD01. `railway.worker.json`, runtime-input tests, optional cloud Python lock/source/generator and its docs/tests, `docs/observability-slos.md`. No root npm dependency bump without a bounded compatibility case and controller setup scheduling.

- [x] Add watch-selection tests for isolated model manifest and verifier edits; include both copied runtime integrity inputs in worker watch patterns.
- [x] Regenerate the opt-in cloud Python lock with a compatible Cython/quicksectx closure using native tooling and preserved hashes; validate exact clean installation/pip check where feasible. Do not infer default Python 3.11 worker failure.
- [x] Align SLO runbook signals, definitions and actions with current alert code; distinguish budget-breach rate from p95 and configuration from delivered notifications.
- [x] Check a compatible upstream path for AD01. Do not apply npm's unsafe downgrade or force/legacy resolver options. If no compatible safe fix exists, retain the precise unreachable-CLI mitigation/monitoring recommendation.
- [x] Provide focused contract/syntax/install verification and rollback/compatibility notes; no Railway/provider mutation.

## Controller-owned integration and privacy diagnostics

**Owns:** F05, shared organisation/docs inventory, local task receipt, issue-inbox request, final change/closure ledger and integrated checks.

- [x] Minimise upload diagnostics to safe content-free codes/counts and replace raw fatal error webhook/log payloads with established sanitised diagnostics. Test synthetic filename/provider-shaped errors; never send a real alert.
- [x] Maintain one closure row per F01–F16 plus HY01–HY07/AD01: implemented/tested, disproved, external approval required, or verification blocked. Never count a proposed or disabled feature as clinically validated.
- [x] Integrate disjoint patches only after checking ownership, source drift and tests; resolve shared interfaces serially and add organisation-map rules for new files.
- [x] Run independent security/data and clinical/product reviews against the integrated stable diff. Implement corrections and rerun only affected checks.
- [x] Run one appropriate broad offline gate for this multi-domain diff (full static set, lint, nonincremental typecheck, complete selected unit suite), then unique build/native/DB/browser gates selected by changed boundaries. Keep the known missing-origin-main baseline failure separate; never fabricate a remote ref.
- [x] Run `npm run ensure` before any actual app/browser QA. Use a permitted browser if available; otherwise record unverified rendered/assistive coverage without claiming success.
- [x] Preserve the original audit and export a local-only task receipt/checkpoint; do not update external Notion/GitHub or publish findings.

## Completion gates

- [x] Every confirmed code/configuration defect has an integrated correction, meaningful regression and independent review, or a precise unresolved technical blocker.
- [x] Unverified/latent leads have a disposition supported by evidence; F06 external approvals remain truthful.
- [x] Required local checks are complete or precisely blocked, with actual outputs and no orphaned owned services.
- [x] Final diff is coherent and reviewable in `/workspace/PsychSift`; no commits, pushes, merges, deployment or live SQL were performed.

## Acceptance checkpoint

All six candidates and independent review corrections are integrated locally. Additional bounded
acceptance fixes cover Node/Edge startup imports, supported Sentry scope binding, and Linux
coordinator terminal-state/thread liveness. Actual thread/zombie fixtures preserve live leases;
56 coordinator tests pass. The actual local Next server starts and confirms this project, and
phone/desktop calculator-hold checks plus PHQ-9 interaction pass. The temporary dev server was
stopped. Combined lint, corrected nonincremental source types, worker/native/domain checks
and the isolated production build are complete. The full unit execution recorded 32,171 passed,
13 failed and 2 skipped; complete affected-file followthrough addresses nine failures, leaving
four drift/seal/reference cases blocked. The full selected Chromium run completed: 764 passed, one iOS-only skipped, zero failures.
The production listener and active owned browser processes stopped after completion.

The controller authorized a bounded final ownership handoff in the integration checkout: the
database reviewer corrected current-lease type declarations and its typed fixture; the clinical
reviewer owned only the omitted bounds test; the cache reviewer owned only three old cache test
fixtures. These supersede the initial worktree-only restriction for those named files. No two
writers overlapped, runtime source stayed frozen during the full unit execution, and the final
86-path implementation fingerprint includes all test-only followthrough. Independent reviewers
challenged the fixture changes and their positive controls.

The first isolated production build compiled but exhausted the TypeScript child's default heap.
One retry inherited the repository's normal 8 GB setting and completed without skipping checks.
The exact pinned Supabase image pull failed Docker VFS registration for insufficient storage;
no catalog manifest was regenerated. Specific new migration-hash approval was pending at the initial handoff and was supplied for
the 2026-10-18 continuation below. See the
[results handoff](../../audit/2026-10-17-full-deep-remediation-results.md) and session-local
execution register for exact outcomes and unresolved approval/environment conditions.

## Authorized continuation — 2026-10-18

- [x] Record the owner's specific new-entry approval, append only the exact requested draft hash,
      prove the 317 previous entries unchanged, and pass the complete immutability guard/test file.
- [x] Independently inspect the storage blocker and identify only disposable task-owned caches.
- [x] Remove only the three webpack caches, proving retained production artifact hashes unchanged.
- [x] Complete one pinned-image retry after the material capacity change; perform genuine local
      catalog replay if the image becomes available, otherwise preserve the precise remaining blocker.
- [x] Obtain the required read-only GitHub confirmation, fetch genuine `origin/main`, and pass
      all 18 package-parity owning tests plus default package/receipt and comparison checks.
- [x] Reconcile the current source fingerprint, evidence, task receipt and remaining owner conditions.

The earlier pending-seal and four-failure statements describe the initial handoff. The approved
seal resolves its two owning failures; no approval to apply SQL, reseal old entries, publish or
deploy was given. Clinical/privacy approvals and provider-backed evaluation still need genuine
authority/evidence; do not manufacture them to mark the plan complete.

Continuation result: the capacity retry failed after 208.4 seconds with a final-layer no-space
error. No image or replay container was created. The storage blocker remains; no third blind
attempt or Docker configuration change was made. The owner-approved seal and genuine comparison
checks pass, leaving one original unit failure blocked: drift-manifest freshness. Fetched main
is 18 commits ahead of the assessed HEAD; publication/P00 base reconciliation is separate and
was not performed. The original application/test/SQL inputs and all retained
runtime artifacts remain unchanged; broad passing checks were not repeated without cause.

## Current-main reconciliation continuation — 2026-10-18

The owner explicitly authorised resolving current-main reconciliation. The controller created a
separate candidate at `/workspace/psychsift-remediation/current-main` on genuine main
`54559adabe5b51396c2d1c0eb395f2cf79b43fbf`. The original root tree at b0edabf and its 87 frozen
implementation paths remain preserved. This supersedes the earlier statement that fetched
main was assessed but not integrated; it does not rewrite the initial handoff or formal RAG
programme history/receipts.

- [x] Apply the preserved 103-path remediation patch on the isolated current-main candidate;
      resolve four text conflicts and the calculator-page semantic mismatch without restoring
      withheld functionality. Keep main's stable favourites behavior plus account/epoch fences,
      the whole-panel owner hide decision, and unsigned clinical-content restrictions.
- [x] Preserve the 319-entry migration union: all 318 main seals and all 318 prior remediation
      seals remain, zero existing hash changes, and the unchanged specifically approved draft
      retains SHA-256 `f0667fed9f0294c1f5ba40252d11ee66e6de07be340a1ec789e0503a1192f2ac`.
      No live SQL was applied. Regenerate the native static content/inventory artifacts; exactly eight
      Factsheet content/lineage records change, with eligibility/status fields unchanged.
- [x] Independently challenge the bounded overlap resolution and preserve the actual evidence
      limits. Source agreement is distinct from tests, full replay, clinical review and model-route
      telemetry; no unavailable specialist execution is inferred.
- [x] Establish AD01's candidate-specific resolution using main's unchanged argparse 2.0.1
      override. Actual installed Mammoth 1.13.0/argparse 2.0.1 proof passes all 13 CLI, conversion,
      library and production-closure cases; production-only npm audit reports zero vulnerabilities.
      The earlier original-baseline no-compatible-fix finding is preserved as historical.
- [x] Run one complete current-main unit/DOM execution: 32,414 passed, three failed, two skipped
      of 32,419 in 820.298 seconds. Preserve that failed raw result. Diagnose two failures as the
      npm 11.9.0 host failing main's genuine npm 11.17.0 bootstrap requirement; the remaining
      failure is actual drift-manifest freshness.
- [x] Install integrity-verified genuine npm 11.17.0 in a private prefix, complete exact-lock offline
      installation and installed-tree parity, then pass all 22 cases in the complete Cloud platform
      owning file through supported CLOUD_PLATFORM_NPM_HOME. Repeat the 13-case installed
      dependency proof successfully after installation. Required package versions stay unchanged;
      seven optional WASM-only locations are omitted. No wrapper lies about npm's version and
      no assertion/source safeguard is relaxed. This followthrough is not a green full-suite rerun.
- [x] Complete fresh repository lint (139.382 seconds), nonincremental source typecheck
      (102.611 seconds), and a fresh isolated production build. Preserve the first browser attempt's
      private ES-module global-setup failure before cases, then correct only that private harness.
- [x] Reuse that exact production artifact for the corrected complete selected ui-tools/ui-smoke
      Chromium owners: 217 passed, zero failed/skipped/flaky; wrapper 363.291 seconds and
      Playwright 360.299 seconds. Keep existing quarantine/mockup exclusions explicit. Verify
      ensure/project identity before journeys, all 3,584 non-cache build files unchanged across
      retry, and the actual production client-bundle secret-marker check passing. This does not
      extend to physical iOS/PWA, unselected engines or hosted production.
- [x] Verify same-image rootless prerequisites privately: exact OCI index/child/config and all
      29 layer digests, trusted signed Debian/package umoci acquisition, ordered uncompressed
      diff IDs, and secure rootless unpack (exit 0). Preserve both earlier Docker/VFS failures.
- [x] Complete actual same-image native bootstrap and baseline schema/catalog comparison with
      zero differences from genuine main, then implement and execute the maintained optional
      rootless generator against the integrated schema. Corrected native run passed in 42.420
      seconds; 335-function snapshot equals the independent full mirror, guest cleanup is 0/0,
      supervisor exit 0, no forced stop and owned run removed. Actual manifest hash is
      `06bf813db741c9adb7bcbf52fc1545b3541944deee47ff094f3876be6d8fd280`; its schema hash is
      `5a095aebcb31d373f9ab80243a93ce47dd8546e136d4f154a7961f73453bff1e`. Preserve default
      Docker, native generator identity, deep freshness, exact SQL/hashes and atomic publication
      after confirmed cleanup. Local full-catalog/stale-manifest verification is now closed.
- [x] Preserve the first maintained native attempt's readonly-Nix cleanup failure and unchanged
      old manifest. Correct only owned directory cleanup, never external symlinks or image SQL.
      Preserve the 134-pass/three-failure focused run (stale drift and two umask-dependent fixture
      modes); explicit fixture chmod sets exact intended modes without weakening controls.
      Complete final owning files passed 137/137: CI cache 82, drift detection 21, deep freshness
      eight and new rootless 26. Together with Cloud 22/22, all three raw full-suite failures are
      addressed by complete owning followthrough; no fresh green full-suite rerun is asserted.
- [x] Pass post-backend repository lint (2.909 seconds), migration-role and organisation checks.
      Fresh nonincremental post-backend typecheck passed in 101.327 seconds after correcting
      the project NODE_ENV environment type and process-handle typing. Preserve that first failure.
      Exact final-source native replay passed again in 42.420 seconds with confirmed cleanup, and
      all four owning files passed 137/137 again. The earlier accepted manifest is preserved; only
      generation time and replay duration changed. Guest environment isolation remains unchanged.
- [x] Pass all five unchanged maintained SQL files on the actual full mirror and all 319 sealed
      migrations in a separate fresh manual chain with one transaction per file. Preserve the
      earlier autocommit-harness failure and correct its transaction contract, not immutable SQL.
      Native strict chain/mirror comparison reports no divergence. Effective ACLs verify eight
      postgres owners, 16 anon/authenticated EXECUTE denials and eight service_role grants;
      both SQL waves shut down gracefully at 0/0. CLI/emulator, Auth HTTP, actual Storage service and deployed behavior
      remain unverified.
- [ ] Obtain operator evidence for the reserved platform role's default-privilege posture: two
      immutable role/probe warnings skip that proof. Retain the corrected chain's 14 nested-BEGIN
      and 14 wrapper-COMMIT warnings; zero SET LOCAL-outside-transaction warnings were seen.
      Passing SQL files and actual function ACLs do not make this warning-free or close that gap.
- [ ] Obtain the four genuine privacy/provider obligations, qualified clinical review, applicable
      provider-evaluation authority/evidence and hosted operational acceptance. Retain all covered
      calculator and real-staff holds until those actual conditions are satisfied.

### Final acceptance continuation — 2026-10-18

- [x] Execute the final complete offline unit selection once: 32,442 passed, one failed and
      two skipped of 32,445 in 814.648 seconds. Preserve that raw result. Correct the one stale
      migration-role source-shape expectation after shared replay refactoring; both complete
      guard/rootless owning files pass 45/45 and the native migration-role check passes. No
      application behavior or reserved-role boundary was weakened; no second full rerun claimed.
- [x] Use available connectors for bounded read-only staging inventory/catalog evidence.
      Pin the observed deployment separately from the local candidate. Record an existing
      worker/build, no passive latency samples and absent executor/provider access; do not
      run the unsafe or revision-mismatched hosted harness.
- [x] Record SF01: confirmed staging future-default ACL gap, not existing-data exposure.
      Prepare the separate postgres-only service-default proposal. Independent source review
      and a real local nonsuperuser PostgreSQL proof pass, including all 45 privilege checks,
      actual allow/deny controls, negative guards, transaction rollback and collateral invariance.
      Owned PostgreSQL shutdown is confirmed. No proposal was applied to staging.
- [x] Obtain exact approval and apply the unchanged hashed postgres-only proposal to the freshly
      verified Psych Sift Staging target. Separate post-commit catalog verification passed all
      eight checks: exact service defaults, browser denial, unchanged global/non-public/other-
      creator defaults and existing ACL/RLS/owner metadata across 986 catalog entries. No
      migration/history operation or hosted synthetic object creation was performed.
- [ ] Resolve reserved-creator defaults separately through platform authority and a global/non-
      public compatibility decision. Preserve immutable SQL and the postgres-only hosted policy.
- [x] Check the connected PsychSift planning pages for genuine approval references; no
      qualifying sign-off was supplied by those bounded reads. Do not infer absence everywhere.
- [ ] Obtain the genuine privacy/provider/legal and qualified clinical/staff sign-offs, then
      authorized candidate-matched Auth/Storage/RAG/cache/performance and rollout evidence.
      Do not clear safe holds, merge, deploy or publish under generic remediation authority.

The actual installed Mammoth proof remains valid, but its ambient npm 11.9.0 `npm ls`
subprocess attempted an update-notifier lookup that failed with EAI_AGAIN. Preserve this
observed network attempt; the proof is not described as making zero network attempts.
Installation/parity and the Cloud followthrough used genuine npm 11.17.0.

The exact new execution receipts and raw outputs are in the private session-local controller/
and current-main/ evidence directories; rootless provenance is under rootless-replay/. The
[results report](../../audit/2026-10-17-full-deep-remediation-results.md#current-main-candidate--2026-10-18)
records the snapshot boundaries. No new score/readiness verdict, current-main task-receipt export,
push, PR, merge, live SQL, deployment or clinical approval is asserted by this documentation
update. Local acceptance remains Blocked. Accepted programme identities/reconciledBase remain
historical; this integration does not reset them or establish formal programme/P00 acceptance.
