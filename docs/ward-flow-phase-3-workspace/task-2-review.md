# Task 2 review: the reducer

## Verdicts

- **Spec compliance: APPROVED.** Test file is byte-identical to the brief (diffed directly — only
  difference is the brief's leading `// tests/ward-flow-reducer.test.ts` comment line, not present
  in the committed file). All named interfaces produced (`WardFlowRole`, `WardFlowEvent`,
  `WardFlowState`, `seedWardFlowState`, `wardFlowReducer`, `EVENT_ROLE`). 13/13 tests pass, `tsc
--noEmit` clean. All five load-bearing `referredUnitIds` entries and both WF-009/WF-017 seed
  stages (`destination_review`, needed for the "last bed" and re-referral tests) are untouched —
  this diff adds only new files, never edits the fixture. No auto-allocation, no `Math.random()`,
  no wall-clock read, `now` arrives on every event. Nothing required by the brief is missing;
  nothing present exceeds what §6/the brief asked for.

- **Task quality: CHANGES REQUESTED.** The reducer is well-structured (consistent
  find/reject/replace helpers, no in-place mutation found on manual audit of all 15 branches), but
  test coverage is dangerously uneven, and I independently confirmed by mutation that a
  legal-status-changing branch and a bed-capacity-setting branch can each be gutted to a pure
  no-op with the entire test suite (13 reducer tests + 62 across the `ward-management` surface)
  staying green.

## Findings, most consequential first

1. **`src/components/ward-management/ward-flow-reducer.ts` `RECORD_EXAMINATION`
   (`inpatient_order` branch, ~line 263) — completely unpinned.** I replaced the whole case with
   `return state` (pure no-op) and reran the reducer suite plus the other four `ward-management`
   suites: 62/62 still pass. This is the branch that moves a patient's legal form from `1A` to
   `3B` — a detention status change, the single highest-consequence transition in the file per the
   brief's own ranking cue — and it has zero test exposure anywhere in the repo (`grep -rn
RECORD_EXAMINATION tests/` returns nothing). The `community_order`/`revoked` closing branch is
   equally unpinned. Cheapest pinning test: seed has multiple `legalForm.code === "1A"` movements
   (e.g. line 22, 109, 281, 328, 419 of `ward-movements.ts`); assert `RECORD_EXAMINATION` with
   `outcome: "inpatient_order"` turns one into `code: "3B"`, and with `outcome: "revoked"` clears
   `legalForm` and sets `closure.outcome === "did_not_proceed"`.

2. **`CONFIRM_CAPACITY` (~line 495) — completely unpinned.** Same test: replaced the case with
   `return state`, full suite still green. This branch directly sets `unit.allocatable.value` —
   the number the rest of the app treats as "beds the ward says exist" — with no test anywhere
   confirming it's applied, let alone that `source`/`confirmedAt` update correctly. Cheapest
   pinning test: dispatch `CONFIRM_CAPACITY` for a known unit and assert
   `allocatable.value/source/confirmedAt` on the returned state.

3. **`DECLINE` (~line 383) — completely unpinned.** Same no-op test, full suite still green. This
   removes a unit from `referredUnitIds` and records a `Decline` — the mechanism by which a bed
   offer is actually retracted from a movement — with zero test coverage in either this task or
   anywhere else in `tests/`. Cheapest pinning test: refer a movement to two units, `DECLINE` one
   with a `DeclineReason`, assert the unit is gone from `referredUnitIds` and appears in
   `declines`.

4. **`RECORD_ESCALATION`, `ADVANCE_CLOCK`, `RESET_SCENARIO` (~lines 212–216, 505) — also
   completely unpinned**, confirmed by grep (zero references to any of the three anywhere under
   `tests/`), not separately mutation-tested since none touches a bed or a legal status. Lowest
   consequence of the six gaps, but `RESET_SCENARIO` returning something other than a fresh seed
   would go undetected, which matters for the "demo reset" the coordinator screen depends on.
   Cheapest pinning tests: `ADVANCE_CLOCK` — assert `clockOffsetMinutes` increments;
   `RESET_SCENARIO` — mutate state, reset, assert deep-equality with a fresh `seedWardFlowState()`;
   `RECORD_ESCALATION` — assert `escalation` is set with the given `contact`/`triedUnitIds`.

Net: 6 of the reducer's 15 event branches (`RECORD_EXAMINATION`, `CONFIRM_CAPACITY`, `DECLINE`,
`RECORD_ESCALATION`, `ADVANCE_CLOCK`, `RESET_SCENARIO`) have no test anywhere in the repository —
not even indirect exercise through a chained sequence, unlike `HANDOVER_READY`/`TRANSPORT_*`/
`PATIENT_COLLECTED`, which are silently proven by the "arrival" test's `rejections === []`
assertion (a no-op there would cause the next chained event's precondition check to reject).
The report discloses this gap in its own "Concerns/follow-ups" section, but doesn't rank it or
show it's exploitable — the mutation runs above are the missing verification.

## Invariant checks (all sound, no findings)

- No branch mutates `state`, a movement, or a unit in place — every case builds a new object via
  spread and routes through `replaceMovement`/`replaceUnit`. Manually audited all 15 cases.
- `allocatable.value` cannot go negative: `HOLD_BED` guards `value <= 0` before decrementing, and
  `CONFIRM_CAPACITY` is the ward's own explicit override (the human-confirm path the brief
  requires to exist), not an automated adjustment.
- No branch leaks a bed back (increments `allocatable.value`) without an operator-driven
  `CONFIRM_CAPACITY`.
- Every refusal path goes through `reject()`, which always appends a `Rejection` — no silent
  pass-through found.
- Minor, non-blocking: `PATIENT_ARRIVED` decrements `unit.empty.value` with no floor check
  (unlike `HOLD_BED`'s `allocatable` guard), so a stale feed (`empty.value === 0` while
  `allocatable.value` was manually confirmed higher) could drive `empty.value` negative. Not
  asked for in the brief's invariant list and not exercised by any current fixture path, so not
  ranked among the four core findings above — flagging for whoever picks up direct coverage of
  `PATIENT_ARRIVED`.
