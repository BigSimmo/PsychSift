# Mental Health Act timeframes: owner's attribution confirmed

On 3 October 2026 the project's coordinator asked Josh, PsychSift's clinical owner, whether he
personally signed the nine Mental Health Act timeframes in `data/mha-timeframes.json` that are
marked as reviewed by "PsychSift". He replied: "Yes I did to both".

This confirms, for these nine timeframes, what
[`pr-3143-owner-signoff-confirmation.md`](pr-3143-owner-signoff-confirmation.md) already records
for the sign-offs in PR #3143: the public reviewer attribution "PsychSift" is Josh's own clinical
sign-off, not a review by an automated agent.

What it changes: `OWNER_CONFIRMED_TIMEFRAMES` in `src/lib/on-call/mha-timers.ts` lists these nine
sign-offs by exact id, reviewer, sign-off time (2026-09-26T17:21:45.126Z) and content pin, so they
count as signed by a named clinician for the On Call countdowns. Any other timeframe labelled
"PsychSift", including one of these re-signed later, does not count until Josh confirms it too.
The list is part of the countdown switch's signed content, so changing it switches the countdowns
off until the switch is signed again.

What it does not change: each sign-off still covers only its pinned content, so editing a timeframe
still needs a fresh sign-off. The countdowns remain off until Josh signs the countdown switch
himself with `npm run rules:sign -- --write`, including the medical-device ruling. The other part
of "both" is not recorded here as any further sign-off: those come only from Josh running the
sign-off tools himself.
