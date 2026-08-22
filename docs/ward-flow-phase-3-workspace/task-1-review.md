# Task 1 review — the model and the fixture

Reviewed range: `fbd9a8628..39042cd61` (commits `f3b1f74f0`, `39042cd61`).

## Spec compliance: APPROVED

All required interfaces added verbatim (`formedAt`, `arrivalMode`, `bedHeldUntil`, `examination`,
`withdrawnReferrals` required-not-optional, `escalation`, `Rejection`, `DECLINE_REASONS` at seven
with `out_of_catchment`). All numeric/count requirements verified against the actual fixture
values, not just the report's claims: three community-formed records at 90/120/150 min before
`openedAt` (all inside the 60–240 window), one at `peel-ed` (WF-005); one police arrival (WF-009),
two ambulance (WF-002, WF-003); every `bed_held` movement (hand-authored and all four generated
ones landing on that stage) carries `bedHeldUntil`, with both a lapsed (WF-004) and running
(WF-011, WF-016, all four generated) instance; zero `"3A"` remains anywhere in
`ward-model.ts`/`ward-movements.ts` (confirmed by grep — the surviving `"3A"` hits are in an
unrelated forms-catalogue module, not this fixture); all five load-bearing `referredUnitIds`
(`sjgm-adult-open`, `gry-adult-secure`, `fsh-older-adult`, `bty-adult-secure`,
`bty-older-adult`/`gry-older-adult`) are untouched context lines in the diff. Generated values
are index-derived only (no `Math.random`/`Date.now`/`new Date(` in either file).

One interpretation worth flagging, not a violation: the brief's "the five movements currently on
`3A` become `1A`" reads, taken alone, as applying to all five, but the diff sends three of them
(WF-003, WF-009, WF-017) straight to `3B` and never shows them as `1A`. The next bullet
("several movements gain an examination ... and move to 3B") only makes sense if it's describing a
subset of that same five, since there's no other source of ex-3A records — so the two bullets
together are more consistent with the implementer's reading than a literal first-bullet-only
reading. No later task's requirement (only WF-005 and WF-017 are named as load-bearing) depends on
which of the five stayed at 1A, so this doesn't affect anything downstream.

## Task quality: APPROVED

I independently re-ran the required suite (87/87 pass) and `tsc --noEmit` (clean) rather than
trusting the report's pasted output. I also independently mutated the fixed privacy-guard test in
both directions the report claims to have checked: widening `forbidden` to `/.*/ ` fails the test
(`expected '...' not to match /.*/`), and reverting `WF-006`'s `withdrawnReferrals` back to `[]`
fails the new tripwire (`expected 2 to be greater than or equal to 3`) — both confirmed directly,
not assumed from the report.

Per-test soundness check (what single change kills each new/modified test):

- `records out-of-catchment...` — dies if the entry or the uniqueness holds. Sound.
- `gives every movement a withdrawn-referral list...` — dies if any of the 48 movements lacks the
  field. Sound, not vacuous (iterates the full array).
- `never dates a form later...` / `carries at least one community-formed...` — dies on any
  `formedAt > openedAt`, or if the three community-formed records were removed. Real data
  exercises both, not gated behind an always-false `if`.
- `carries at least one patient brought in under police escort` — dies if WF-009's `arrivalMode`
  reverts. Sound.
- `carries at least one examined patient...` — dies if `examination.at` were ever future-dated or
  the examined set emptied. Sound.
- `holds a bed only with a time to expire at` — the flagged "loop executes zero times" shape does
  NOT apply here: `bed_held` is hit by 3 hand-authored + 4 generated records, confirmed by
  computing `index % 7 === 3` for `index` 300–329 myself (304, 311, 318, 325, matching the
  report). Without the generator fix this test would have failed outright, not passed vacuously.
- `puts a patient on 1A...on 3B once examined` — the `expect(code).not.toBe("3A")` assertion runs
  unconditionally every iteration (not behind an `if`), so a regression reintroducing "3A" is
  caught immediately. The 1A/3B branches are each exercised by real records.
- `carries at least one patient on each of 1A and 3B` — real, both codes present in the fixture.
- `keeps every new field free of anything that identifies a person` — verified myself as described
  above; the fix is sound in both directions.

No findings. The report's ambiguity log (`Unsure about`, "Ambiguities and how I resolved them") is
accurate and each resolution was checked against the actual diff and test behavior rather than
taken on faith.
