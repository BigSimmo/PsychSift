> **STALE SNAPSHOT — DO NOT READ THIS AS THE CURRENT LEDGER.**
>
> This is a frozen copy of the scratch ledger as it stood at head `6afce3893` on 2026-08-20. It stops
> at Ruling 29 and knows nothing of Rulings 30–34, the fix-round-2 review, the owner's case-notes
> decision, the worktree loss and recovery, or the current 96-passing test state.
>
> **The live ledger is `docs/caring-contacts/phase-2a-build-record.md`.** Read that instead. This file
> is kept only because it is the verbatim shape the ledger had at that moment; nothing in it is unique.

# SDD ledger — plan: docs/superpowers/plans/2026-08-19-caring-contact-phase-2a-foundations.md

Spec: docs/superpowers/specs/2026-08-19-caring-contact-production-build-design.md (read).
Branch: claude/suicide-contact-mockup-b5aaa0. Plan committed at e68445c38.

## Pre-flight conflict scan

Every pair of tasks sharing a file or an interface, plus each task against itself.

| Rows checked                               | Produces → consumes                                               | Finding                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| T1 → (none in 2A)                          | message copy → screens in Plan 2B                                 | Clean. T1's test imports `calculateGsm7` from `message-policy.ts`, which exists in Phase 1.                                    |
| T2 → T14                                   | `publishPathwayVersion` action name → handler denial test         | Clean; T2 precedes T14.                                                                                                        |
| T2 → T4                                    | `canApproveOwnAuthoredVersion`                                    | Clean — it already exists in Phase 1, so T4 does not depend on T2's edit.                                                      |
| T3 → T10, T11, T16                         | `ServiceState`, `ServiceStopReason`, `ServiceRestartApprovalRole` | Names match at all three consumers.                                                                                            |
| T4 → T10                                   | `PathwayVersion`, `PathwayVersionAction`                          | **Gap:** T4's Consumes list omits `MessageType`, used by `PathwayVersionSnapshot`. Ruling: [1].                                |
| T5 → T10                                   | `ReferralAction`                                                  | **Gap:** T5's Consumes list omits `PlanId`, used by `DuplicateReferralOutcome`. Ruling: [1].                                   |
| T6 → T10, T11                              | `PlanAssignment`, `AssignmentAction`                              | Coverage window type ambiguous: interface says ISO, test uses `"2026-08-20"`. Ruling: [2].                                     |
| T7 → (nothing)                             | `moveContactWithinDay`, `changeContactDate`                       | **Defect:** no storage method persists a rescheduled contact, so Plan 2B's screens would have rules with no path. Ruling: [3]. |
| T8 → T10, T14                              | `AccessRecord`, `AccessKind`, `AccessedObjectType`                | Names match.                                                                                                                   |
| T9 → T10                                   | `NotificationPreferences`, `TrainingRecord`                       | Names match.                                                                                                                   |
| T10 → T11, T14                             | extended `CaringContactRepository`                                | Names match.                                                                                                                   |
| T11 self-check                             | `service_restart_approvals` uniques against repeated stops        | **Defect:** uniques keyed on `team_id` make a second stop unapprovable by anyone who approved the first. Ruling: [4].          |
| T12 → T14                                  | `caringContactsStore()`                                           | Clean.                                                                                                                         |
| T13 → T14                                  | `resolveDemoActor()`                                              | Clean.                                                                                                                         |
| T15 → T16, T18, T19                        | `CaringContactsShell`, `widthStateFor`, route constants           | **Gap:** T16's test passes a `serviceState` prop that T15's shell signature does not declare. Ruling: [5].                     |
| T17 → T18, T19                             | `WORKSPACE_OVERLAY_DEFINITIONS`                                   | Names match; T17 parses the matrix document by column index, which is correct for that table's shape.                          |
| T18 → T19                                  | `data-overlay-id` / `-modality` / `-dismissal`                    | Names match.                                                                                                                   |
| T10 self-check (test vs code it specifies) | `expect(Object.keys(store)).not.toContain("resendContact")`       | **Defect:** asserts the absence of a method nobody wrote — it cannot fail. Ruling: [6].                                        |
| T15 self-check (test vs code it specifies) | `data-internal-link="true"` on internal anchors                   | Artificial but observable in jsdom, where `next/link` renders a bare anchor. Kept. Ruling: [7].                                |
| All tasks vs Global Constraints            | tap floor, tokens, button wiring, migration directory, no push    | No task contradicts a global constraint.                                                                                       |

## Pre-flight rulings

Ruling: [1] T4's and T5's `Consumes` lists gain the omitted imports (`MessageType` from `./model` in T4; `PlanId` from `./ids` in T5). — Why: an implementer reading only its brief would otherwise write an unresolvable type. — Cost if wrong: none; these are the only types those signatures reference.

Ruling: [2] coverage windows are **AWST calendar days** in `YYYY-MM-DD` form, matching `PlannedContact.calendarDay` and T11's `coverage_from text` / `coverage_until text` columns, not full ISO instants. — Why: coverage is rostered by day, and the migration already types the columns as text; making them instants would force a timezone decision the roster does not have. — Cost if wrong: `effectiveResponder` compares days when it needed hours; one comparison and two column types to change.

Ruling: [3] T10's storage contract gains `rescheduleContact(input: { planId: PlanId; contactId: ContactId; expectedContactVersion: number; change: ContactMoveRequest | ContactDateChangeRequest }, context: WriteContext): Promise<TransitionResult<StoredContact>>`, delegating to T7's rules. — Why: T7 builds the rules for moving a contact and changing its date, and without a storage method those rules are unreachable from any screen, which would leave two granted actions as façades in Plan 2B — the exact failure the spec was written to prevent. — Cost if wrong: one unused repository method if the reschedule screens are cut.

Ruling: [4] `service_state` gains a `stop_id uuid` generated at stop time, and `service_restart_approvals` is keyed by it — `UNIQUE (stop_id, role)` and `UNIQUE (stop_id, actor_id)` instead of on `team_id`. — Why: keyed on `team_id`, the rows from a first stop permanently bar their approvers from approving any later stop, so the second incident in a team's life could become unrestartable. Keying by the stop instance keeps "three different people per restart" exactly, without leaking across incidents. — Cost if wrong: one extra column and a different unique key; the three-person rule is unchanged either way.

Ruling: [5] `CaringContactsShell` declares `serviceState: ServiceState` from T15, defaulting to a running service, and T16 mounts the banner using it. — Why: T16 already assumes the prop; declaring it in T15 avoids a signature change mid-plan. — Cost if wrong: one prop moves between two adjacent tasks.

Ruling: [6] T10's `expect(Object.keys(store)).not.toContain("resendContact")` is **replaced** with a behavioural assertion — after `resolveDispatchDiscrepancy` with `unresolvedNoResend`, the contact's state and version are unchanged and no new dispatch row exists. — Why: asserting that a method nobody wrote is absent is exactly the "test that cannot fail" defect Phase 1 found twice; it would pass forever regardless of the implementation. — Cost if wrong: none; the replacement is strictly stronger.

Ruling: [7] T15's `data-internal-link="true"` stamp is kept. — Why: in jsdom `next/link` renders a plain anchor, so the Link-versus-raw-anchor rule is otherwise unobservable at the DOM level, and the repo's own reachability gate works by binding resolution which jsdom cannot reproduce. — Cost if wrong: a cosmetic attribute in production markup.

## Progress

Task 1: complete (commits e68445c..631e699, review clean) — one calculateGsm7 remains; septet pins 252/218 independently re-derived by the reviewer.
Task 1: note — the brief's suggested mutation (9 am-6 pm -> 9 am-7 pm) does not change the septet count; the implementer substituted a real one (removed a space, 252->251) and both pinned tests went red. Later tasks: check that a proposed mutation actually changes the asserted value.
Task 2: complete (commits 631e699..27a7816, review clean) — grant table verified name-by-name; safety stop on all five human roles; publishPathwayVersion on clinicalProgrammeLead only; four denial reasons intact; UNGRANTED_ACTIONS still empty. Full suite 7556 passed.
Task 2: minor (deferred): reviewer judged the brief-supplied cross-team ordering test weak in isolation. Assessed and disagreed — the outsider holds clinicalProgrammeLead, which grants approvePathwayVersion, so without the cross-team check firing first the call would return allowed rather than cross-team-denied. Left as written; noted for the final review.
Task 3: review — spec OK; ONE Important (banner privacy held by construction only, no test) plus three minors. Fix round 1 dispatched.
Task 3: minor (deferred): unreachable "All approvals are in." branch in describeServiceStop — a stopped state can never hold three approvals. Removed in fix round 1 as it sits in the same edit.
Task 3: minor (deferred): actorId() rejects only the empty string — no trim, no canonicalisation — so "DR-A" and "dr-a" are two actors. The module is right to compare identity strictly; the API task must supply canonical, auth-derived ids or the same person could supply two restart approvals. Carry into Task 13/14.
Task 3: minor (deferred): awstIsoTimestamp is now public in clock.ts with no direct test, covered only transitively through audit.ts.
Task 3: Ruling: [8] describeServiceStop takes a narrowed argument ({ reason, restartApprovals }) rather than the whole ServiceState, and gains a test using a note containing a synthetic name and mobile number. — Why: the note is the one field guaranteed to hold whatever a person typed mid-incident, and the banner renders on every screen; holding the property by doc comment alone means one future edit leaks it. The compiler should hold it, not a comment. — Cost if wrong: one signature and one call site.
Task 3: Ruling: [9] ServiceState's teamId is renamed reportedByTeamId, and Tasks 10/11 persist the safety stop as a SINGLETON record (one fixed-key row enforced by the schema), read by every dispatch path regardless of the dispatching team. — Why: spec 4.2 requires a halt "across every patient and team", but a field named teamId makes a per-team table the natural implementation, which would silently leave every other team sending during an incident. — Cost if wrong: if a per-team stop were ever wanted, the singleton row becomes a per-team table and the field returns to its old name.
Task 3: fix round 1/5 (4 addressed, 0 open — banner privacy narrowed and tested, teamId renamed reportedByTeamId, dead branch removed, report line count corrected; commits c976ff9..6434817)
Task 3: complete (commits 27a7816..6434817, review clean) — full caring-contacts suite 317 passed; the note-leak is now blocked twice, by the type and by a test that fires if the type is ever widened back.
Task 3: accepted deviation — describeServiceStop takes a discriminated { stopped: false } | { stopped: true; reason; restartApprovals } rather than the bare narrowed shape. Same guarantee (the note is unreachable) and it keeps the running-service contract under test rather than degrading to null-maps-to-null. Accepted.
Task 3: CARRY INTO TASKS 10 AND 11 — the single-record rule for the safety stop is currently held only by the reportedByTeamId name and a doc comment. Nothing stops the storage task building a per-team table anyway. Ruling: [9] requires the schema itself to enforce one row (fixed-key singleton), and every dispatch path must read it regardless of the dispatching team. This must be a migration constraint and a test, not a convention.

## RESUME POINT

Next task: Task 4 (pathway versions and dual approval). Brief already extracted at task-4-brief.md; task-5-brief.md also extracted.
BASE for Task 4 = 6434817b2. Model guidance from the owner: Sonnet 5 for ordinary tasks; Opus 5 for the service safety stop (done), anything displaying delivery or clinical state, the 24-overlay modality contract (Tasks 17 and 18), and the final whole-branch review. Task 11 (migration plus RLS) is also Opus by the repo's own effort calibration.
Carry into Task 4's dispatch: Ruling: [1] — PathwayVersionSnapshot needs MessageType imported from ./model, which the brief's Consumes list omits.
Carry into Task 5's dispatch: Ruling: [1] — DuplicateReferralOutcome needs PlanId imported from ./ids, which the brief's Consumes list omits.

## Owner decisions closed 2026-08-19 (previously open from Phase 1)

- Patient-visible wording: KEEP AS WRITTEN. Still flagged provisional and not clinically approved; lived-experience and clinical sign-off still required before any real use. No code change — the pinned 252/218 septet strings stand.
- Retention: SEVEN YEARS confirmed. DEFAULT_RETENTION_POLICY already { years: 7 }. No code change.
- Cross-team duplicate prevention: CONFIRMED as built. The partial unique index stays on (patient_id) rather than (team_id, patient_id), accepting that a second team can infer a plan exists elsewhere, because two teams sending two sets of caring contacts is the worse outcome. Phase 1 decision 6 is now the owner's decision, not mine.
  Task 4: review — spec OK, implementation correct (all five approval sequences hand-traced; snapshot untouched by every branch; self-approval delegated, not re-implemented). ONE Important: pathway-not-retirable implemented with zero test coverage, and publishedAt/retiredAt values never asserted. The gap is in the brief I wrote, not the implementation. Fix round 1 dispatched.
  Task 4: fix round 1/5 (1 addressed, 0 open — all three non-approved states covered with exact refusal objects, publish/retire timestamps asserted against /\+08:00$/, implementation file untouched; commits 33d38ca..9c43268)
  Task 4: complete (commits 6434817..9c43268, review clean) — 7 passed.
  Task 5+6+7: Ruling: [10] Tasks 5, 6 and 7 are dispatched as ONE batch with three separate commits. — Why: three small independent pure-transition modules in three different new files, each with complete test code in its brief and no interface between them; one dispatch per task would make three agents rebuild the same context, and Phase 1 batched two such tasks for the same reason. — Cost if wrong: one review surface covers three modules, so a finding in any one of them holds up the other two.
  Task 5: complete (commit 9634deb, batch review clean) — referrals.
  Task 6: complete (commit 9f51d5b, batch review clean) — assignment, reassignment history, coverage.
  Task 7: complete (commit 664ec7d, batch review clean) — within-day moves and approved date changes.
  Tasks 5-7: all 11 refusal reasons across the three modules now have a test asserting the exact refusal object; the implementer found and closed 5 gaps the briefs had left.
  Tasks 5-7: Ruling: [11] The reviewer's one Important finding — Task 7's brief names APPROVED_SEND_WINDOW under Consumes but the module only needs isWithinApprovedSendWindow — is a defect in the brief, not the code. No change. — Why: the module must not re-derive 09:00-18:00, and it does not; adding an unused import to satisfy a list I wrote would be strictly worse than the brief being over-specified. — Cost if wrong: none; the constant remains exported and importable if a later task needs it.
  Task 6: minor (deferred): coverage window boundary equality (day == from, day == until) is implemented inclusive on both ends but only interior and after-until dates are asserted. Boundaries are where off-by-one bugs live. FLAG FOR THE FINAL WHOLE-BRANCH REVIEW.
  Task 6: minor (deferred): PlanAssignment mixes AWST instant strings (claimedAt, reassignment at) with bare calendar days (coverage from/until). Reviewer confirmed the 10-character calendar-day branch in effectiveResponder is a sound distinction, not a guess, and that a full ISO instant still maps to its true AWST day. Suggested later cleanup: name them claimedAtIso/fromDay or brand the two string shapes. Not blocking.

## OWNER CLARIFICATION 2026-08-19 — the workspace is a standalone application

Caring Contacts does NOT reuse the Clinical KB navigation. It is its own application living inside the
same deployment, and it owns its own sidebar: every one of its headings/destinations goes in ITS side
rail, not in the host app's nav. This confirms the shell design in Task 15 (own rail, own header, own
phone dock, four width states) and means Plan 2B must place all workspace destinations in that rail
rather than registering them as host-app modes. The tools-catalogue entry from Task 15 remains only the
single front-door link into the application; it is not the workspace's navigation.

Task 8: review — CRITICAL. A patient name with no digits in it is NOT caught by
assertAuditEventFreeOfPatientData: AU_MOBILE_NUMBER_PATTERN only matches digit runs, and the
forbidden-field-name list blocks fields literally named name/patientName, not objectId. The brief's own
test passed for the wrong reason — it used "Rowan Sample +61 491 570 156", so the number caught it, not
the name. A clinician searching by name is the common case and would have written that name into the
trail. Tasks 9a and 9b clean.
Task 8: Ruling: [12] The fix is an ALLOWLIST on the shape of an access-event objectId, not a name
heuristic. An access event's objectId must match an identifier shape (no whitespace; only letters,
digits, hyphen, underscore and colon; bounded length) and anything else throws
AuditEventContainsPatientDataError. — Why: a denylist of name shapes cannot be made reliable — "Rowan
Whitlock" and a legitimate free-text id are indistinguishable in general — whereas the set of things
that legitimately identify an object here is small and knowable (SYN-PLAN-001, SYN-CONTACT-004,
demo-coordinator, patientDirectory, a uuid). A search term is not an identifier and must never be
recorded at all: the searched-over surface is the object, never the query. The existing mobile-number
scan stays as well. — Cost if wrong: if a real identifier format later contains a space or another
character, the allowlist widens by one character class in one place.
Task 8: fix round 1/5 (1 addressed, 0 open — objectId allowlist /^[A-Za-z0-9_:-]{1,128}$/ checked first, "Rowan Whitlock" throws, all five legitimate identifier shapes accepted, audit.ts untouched, one error type, allowlist rationale commented; commits 8a5a4aa..3272c87)
Task 8: complete (commits 664ec7d..3272c87, review clean).
Task 9: complete (commits 2074119, 8a5a4aa, review clean) — notification preferences and training separation.

## CHECKPOINT 1 PASSED — end of Group 1, the rules layer is complete

npm run test -> Test Files 691 passed | 2 skipped (693) / Tests 7604 passed | 29 skipped (7633) PASS
npm run typecheck -> exit 0, no diagnostics PASS
npm run lint -> exit 0, no output PASS
Note: typecheck first failed with DATABASE_HEAVY_RUN_ADMISSION_BUSY because the exclusive vitest lease
was held by the concurrent full test run; it passed cleanly on rerun. That is the repo's cross-worktree
run coordinator behaving correctly, not a defect.

## RESUME POINT (supersedes the earlier one)

Group 1 (Tasks 1-9, the sealed rules layer) is COMPLETE and reviewed. Next: Task 10 (extend the storage
contract and the in-memory store). Briefs 1-9 extracted; 10 onwards not yet.
BASE for Task 10 = 3272c8701.
Carry into Task 10's dispatch: Ruling: [3] (add rescheduleContact to the contract, delegating to Task 7's
rules), Ruling: [6] (replace the tautological "resendContact absent" assertion with a behavioural one),
Ruling: [9] (the safety stop is a SINGLETON record enforced by the schema, read by every dispatch path
regardless of team — this must be a migration constraint and a test, not a convention).
Carry into Task 11's dispatch: Ruling: [4] (service_state gains stop_id; service_restart_approvals keyed
UNIQUE (stop_id, role) and UNIQUE (stop_id, actor_id), not on team_id) and Ruling: [9].
Carry into Task 13/14's dispatch: the deferred minor that actorId() does not canonicalise, so the API must
supply canonical auth-derived ids or one person could supply two restart approvals.
Carry into Task 15 and all of Plan 2B: the owner's clarification that Caring Contacts is a standalone
application owning its own sidebar; its destinations go in ITS rail, not the host app's nav.
Model guidance: Sonnet 5 for ordinary tasks; Opus 5 for Task 11 (migration + RLS), Tasks 17-18 (the
24-overlay modality contract), anything displaying delivery or clinical state, and the final review.

## Owner-directed actions on the two carried risks, 2026-08-19

Risk 1 (size limit): Ruling: [13] Task 15 gains a hard requirement rather than only a measurement step —
the workspace's client code must sit behind a lazy route boundary from the first commit, so the Clinical KB
dashboard never downloads it and the workspace can never charge its weight to the host app's ceiling. The
measurement at Task 15 step 8 stays, but it now verifies a design that was built to pass rather than
discovering a problem late. — Why: measuring an empty baseline now would tell us almost nothing the
committed baseline does not, whereas the lazy boundary is free to adopt at the start and expensive to
retrofit across twenty screens. — Cost if wrong: if the workspace turns out small enough not to need it,
one dynamic import boundary is redundant but harmless.
Risk 2 (singleton safety stop): recorded in the repository's durable outstanding-work inbox via
npm run issues:add, so the requirement survives even if this session ledger is lost. It remains carried
into Tasks 10 and 11 as Ruling: [9] and Ruling: [4].
Task 10: implemented (commit 6bf9f6362) — storage contract extended with ~20 methods, in-memory store
implements them all, service-stop gate and audit write both inside runWrite so no future method can forget
either. 84 passed. Rulings 3, 6 and 9 all applied: rescheduleContact added; the tautological
"resendContact absent" assertion replaced with a behavioural one (state and version unchanged, no new
dispatch row); the service stop proven service-wide by a cross-team test.
Task 10: NOT YET REVIEWED. Review package not generated. This is the resume point.
Task 10: *** BRANCH IS MID-CHANGE — npm run typecheck IS RED. *** src/lib/caring-contacts/db/postgres-repository.ts
no longer satisfies the extended CaringContactRepository interface: it is missing the ~20 new methods.
This is expected and is exactly what Task 11 fixes. Nothing else is broken; the unit suite is green.
Do not "fix" it by narrowing the interface — implement the methods in Task 11.
Task 10: concern to carry — trainingWorkspaceIsolated was added to REPOSITORY_REFUSALS as instructed but is
unwired and untested, because no method signature in Task 10's scope carries a workspace parameter to gate
on. Either wire it when training-scoped reads arrive in Plan 2B, or remove it. Do not leave a refusal
constant that nothing can ever return.

## RESUME POINT (supersedes all earlier ones)

1. FIRST: review Task 10. BASE = 88e774c95, HEAD = 6bf9f6362. Generate the package with
   scripts/review-package and dispatch a task reviewer. Task 10 is unreviewed.
2. THEN: Task 11 (migration 0003 + Postgres implementation). Use Opus 5 — migration plus row-level
   security is the repo's own xhigh/high effort band. It restores typecheck. It needs Docker for
   npm run caring-contacts:db:test, which is local and offline and needs no provider approval.
   Carry Ruling: [4] (service_state gains stop_id; service_restart_approvals keyed UNIQUE (stop_id, role)
   and UNIQUE (stop_id, actor_id), NOT on team_id) and Ruling: [9] (schema-enforced singleton service stop,
   also recorded durably in docs/outstanding-issues-inbox/ at commit 88e774c95).
3. Then Tasks 12-19. Ruling: [13] — Task 15 must put the workspace behind a lazy route boundary from its
   first commit, not just measure the bundle afterwards.
4. Owner clarification: Caring Contacts is a standalone application owning its own sidebar; all its
   destinations go in ITS rail, never the host app's nav. Applies to Task 15 and all of Plan 2B.

## Session resumed 2026-08-19 (Phase 2A, from the Task 10 review resume point)

Environment: Docker Desktop is now RUNNING and a disposable Postgres 17.11 container `caring-contacts-pg`
is up on 127.0.0.1:54329 (`postgres:17`, password `caring-contacts-local`, `--restart unless-stopped`, NOT
`--rm`). Set `CARING_CONTACTS_DATABASE_URL=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres`
for `npm run caring-contacts:db:test`. It is local, offline, disposable, and touches no hosted service.
NOTE: the first attempt used `docker run --rm` and the container was removed when the engine finished
starting, which surfaced as `Connection terminated unexpectedly` and 7 failed / 48 passed on a BASELINE run
that had changed no code. That was environmental, not a schema defect. Re-run the baseline before trusting
any Task 11 red/green.

Task 10: REVIEWED (reviewer: Opus 5, BASE 88e774c95, HEAD 6bf9f6362). Verdict: Needs fixes —
1 Critical, 4 Important, 9 Minor. All 21 interface methods confirmed present in both the interface and the
in-memory store. Rulings 3, 6 and 9 independently confirmed applied and genuinely testable; Mutation A
independently re-traced and confirmed NOT a no-op (exactly the four reported tests read the gate).

Task 10 review findings entering the fix loop:
C1 savePathwayVersion persists caller-supplied state/approvals/authorId/publishedAt verbatim, so one
actor holding authorPathwayVersion can save {state:"published", approvals:[]} and publish governed
clinical message content past the dual-approval control Task 4 built. Governance bypass.
I2 No test asserts that ANY of the 20 new writes emits an audit event. Mutation B only reddened
pre-existing plan-write tests, so brief Step 5's proof was never actually obtained for a new method.
I3 A service-stopped refusal is cached against the idempotency key, so the natural retry after the
restart is refused forever with a reason that is no longer true.
I4 getAssignment and getServiceState return live internal references; every other read clones. A caller
can rewrite plan ownership or an incident note in place with no version bump and no audit event.
I5 applyAssignment never binds a claim's actorId to the writing actor, so the assignment ledger and the
audit event can disagree about who owns the work.

Ruling: [14] savePathwayVersion persists AUTHORED CONTENT ONLY and constructs every governance field
server-side — state "draft", approvals [], authorId from the write context, publishedAt/retiredAt/
retirementUrgency null — regardless of what the caller supplied. Every governance transition stays
exclusively in transitionPathwayVersion. — Why: the brief typed the input as the whole PathwayVersion, but
a create method that trusts the caller's own approval state is not a storage decision, it is the removal of
the dual-approval control; the same file already constructs createReferral's state server-side, so this is
the file's own established trust boundary, not a new one. — Cost if wrong: a caller that legitimately
needed to seed a non-draft version must now make the transition calls explicitly, which is one extra call
and the audit trail those transitions produce.

Ruling: [15] A `service-stopped` refusal is NOT written to the idempotency map; every other refusal still
is. — Why: replay caching exists so a retried request returns its original answer, which is right when the
answer is a property of the request, but service-stopped is a property of a global, explicitly reversible
incident state — caching it means the safety stop's own resume path is the thing it permanently breaks.
— Cost if wrong: a replayed write from the stopped window executes after the restart instead of returning
the cached refusal, which is the behaviour the resume path wants anyway.

Ruling: [16] `trainingWorkspaceIsolated` is REMOVED from REPOSITORY_REFUSALS rather than wired.
— Why: the owner's instruction was wire-it-or-remove-it, and wiring it correctly is not the cheap option it
looks like — `workspacesMayShareData` is a BETWEEN-workspaces predicate that returns false for
(training, training), so using it as a self-access gate would refuse every operation of a training store;
the correct gate is a workspace-identity check that does not exist yet and would add a field to the
Read/Write contexts that Tasks 12-14 consume. — Cost if wrong: one constant to re-add in Plan 2B, next to
the gate that can actually return it.

Ruling: [17] `DispatchRecord.expectedStatus` is left unwritten in Task 10 and CARRIED as a requirement on
whichever task builds the dispatch/provider path (Task 12 onward). — Why: reconciliation compares expected
against reported, and nothing currently writes the expected half, so the reconciliation surface can show no
discrepancy at all — a real façade risk of exactly the kind Ruling 3 was made to prevent; but inventing a
setter before the dispatch path exists would be speculative, and the brief names no method that sets it.
— Cost if wrong: if no later task claims it, the reconciliation screen in Plan 2B has a permanently empty
expected column and the gap must be closed there instead.

Task 10 minors (deferred to the final whole-branch review): rescheduleContact's
`contact-move-leaves-scheduled-day` and `contact-date-change-in-the-past` are reachable but untested, and
the report's refusal table overstates that coverage; `retentionCleared` is written and never read;
`listAccessTrail` never exercises a non-zero `offset`; two test titles overclaim what their body asserts
(the "and a blank note" title, and a positive control satisfied by pre-existing plan-write events); the
~10x repeated permission/lookup guard could be one helper and its three action-selecting ternaries fall
through to a default rather than failing to compile on a new variant; malformed date strings in
listDispatches/listAccessTrail yield NaN comparisons and an empty list indistinguishable from "none";
in-memory-repository.ts is now 1201 lines holding eight storage concerns and should split rather than
extend again.

## Task 11 pre-dispatch conflict scan (controller, before writing any SQL)

Read of the CURRENT schema, not of the brief's description of it:

- `caring_contacts.service_state` (0001:205) is `team_id text primary key references teams (id)` — a PER-TEAM
  table — and 0002 gives it the standard `team_id = caring_contacts.current_team_id()` policy. As it stands
  today, a stop raised by TEAM-NORTH is INVISIBLE to TEAM-SOUTH: row-level security itself enforces the leak
  Ruling 9 exists to prevent. Task 10's in-memory store is service-wide and its cross-team test passes, so
  the two stores currently disagree about the single most safety-critical behaviour in the workspace.
- The Task 11 brief's own Step-1 test asserts `unique (team_id, role)` and `unique (team_id, actor_id)`,
  which is exactly what Ruling 4 overruled at pre-flight.
- `plans.referral_id` and `plans.pathway_version_id` are `text not null` with NO foreign key, and
  `tests/helpers/caring-contacts-postgres.ts:195 seedPlan` inserts `${planId}-REFERRAL` /
  `${planId}-PATHWAY` with no parent rows anywhere. Adding the real foreign keys the brief asks for will
  break every existing migration and Postgres-repository test until that helper seeds the parents.
- `pathway_versions.state` already CHECKs exactly the four states `model.ts:20` declares
  (draft/inReview/approved/retired). Publishing is `published_at`, not a fifth state. No CHECK change needed.
- `pathway_version_approvals` as the brief describes it carries no `team_id`, so the blanket
  "team_id = current_team_id()" policy the brief mandates for every new table cannot attach to it as written.

Ruling: [18] The Task 11 brief's Step-1 assertions are REWRITTEN to `unique (stop_id, role)` and
`unique (stop_id, actor_id)`, and `service_restart_approvals` is keyed on `stop_id`, never `team_id`.
— Why: Ruling 4 already decided this at pre-flight for a reason that still holds — keyed on team, the
approvals from a first stop permanently bar their approvers from approving any later stop, so a team's
second incident could become unrestartable. The brief was written before that ruling. This is not a loosened
assertion: the test does not exist yet, and the replacement is the stronger constraint. — Cost if wrong:
one column and two unique keys; the three-person rule is identical either way.

Ruling: [19] Migration 0003 CONVERTS `service_state` from a per-team table into a schema-enforced SINGLETON
— one fixed-key row — dropping the `team_id` primary key, keeping the old team column only as nullable
`reported_by_team_id` attribution, and dropping `restart_approved_by` in favour of the `service_restart_approvals`
child table. — Why: Ruling 9 requires the stop to be read by every dispatch path regardless of team, and the
current per-team primary key makes the per-team table the only thing the schema can express; leaving it
would let every other team keep sending during another team's incident, which is the precise failure spec
§4.2 forbids, and would put the Postgres store in direct contradiction with the in-memory store's passing
cross-team test. — Cost if wrong: if a per-team stop were ever genuinely wanted, the singleton row becomes
a per-team table again and `reported_by_team_id` returns to being the key.

Ruling: [20] `service_state` and `service_restart_approvals` do NOT get the blanket
`team_id = caring_contacts.current_team_id()` policy the brief mandates for every new table. They get
`using (caring_contacts.current_team_id() is not null)` with the same `with check`. — Why: a team-scoped
policy on a service-wide singleton is the leak itself — every other team would read zero rows and conclude
the service is running. Scoping instead on "this session has named SOME team" keeps 0002's deny-by-default
property intact (an unscoped session still matches no row, so the existing "denies a session that names no
team at all" proof extends rather than weakens) while making the one stop row visible to everyone who must
obey it. No policy becomes unconditionally true. — Cost if wrong: if the stop should have been invisible to
teams other than the reporter, the policy narrows back to team scope — but that is the behaviour Ruling 9
was made to forbid.

Ruling: [21] Every OTHER new table keeps the brief's standard team-scope policy, and the child approval
table `pathway_version_approvals` carries a denormalised `team_id` so that policy attaches unchanged rather
than joining to its parent. — Why: a policy that joins to the parent table is evaluated per row on every
statement and is easy to get subtly wrong; a denormalised team column matched by foreign key to the parent
is what every other table in this schema already does. — Cost if wrong: one redundant column, kept correct
by its foreign key.

Ruling: [22] `tests/helpers/caring-contacts-postgres.ts` `seedPlan` is EXTENDED to seed the parent referral
and pathway-version rows before the plan. — Why: the new foreign keys are the point of the task (they close
Phase 1 open item 2), and a fixture that was only valid because no key existed must become valid, not be
exempted. This modifies a fixture to make it legitimate; it deletes and loosens no assertion. — Cost if
wrong: none — if the foreign keys were later dropped the extra seed rows are harmless.

Structural gap found in the Task 11 scan that the Task 10 review could not see (the file is outside that
diff): `tests/helpers/caring-contacts-repository-contract.ts` is a 721-line factory-driven suite whose own
header states "Task 9 runs it against the in-memory store; Task 11 runs this same function against the
Postgres store rather than writing a second suite, which is why it takes a factory instead of calling a
constructor." Task 10 put ALL behavioural tests for its 21 new methods in
`tests/caring-contacts-repository.test.ts`, which constructs `createInMemoryRepository` directly and is
therefore in-memory-only. As things stand, Task 11 would implement 21 Postgres methods against ZERO
behavioural proof — including the service-stop gate, the cross-team singleton, and the dual-approval
construction just fixed under Ruling 14 — and the two stores could disagree on every one of them silently.
That is precisely the drift the contract file was created to prevent.

Ruling: [23] The behavioural tests Task 10 wrote for the new methods MOVE into the shared contract suite,
so both stores are held to them; only assertions that genuinely poke in-memory internals stay behind.
— Why: the contract file is the definition of what a CaringContactRepository does, and the safety-critical
behaviours (service stop gates every mutation, the stop is service-wide, a saved pathway version is always
an unapproved draft, a service-stopped refusal is not cached against the idempotency key, every write is
audited) are worth nothing if only one of the two implementations is held to them. — Cost if wrong: the
Postgres suite becomes slower and needs a real database to prove behaviour the in-memory store already
proved cheaply; if that cost is judged too high the move is reversible by copying the tests back.

Ruling: [24] Task 11 is dispatched as TWO sequential subtasks rather than one. 11a: migration 0003, the
`seedPlan` helper extension, and the schema/RLS proofs in `tests/caring-contacts-migrations.test.ts`.
11b: move the Task 10 behavioural tests into the shared contract (which turns the Postgres suite red for
exactly the right reason), then implement the ~21 methods in `postgres-repository.ts` until it is green.
— Why: the brief's single task is a 928-line store gaining 21 methods PLUS a schema conversion PLUS an RLS
redesign PLUS a test relocation; one dispatch would produce a diff too large to review as a unit, and 11b's
red-then-green sequencing is only honest if 11a's schema already exists. — Cost if wrong: two review
surfaces instead of one, and the branch sits with a red Postgres suite between the two commits — which is
already true today and is stated in the resume point.

Docker/Postgres BASELINE RE-VERIFIED on the durable container, before any Task 11 work:
CARING_CONTACTS_DATABASE_URL=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres
npm run caring-contacts:db:test
-> Test Files 2 passed (2)
Tests 55 passed (55)
So the earlier 7 failed / 48 passed was entirely the `--rm` container being removed mid-run, not a schema
defect. 55/55 is the number Task 11a must hold at or above; any migration-test failure from here is real.

Task 10: fix round 1/5 dispatched to a fresh implementer on Opus 5 (the original implementer belonged to a
previous session and was unreachable), carrying Rulings 14, 15 and 16 plus the five findings.
Task 10: fix round 1/5 result — commit 944ce3201, 101 passed (was 84), eslint and prettier clean, tsc shows
only the known deliberate postgres-repository.ts error. Implementer returned DONE_WITH_CONCERNS with five
concerns, two of which are substantive and are recorded below. Scoped re-review dispatched over
711f95027..944ce3201 (the docs commits d14a60160 and 711f95027 are disjoint and excluded).

Task 10 fix round 1, implementer concern worth keeping: the `getServiceState` half of Important 4 did NOT
reproduce. `service-state.ts` already Object.freezes every value it constructs, including the
restartApprovals array and each approval, so the returned singleton was already deeply immutable. The
implementer proved this by mutation — removing its own added freeze left the suite green (a no-op mutation
that proves nothing), while removing the UPSTREAM freeze in applyServiceStop did turn the test red. It
reports service-state.ts byte-identical to HEAD. The getAssignment half was a real defect and is fixed with
a clone. Pending the re-reviewer's adjudication of whether the added freeze earns its place or is redundant.

Task 10 fix round 1, implementer concern worth keeping: the Important 2 mutation had to be redone. The first
attempt (replacing createReferral wholesale) reddened three tests, but two of those were catching permission
checks the mutation had also dropped — it conflated two defects and would have over-credited the new audit
test. The targeted re-run kept every permission and duplicate check and moved only the commit outside
runWrite; exactly one test failed, the new audit test. This is the third time on this branch that a proposed
mutation turned out to prove something other than what it claimed. The rule stands and is earning its keep:
before trusting a mutation, confirm it changes a value some assertion actually reads.

Task 10 fix round 1, deferred minors added: pathway-versions.ts has no draft factory, so savePathwayVersion
and its test helper now build the same draft shape independently — worth a factory when Task 11b needs the
same construction for the Postgres store. And getServiceState relies on shallow freezing rather than a
structural clone, so a future nested mutable field on ServiceState would escape it; a clone would be durable
but breaks the reference identity the existing singleton test reads.

Ruling: [25] The two new foreign keys `plans.referral_id` and `plans.pathway_version_id` are COMPOSITE
same-team keys — `(referral_id, team_id) references referrals (id, team_id)` and likewise for pathway
versions — each backed by a redundant `UNIQUE (id, team_id)` on the parent, rather than bare single-column
keys. — Why: foreign-key checks are performed by the system and are NOT subject to row-level security, so a
bare key lets a TEAM-NORTH plan point at a TEAM-SOUTH referral; in a schema that goes as far as answering
cross-team existence questions through SECURITY DEFINER functions returning a bare boolean, a link that
silently crosses teams is the wrong default. — Cost if wrong: if a pathway version is ever meant to be a
SHARED library across teams rather than team-owned, the composite key is exactly wrong and must become a
bare key; the brief tells the implementer to stop and report rather than force it if it meets that.
Two redundant unique constraints otherwise.

Task 11a and 11b briefs written to task-11a-brief.md and task-11b-brief.md, carrying Rulings 2, 4, 9 and
19-25, plus two harness traps found by reading the existing helper: migrations apply in sorted filename
order so 0003 must DROP 0002's team-scoped service_state policy rather than add a second one (Postgres ORs
permissive policies, so an added policy would be redundant rather than a replacement); and
CARING_CONTACTS_DATA_TABLES is a hand-maintained child-first truncation list that every new table must join
or rows leak between tests as order-dependent failures.

Task 10: fix round 1/5 (7 addressed, 0 open — pathway-version governance bypass closed with all nine
PathwayVersion fields enumerated server-side and no spread; per-group audit-event test covering nine write
groups; service-stopped refusal no longer cached, proven with the SAME key after three restart approvals;
getAssignment deep-cloned; claim refused when it names another actor while coverage/reassign still name
third parties; trainingWorkspaceIsolated deleted; ACMA fictitious number adopted; two overclaiming titles
corrected. Commits 711f9502..944ce320)
Task 10: complete (commits 88e774c95..944ce3201, review clean) — 101 passed, up from 84.
Task 10: the re-reviewer independently verified rather than trusting the report — it checked the nine-field
literal against the PathwayVersion type itself, read all of runWrite to confirm the idempotency change was
not widened beyond the one refusal, grepped every REMOVED line in the diff for `expect(` and found exactly
one removed assertion (replaced in place by a strictly stronger one) and one rename, and confirmed
service-state.ts carries no hunk at all. No expectation value was changed anywhere, so the narrow
authorised exception for a test asserting the vulnerability was never needed.
Task 10: reviewer adjudication accepted — the getServiceState half of Important 4 WAS a false positive in
the original review. service-state.ts freezes at all three construction sites (runningService,
applyServiceStop, applyServiceRestartApproval), every non-array field is a primitive, so the singleton was
already deeply immutable. The added freeze is redundant defence and stands because it moves the read
contract into the store rather than borrowing it from another module; its covering test pins a real
falsifiable property, just not one the new line creates.

Task 10 deferred minors added by the re-review (carry to the FINAL WHOLE-BRANCH REVIEW):

- savePathwayVersion stores `input.version.snapshot` BY REFERENCE, so a caller holding the input object
  can still mutate stored authored clinical content in place, with no version bump and no audit event.
  Pre-existing (the old spread aliased it too) and outside Ruling 14, but it is now the ONLY
  caller-supplied field left and is the same class as the Important 4 finding. This is authored clinical
  message content — treat it as the highest-value of the deferred minors. The Postgres store will not
  inherit it (jsonb serialisation copies), so after Task 11b the two stores will differ here.
- Ruling 15 side effect, inherent not a defect: after a service-stopped refusal the idempotency key is
  released, so a DIFFERENT later request reusing that key is processed rather than refused as
  idempotency-key-reused.
- getServiceState performs Object.freeze on the internal singleton — a read with a (currently no-op)
  side effect on stored state; a hazard only if a future path intends to build a state and mutate it
  later. Pairs with the implementer's own concern that a shallow freeze would not reach a future nested
  mutable field.
- Report-accuracy nit, not code: the stated reason for freezing rather than cloning (that a clone would
  break the singleton-identity test) does not hold — that test uses toEqual, not toBe. The decision
  stands regardless, since the finding permitted freezing.
- Audit test residual limit, beyond what the brief required: it proves an event is appended, not that
  the commit is ORDERED inside the audited path. A method that committed and then separately pushed an
  event would still pass.

## RESUME POINT (supersedes all earlier ones)

Group 1 (Tasks 1-9) and Task 10 are COMPLETE and reviewed. HEAD = 944ce3201.
NEXT: Task 11a (migration 0003), brief at task-11a-brief.md, then Task 11b (shared-contract move + the
Postgres store), brief at task-11b-brief.md. Both split by Ruling 24. Task 11a carries Rulings 2, 4, 9,
19, 20, 21, 22 and 25; Task 11b carries Rulings 3, 14, 15 and 23.
Docker is RUNNING; container `caring-contacts-pg` on 127.0.0.1:54329; baseline is 55/55 passing.
`npm run typecheck` stays RED on db/postgres-repository.ts until Task 11b. That is expected.
Then Tasks 12-19. Ruling 13 binds Task 15 (lazy route boundary from the first commit). The owner's
clarification binds Task 15 and all of Plan 2B: Caring Contacts is a standalone application owning its own
sidebar; its destinations go in ITS rail, never the host app's nav.

## PROCESS GAP FOUND 2026-08-19 — a real red survived Task 10's completion

`npm run test` has ONE failure at HEAD: `tests/caring-contacts-retention.test.ts` >
"is the only module in src/lib/caring-contacts that hard-codes a retention period". It walks the sealed
domain, skips `retention.ts`, and pushes an offence for any file matching `/retention/i` OR
`/\byears\s*:\s*7\b/`. Task 10's mandated `markRetentionCleared` puts the word into `repository.ts` (2 hits)
and `in-memory-repository.ts` (6 hits). The `years: 7` half still passes — no period is hard-coded anywhere.

Origin VERIFIED by the controller rather than inferred, counting matches per commit:
3272c8701 (pre-Task-10) repository.ts=0 in-memory=0
6bf9f6362 (Task 10) repository.ts=2 in-memory=6
944ce3201 (Task 10 fix) repository.ts=2 in-memory=6
So it entered with Task 10's ORIGINAL commit and Task 11a is innocent. The Task 11a implementer's claim that
it was pre-existing was correct; it flagged the claim as inferred rather than verified, which is why I
checked it.

WHY IT SURVIVED: Task 10 ran only `node scripts/run-vitest.mjs run tests/caring-contacts-repository.test.ts
tests/caring-contacts-domain-isolation.test.ts` (84 passed), and its fix round ran the same two files
(101 passed). Neither ran `npm run test`. Checkpoint 1, after Task 9, was the last full-suite green
(7604 passed). Task 10's own review could not catch it either: the reviewer reads a diff, and the offended
test file is not in that diff. A task that ADDS a name to a sealed directory can break a static scan that
lives outside its diff, so the focused gate is structurally blind to it.
CORRECTION TO PROCESS for the rest of this plan: run `npm run test` (not just the focused files) before
declaring complete any task that adds or renames an exported symbol inside `src/lib/caring-contacts/`,
because that directory is policed by static scans in files no such diff will contain.

Ruling: [26] The retention scan's WORD-MENTION half gains a narrow named allowlist for exactly the two
storage files, carrying a comment that says why, and those two files gain a compensating assertion that no
line mentioning retention also contains a digit — so a hard-coded period spelled any way (RETENTION_YEARS =
7, retentionYears: 7) is still caught there. The `years: 7` half is untouched and still applies to every
file including those two. — Why: the assertion's own title is "hard-codes a retention PERIOD", and the
`years: 7` half is what tests that; the word-mention half is a broader sealed-module rule that Task 10's
plan-mandated `markRetentionCleared` necessarily trips, because the storage layer must be able to NAME the
thing it stores. Renaming the method to dodge a regex would make the storage API vaguer to satisfy a check
that is broader than its own stated intent. This is narrowing an over-broad check to its title while adding
a stronger replacement for the two files it exempts — not deleting or loosening the assertion.
— Cost if wrong: if the intent really was "no module outside retention.ts may even name retention", then
`markRetentionCleared` and `retentionCleared` must be renamed instead, and the allowlist reverts.

Task 11a: reviewed (Opus 5, BASE e717b9de0, HEAD 8b557608e). Verdict: APPROVED with 0 Critical,
3 Important, 7 Minor. 71 passed against a verified 55/55 baseline. Every row of the schema table
implemented; singleton enforced three ways (default + CHECK + primary key); 0002's team-scoped
service_state policy genuinely DROPPED and removed from 0002's driven array rather than supplemented, so
the Postgres permissive-OR trap is avoided rather than papered over; every behavioural proof runs against
the database as caring_contacts_app and asserts on a NAMED CONSTRAINT, so Task 11b can map every refusal
by name; every deny-assertion is paired with a positive control; all five CHECK lists verified byte-exact
against their TypeScript unions.
Task 11a: the reviewer verified the out-of-brief file edits precisely — the ENTIRE diff removes seven
lines, none of them a test expectation. It also found that the contract fixture it repaired (a TEAM-SOUTH
plan naming TEAM-NORTH's REFERRAL-1) was latent evidence that Ruling 25 caught a REAL cross-team defect,
not merely an inconvenience. Ruling 25 is vindicated.
Task 11a: mutation discipline noted as the best on this branch — mutation 2 re-keyed both uniques onto the
team while HOLDING THE CONSTRAINT NAMES CONSTANT, which is the only version that isolates the second-stop
test, and the report named the one trivially-passing new test as a control rather than counting it as proof.

Ruling: [27] Ruling 25's composite same-team foreign key is EXTENDED to `plan_assignments` and
`plan_reassignments`: `unique (id, team_id)` on `plans`, then `(plan_id, team_id) references plans (id,
team_id)`. — Why: foreign-key checks bypass row-level security, so as built TEAM-SOUTH can insert a
plan_assignments row for TEAM-NORTH's plan while claiming `team_id = 'TEAM-SOUTH'` — the RLS `with check`
validates only the CLAIMED team, not the plan's. The row is then visible to TEAM-SOUTH and invisible to
TEAM-NORTH, which misplaces the assignment's entire RLS scope; that is verbatim the failure Ruling 25 was
written to prevent, and these are NEW tables so the exposure is newly introduced rather than inherited.
Ruling 25 named only two keys because I wrote it before these tables existed. — Cost if wrong: two
redundant constraints, kept correct by the foreign key itself.

Ruling: [28] A `service_stops` history table is added NOW, in Task 11a's fix round, rather than deferring
the hazard to Task 11b's discipline. One immutable row per incident (stop_id primary key, reason, note,
stopped_by, stopped_at, reported_by_team_id, restarted_at); `service_restart_approvals.stop_id` becomes a
REAL foreign key to it; the `service_state` singleton points at the current stop. — Why: as built, a
restart leaves the three approval rows behind with the old stop_id and NOTHING — no constraint, no trigger,
no test — stops a store from counting them toward the next incident. A `getServiceState` that populates
restartApprovals without a `where stop_id = <current>` filter would present a brand-new live incident as
already three-person approved, which is a zero-approval restart of the exact failure the three-person rule
exists to prevent. The implementer was right that no non-destructive FK exists against a MUTABLE singleton
(restartService sets stop_id to null while children still reference it), but stops as immutable history
rows make the FK natural and move the guarantee from "Task 11b must remember a WHERE clause" into "the
schema cannot express the wrong thing" — which is this branch's stated standard, set at Ruling 8. — Cost
if wrong: one extra table and a slightly larger 11b, and if incident history is later judged unwanted the
table is droppable with the FK reverting to the current bare column.

Ruling: [29] `service_state` gains the `require_audit` constraint trigger, matching its sibling
`service_restart_approvals`. — Why: as built, RESTARTING the service is forced to write an audit event and
STOPPING it is not, which is the asymmetry the wrong way round; this task rewrote that table's key, columns
and policy, so the brief's "new tables only" scoping reads thin. The 0001 comment "Stopping must never be
blocked" is not a counter-argument: every write goes through runWrite, which writes its audit event in the
same transaction, and an audit-integrity-loss stop exists precisely to preserve the trail. — Cost if wrong:
if some future path must raise a stop outside an audited transaction, the trigger blocks it — and that path
should not exist.

Task 11a minors, deferred to the FINAL WHOLE-BRANCH REVIEW: the singleton conversion is not
data-migration-safe for a table that already holds two or more per-team rows (harmless today, nothing is
deployed, but the migration reads as if it handles the existing shape); the coverage calendar-day CHECK is
asserted by column type but nothing writes `2026-3-2` and watches it refused; `attach_audit_guard` lacks a
`set search_path` unlike its 0001 siblings (cosmetic, it is SECURITY INVOKER and fully schema-qualified);
and the Postgres and in-memory runs of the shared contract now start from DIFFERENT preconditions (the
Postgres run alone pre-creates parents and empties the audit table), so the contract can no longer prove
the Postgres store validates its own parents — when Task 11b makes the contract create its own parents,
the beforeEach and the REFERRAL-3/PATHWAY-2 fixture line must be revisited TOGETHER, and the temptation at
that moment will be to relax an assertion instead. Flagged now so it is not discovered as a surprise.

Task 11a: fix round 1/5 (3 rulings + 3 minors addressed, 0 open — Ruling 27 composite keys on
plan_assignments/plan_reassignments, Ruling 28 service_stops history table with a REAL FK from
service_restart_approvals, Ruling 29 require_audit on service_state and service_stops, plus
pathway_version_approvals proven, notification_preferences/training_records given RLS and cross-team tests,
and the author_id trap commented in the SQL; commits 8b557608e..8d7319c54). 87 passed, up from 71.
Task 11a: the Ruling 27 exposure was REPRODUCED LIVE before the fix — TEAM-SOUTH's write into TEAM-NORTH's
plan actually committed in the red run rather than being reasoned about. Ruling 27 was not theoretical.
Task 11a: honest mutation gap reported rather than substituted — mutation F reddens the new zero-approvals
test by making the RESTART fail, not by letting a closed incident's approvals count toward a new one. The
implementer could not construct a schema mutation for the latter BECAUSE, after Ruling 28, that behaviour is
no longer expressible in the schema at all; counting stale approvals can now only be a store bug. So that
test is correctly read as a regression guard aimed at Task 11b's READ PATH, not as proof of a constraint.
Mutation F does prove Ruling 28 was load-bearing: the pre-ruling shape cannot support
stop -> approve -> restart -> stop at all.
Task 11a: three-column pathway_version_approvals_version_fk KEPT, and the implementer supplied the evidence
I asked for rather than an opinion — reduced to a bare key, both a row claiming the wrong team and a row
naming a fabricated author to escape the self-approval check commit successfully. In scope, accepted.

Ruling: [30] `service_stops` rows become ENFORCED immutable — a `before update` trigger rejecting any
change other than `restarted_at`. — Why: the table exists to be the durable record of safety incidents, and
`audit-integrity-loss` is itself one of the five stop reasons, so a history table whose closed rows can be
silently rewritten undercuts the thing it was added for; "immutable by convention plus a primary key" is
exactly the standard this branch has refused everywhere else. — Cost if wrong: if an incident's reason ever
needs legitimate correction, it must be done as a new row or an explicit migration rather than an update.

Ruling: [31] `service_state` DROPS its duplicated `stopped_reason` and `stop_note`; the current incident's
reason and note live once, in `service_stops`, reached by `stop_id`. `service_state_stop_is_identified`
narrows to "stopped implies stop_id is not null", with the foreign key and `service_stops.reason not null`
carrying the rest. — Why: two copies of a safety incident's reason can drift, and a banner that renders the
stale one on every screen is the worst place for that to surface; the original brief required those columns
only because it was written before Ruling 28 created a history table to hold them. The implementer's
alternative — a composite FK holding both copies in sync — keeps the duplication and adds a constraint to
police it, where removing the duplication needs neither. NOW is the cheapest possible moment: nothing writes
this table yet, so no drift can already exist and no store code must change. — Cost if wrong: a reader
wanting the reason without a join must do one join.
