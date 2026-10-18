# Full Deep audit remediation specification

Baseline: `b0edabf0b73a806535aa3289e5de8023cf39997f`. User authorised implementation after the audit; audit observations are not medical/legal approvals. The original audit remains preserved outside the repository.

## Required outcomes

### F01: Delayed favourites save restores previous identity state

R03 requires epoch checked before committing user-scoped state.

Real provider probe: delayed account-A save completes after sign-out or B reset; both render saved instead of empty. Unkeyed root provider remains mounted.

Acceptance: Both audit scenarios stay empty for B/signed-out; A late failure cannot expire B; Queue/clear/structured mutation ordering still works.

Boundary: GET abort race and old set metadata consequences remain hypotheses, not independently confirmed.

### F02: CME evidence removal can strand a private stored file

R06 requires durable object deletion or cleanup scheduling after privacy removal.

RPC tombstones and clears filename; deletion/outbox insertion occurs later in application. Postcommit response loss leaves zero cleanup jobs; retry rejects removed_at.

Acceptance: Inject lost response/process death after commit; Exact storage object remains durably queued until deleted; Retry and cleanup-worker replay succeed without resurrecting metadata.

Boundary: Synthetic client proves application ordering, not actual provider outage frequency; no public access or deployed retention incident shown.

### F03: Documented ingestion recovery uses obsolete lock semantics

R05 and worker runbook promise fencing during destructive recovery.

Recovery refreshes locked_at/locked_by but not lease expiry/token. Current claims use lease_expires_at. Unfenced document reset/reset_document_index can follow a worker reclaim. Never-leased rows separately fail processing lease-tuple constraint.

Acceptance: Two-session worker/recovery overlap cannot mutate after lease loss; Exhausted/fresh/legacy no-lease jobs have explicit safe outcomes; All artifact families/generations and job status remain coherent.

Boundary: Fresh document-status predicate only protects its own update; exhausted final attempts cannot be reclaimed by this predicate. Stopping workers mitigates overlap but is not documented as mandatory.

### F04: Roster hides failed rotation and course-booking sources

R03 and Roster design require visible failed reads and retry, rather than an apparently empty calendar.

Hook reports ready when no source loads, including errors; Roster consumes entries and local/team notices but does not surface calendar.sources failures.

Acceptance: Fail rotations and bookings independently; Name each unavailable source and offer retry; Successful shifts remain visible; Recovery restores entries and clears warning.

Boundary: No browser reproduction. Off/unavailable feature rollout and separate shift-fetch error handling are outside the claim.

### F05: Diagnostics bypass minimization for filenames and fatal errors

Sensitive diagnostic output should use bounded minimized identifiers and shared redaction.

Upload storagePath contains original sanitized filename; logger retains synthetic name/DOB. Worker console redacts a path but fatal webhook interpolates raw error.message.

Acceptance: Synthetic name/DOB path absent from diagnostic output; Synthetic path/URL/email/key errors absent from captured webhook JSON; Correlation and error class remain actionable.

Boundary: Broader PHI/credential leakage from arbitrary errors is a risk hypothesis, not observed deployment evidence.

### F06: Four recorded privacy conditions prevent clinical production release

R04 production release requires verified evidence or scoped authorized decisions.

Offline release validator fails ZDR, APP8 cross-border basis, privacy notice/contact and PHI minimisation status. Current register has 7 verified and 4 pending/partial requirements.

Acceptance: Every covered requirement verified or genuinely accepted by authorized role; Scope restrictions clear to users/operators; Release check passes without altered gate rules.

Boundary: No claim of legal noncompliance, deployment occurrence, or missing already-recorded OpenAI/Railway DPAs.

### F07: Exposed dose and physiological calculators lack the dedicated source/review contract

Documented clinical-governance rules require dedicated validation for dose advice and transparent source/formula attribution for scoring aids.

Ordinary calculator UI exposes renal, QTc and lithium tools, including suggested doses and management advice. Its panel has no primary-source links, formula display or dated clinical-review record; the evidence provider and drift validator cover only eight psychometric fixtures. Eleven arithmetic probes pass but do not establish clinical validation.

Acceptance: Displayed formulas, cutoffs and advice map to primary sources and a dated accountable review; Panel shows calculation and applicability limits; Changes invalidate the corresponding evidence contract.

Boundary: No incorrect medical formula is alleged. Generic calculator-page disclaimer exists; this is a traceability/validation gap, not a claim the entire page lacks a disclaimer.

### F08: Worker rebuild watch omits copied model-integrity inputs

Committed automatic build selection must include material files copied into the worker artifact.

Docker copies model-artifacts.json and verify-model-artifacts.mjs, but neither matches Railway worker watchPatterns. requirements.txt does match. Container CI includes all three, so its correct scope does not repair the deploy-trigger omission.

Acceptance: A change to each of the three Docling build inputs independently selects a worker rebuild.

Boundary: No live Railway configuration or missed deployment was observed.

### F09: Opt-in cloud Python lock has incompatible Cython constraints

The explicitly retained opt-in setup must resolve its locked dependency closure.

Exact hash-locked Python3.12 installation fails: Cython3.3.0 is pinned while quicksectx0.4.1 requires Cython<3.2. The selected legacy bootstrap invokes this lock.

Acceptance: Fresh selected cloud environment installs the unchanged regenerated lock with --require-hashes; pip check succeeds.

Boundary: Default worker Docker uses Python3.11 and the canonical lock. Its failure was not established. Canonical installation on this Python3.12 host separately conflicts with medSpaCy/spaCy environment markers.

### F10: Mounted Roster state and delayed deletion survive an account switch

R03 requires owner-bound client state and auth-epoch checks before queued or asynchronous user effects.

Three actual component/hook probes reproduce A settings remaining visible, A own shifts remaining visible, and A pending 30-second delete firing after a direct mounted transition to existing B with samples off. The queued request uses the current ambient session; the DELETE API correctly scopes to its current user.

Acceptance: Direct mounted A-to-existing-B transition clears A settings and shifts; Pending A delete never dispatches under B; Normal same-account undo and delete remain correct.

Boundary: Not every logout path is affected: sample gates may remount and cancel timers. Probe models ambient B cookies; no real B records were deleted and no backend IDOR was demonstrated.

### F11: Previous pay-fortnight totals silently omit older roster days

The displayed previous full fortnight and payslip prefill must include its entire date interval.

AdminPayPage requests shifts without a range; the API defaults to the last21days. On17Oct2026, the previous fortnight is21Sep–4Oct while the API starts26Sep. A real-component probe with two8h shifts on22/28Sep prefills8 rather than16hours.

Acceptance: All days in this and previous pay fortnight are fetched; Boundary fixture prefills16hours; Custom fortnight anchors and empty periods remain correct.

Boundary: No payroll transfer or actual wage loss observed; this is an advisory hours/payslip-prefill defect.

### F12: Fixed Perth offsets corrupt supported selected-zone work calculations

src/lib/work-time/zones.ts promises work dates and times use the selected supported work timezone, including Sydney.

Three pure actual-module probes in Sydney reproduce: midnight–08:00 shift counted as5h instead of8h; a shift after the seven-local-day window is included; changing only a Teaching room moves a noon session to15:00. Helpers construct dates with fixed+08:00 after formatting selected-zone clock values.

Acceptance: Sydney shift reports8h; Outside-window shift is excluded; Room-only edit preserves exact session instant; Perth and DST-boundary cases remain correct.

Boundary: Perth default is not disproved; broader other inline offsets were inspected statically, not all reproduced.

### F13: Source governance changes can leave stale clinical answers cache-valid

A source made outdated or decommissioned must cease contributing as current reviewed evidence to new answers.

Review RPCs update governance and updated_at but preserve indexed_at, which dominates the cache version. Two actual-module probes reproduce stale local reuse and, on one process after local invalidation, stale shared_answer_cache_hit when shared deletion returns a PostgREST error. Final policy receives cloned old metadata; supplying current outdated metadata correctly refuses.

Acceptance: After current-to-outdated/decommissioned review, matching local/shared answer and search cache entries cannot be reused; Returned DB deletion errors and concurrent reads fail safely; Unchanged content and valid ownership still cache normally.

Boundary: Supported default legacy document-scoped/non-original-section cache path only. Candidate context snapshots, anonymous requests, skipCache, active pilot/reviewed loaders and other bypasses limit exposure. No hosted stale clinical answer or patient harm observed.

### F14: Concurrent Teaching reassignment can retain an old registrar log under a new pairing

Supervision entries must remain attached to the authorized registrar/supervisor relationship under concurrent writes.

pairing.save locks and reassigns an empty pairing after checking for no logs. supervision.log reads/authorizes the old pairing without a conflicting parent/advisory lock, then inserts. Its FK binds pairing_id and service_id, not registrar identity. A blocked insert can resume after reassignment without rechecking and then be read through the new pairing.

Acceptance: Two-session old-registrar log versus empty-pairing reassignment cannot commit inconsistent attribution; Normal duplicate/retry and authorized logs remain correct.

Boundary: Source independently challenged; no production incident or full current Supabase replay observed.

### F15: Hospital sick-report endpoint bypasses the real-staff release hold

Privacy impact assessment holds real-staff Roster/Admin/Teaching personal-data use pending the documented approval/isolation/residency conditions.

Actual route with production mode, real-staff release flagheld, authenticated authorized workforce role and synthetic existing rows returns200 with named sick reports and calls the reader. An enabled-release positive control returns200. Neighboring release-gated paths do not automatically gate this route.

Acceptance: Held production release returns the documented unavailable status without reading real staff data; Explicitly enabled release still requires current role and hospital scope; Demo data remains clearly separated.

Boundary: Requires authenticated authorized workforce/site role and existing real rows. This is not anonymous access or evidence that rows are currently deployed. The release-scope conclusion assumes this roster-derived hospital projection is covered by the broad PIA real-staff hold. An authoritative separate hospital-data approval would disconfirm that scope; none was found. The probe mocks role/auth and repository rows, so it proves the missing branch and reader call, not actual RLS/role enforcement.

### F16: SLO runbook understates implemented alert signals

Operator guidance should accurately describe configured diagnostic signals.

Runbook states only two rates/alerts are computed, while source implements additional source-gap, unsupported-answer and latency-budget breach warnings.

Acceptance: Every current alert code maps to its actual definition and operator action; No claim of verified delivery without an observed test.

Boundary: Low-impact documentation drift. Actual hosted detection/delivery remains Unverified in J1.

## Additional retained leads

- HY01: Additional stale favourites responses may alter set metadata or expire a new session. Same missing epoch pattern; only membership-save success transition reproduced. Verification: Delayed GET body, structured mutations and stale 401 under immutable per-render identity fixtures.
- HY02: Configured worker fatal errors could carry sensitive provider details. Raw egress proven; actual sensitive deployment payload unknown. Verification: Intercept synthetic provider-shaped exception before any real webhook delivery.
- HY03: Factsheet short-summary use policy loses demonstration/date context. Eight eligible short clinical-reference summaries omit the demonstration-use notice and call content month Review date. Local source checking can support locally_reviewed; no authoritative short-summary prohibition established. Patient handout prohibition alone does not prove this projection forbidden. Verification: Clinical/content owner defines summary-use policy, then adapter/manifest/release regression preserves required notice and date semantics.
- HY04: Additional Admin/leave/share state may lack identity fencing. Source patterns in New job PATCH, sharing and basic leave hooks warrant follow-up; no actual stale response counterexample or effective remount closure established. Verification: Actual mounted immutableA/B auth fixtures for each live consumer; trace store reset/remount before promoting finding.
- HY05: People team-move and whole-team-supervisor revocation are not atomic. moveTeam commits hospital link before supervisor revocation; second-write failure explicitly reports503 and manual recovery; retry sees same destination409. Models can retain old whole-team authority, but current production assessment routes refuse503 and no live assessment consumer found. No present assessment disclosure alleged. Verification: Before activating assessment review, atomically move/revoke or derive scope from current hospital; failure-injection must remove old-hospital authority. Keep explicit recovery path.
- HY06: Teaching confirmation/reassignment admitted-operation semantics. Confirmation does not acquire the same pairing lock. Whether an admitted old-supervisor operation is forbidden after reassignment needs defined semantics and actual SQL ordering; not established as separate defect. Verification: Define linearization requirement; current-RPC two-session confirmation/reassignment test.
- HY07: Forwarded host/IP and Edge gateway trust assumptions. Source relies on hosting proxy sanitization and configured Edge JWT verification. No deployed header or gateway override tested. Verification: Separately authorized staging edge-origin/cookie/header and gateway configuration verification.

AD01: Moderate registry advisory GHSA-hp3w-g68c-fv3c through Mammoth CLI dependencies; library reachability not established. Seek a compatible fix; never blindly downgrade Mammoth.

## Authority and completion

Implement and test local code/configuration fixes and draft migrations. Do not change live databases, merge, push, deploy, send messages, call application providers or pay for canaries. Do not invent clinical sign-off, legal decisions, ZDR status or source approval. Keep unmet external conditions explicit and fail closed. A local code fix, tested migration, owner acceptance and deployed verification are distinct.
