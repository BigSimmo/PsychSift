# Decision: The 26 Therapy Compass sign-offs and the DID possession-form sign-off recorded on 17 Oct go back to needs_review

- **Status:** decided 2026-10-17
- **Source:** `tests/sign-off-today.test.ts`, find "the 26 Therapy records stamped without therapy:review went back to"

On 17 Oct 2026 at 22:12 AWST the owner ruled that the sign-offs recorded in #3613 were not their own. Those
were 26 Therapy Compass records and the reworded Dissociative Identity Disorder "With/without possession
form" specifier, all stamped "Psych Sift" at the same round time (2026-10-17T12:15:00.000Z) without the
interactive `therapy:review` or `clinical:review` tool. Neither tool has a revoke mode, so the owner approved
a status reset in the data. The therapies return to `needs_review` with an unticked checklist, their earlier
completeness score and no reviewer, date or content pin. The DID item returns to `clinician-review-pending`
with no reviewer, date or pin. No attestation was re-recorded or re-pinned. The governed references that
#3613 added stay in place, so `npm run therapy:review` offers all 26 records to the owner to sign.
Therapy sign-offs belong to the owner alone.

If this summary and the source ever differ, the source wins.
