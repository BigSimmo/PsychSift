# Decision: The sign-offs recorded in #3562 and #3571 go back to awaiting review, and the owner's 2 Oct lithium attestation is restored

- **Status:** decided 2026-10-21
- **Source:** `tests/sign-off-queue.test.ts`, find "21 Oct 2026: the #3562 and #3571 sign-offs went back to waiting"

On 21 Oct 2026 at 11:41 AWST the owner answered the three questions left by the 20 Oct clinical content audit
(R6-F-04, R6-F-01 and R7-F-13) with "Go ahead with all recommendations". The rulings are:

1. **The "Psych Sift" sign-offs recorded in #3562 (commit 5319dab78) and #3571 (commit e526f8a4d) were not the
   owner's.** They reset the same way as the 17 Oct ruling on #3613: 85 specifier reviews return to
   `clinician-review-pending` with no reviewer, date or pin; 27 therapies return to `needs_review` with an unticked
   checklist, their earlier completeness score and no reviewer, date or pin; Act section 357 returns to `drafted`
   (section 14 was already reset by #3692). The two Australian Prescriber lithium records and the WA clozapine
   guideline return to their #3143 `candidate` state, so the lithium and clozapine medicine pages show no source
   link until a source is adopted again. The 16 Oct re-sign of the interaction lexicon is removed, so the sheet
   reports its 28 Sep sign-off as not current. The 21 service sign-offs that #3571 only re-dated return to their
   original #3143 date, because their content pins never changed. No attestation was recorded.
2. **The owner's 2 Oct lithium source attestation stands.** The 18 Oct withdrawal on
   `ps-diff-src-au-ausprescr-lithium-2020` (commit ace6626d6, PS-009) is reversed by restoring the record exactly as
   the owner confirmed it through #3143, so `check:source-acquisitions` passes again.
3. **The 18 signed therapies whose format label read "Group programme" while their own text says the therapy is
   usually individual** now read "Multi-session", as #3692 did for the unsigned ones, and return to `needs_review`
   for the owner to re-sign.

Under the 18 Oct ruling on unsigned clinical text, the prose of every reset therapy and specifier is withheld from
answer evidence and site content until the owner signs it again with `npm run therapy:review` or
`npm run clinical:review`.

Not decided here: the 16 Oct decision that accepts "Psych Sift" as the owner's display name was itself written by
#3562 and still stands, and the 15 Oct re-sign of the Today page MHA timers (recorded in the owner's own name) is
awaiting the owner's answer.

If this summary and the source ever differ, the source wins.
