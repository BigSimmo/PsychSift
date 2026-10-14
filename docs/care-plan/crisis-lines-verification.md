# Care Plan — crisis line verification record

> **DRAFT — requires clinical sign-off by the owner before any real-patient use.**
>
> This is a record of what the repository already asserts about eight public telephone numbers, and
> of what it does **not** assert. It is not clinical authority, it is not itself a verification, and
> nothing in it approves the Care Plan prototype for use with a patient. **No number was dialled or
> checked online while this document was written** — there was no network access in that session.

**Status:** first draft, 2026-09-04. Unreviewed.
**Subject:** every telephone number printed by the Care Plan prototype's fixtures. As of the
2026-09-25 WA safety fixes, the array itself is defined once in
`src/lib/crisis-contacts.ts` (`WA_CRISIS_CONTACTS`) and re-exported unchanged as
`publicCrisisContacts` from `src/components/care-plan/mockups/fixtures.ts`, so every consumer
listed in this document still reads the same values under the same name. This record covers
all eight contacts: the original four, Lifeline, Suicide Call Back Service, and 13YARN added
in that change, and the separate `POISONS_INFORMATION_CONTACT` added in October.
**No number in this document has been changed.** This record was written alongside a
verification-record comment in the fixture; the values themselves are untouched.

## Why this record exists

The 2026-09-02 repository audit
([`docs/audit/full-repository-audit-2026-09-02.md`](../audit/full-repository-audit-2026-09-02.md))
recorded that the four real public crisis numbers carry a `verifiedOn` date of `2026-08-20` and a
comment saying to correct them if they have changed, but that **nothing ages that date** — no test,
no gate and no ledger row — while the same file models its synthetic community-team contacts as
`review_due` after a few months. These numbers render on the printed Personal Safety Plan and on the
Patient Plan, which are sheets a person is meant to take home.

The audit's own skeptic note is worth repeating, because it sets the size of the problem honestly:
the prototype is developer-gated synthetic data behind the production mockup block, so nobody takes
this sheet home today. The risk materialises if these fixtures are copied into a production screen.

## The public crisis numbers

Every source URL below is already present in this repository. Nothing was looked up to write this. The table covers only numbers represented by records in `src/lib/crisis-contacts.ts`.

| #   | Service                                                            | Number as printed | Source used to check it                                                                                                                  | Where that source is recorded in this repository                                                                                                      | `verifiedOn` in the fixture         | Definition and other call sites                                                                                                       |
| --- | ------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Emergency services                                                 | `000`             | https://www.triplezero.gov.au/ (organisation root — no deep link, and `sdd-ledger.md` records that a slug was deliberately not invented) | `src/lib/crisis-contacts.ts:44`; the organisation-root decision at `docs/care-plan/sdd-ledger.md:609`                                                 | `2026-08-20`                        | `crisis-contacts.ts:36` (the record). Also printed in `patient-safety-plan.tsx`'s prose, sourced from the module rather than retyped. |
| 2   | Mental Health Emergency Response Line (MHERL) — Perth metropolitan | `1300 555 788`    | https://emhs.health.wa.gov.au/Hospitals-and-Services/Mental-Health-Alcohol-and-Other-Drugs/Inpatient-and-Other-Services/MHERL            | `crisis-contacts.ts:57`; also `docs/care-plan/claude-build-handover-2026-08-21.md:157` and `docs/superpowers/specs/2026-08-20-care-plan-design.md:31` | `2026-09-27` (`2026-08-20` initial) | `crisis-contacts.ts:48` (the record), `fixtures.ts:200` (North River after-hours)                                                     |
| 3   | Mental Health Emergency Response Line (MHERL) — Peel               | `1800 676 822`    | the same WA Health MHERL page as #2                                                                                                      | `crisis-contacts.ts:70`                                                                                                                               | `2026-09-27` (`2026-08-20` initial) | `crisis-contacts.ts:61` (the record), `fixtures.ts:217` (Coastal Plains after-hours)                                                  |
| 4   | Rurallink                                                          | `1800 552 002`    | https://emhs.health.wa.gov.au/Hospitals-and-Services/Mental-Health-Alcohol-and-Other-Drugs/Inpatient-and-Other-Services/Rurallink        | `crisis-contacts.ts:84`; also `docs/care-plan/claude-build-handover-2026-08-21.md:158`                                                                | `2026-09-27` (`2026-08-20` initial) | `crisis-contacts.ts:74` (the record), `fixtures.ts:234` (Wandoo after-hours)                                                          |
| 5   | Lifeline                                                           | `13 11 14`        | https://www.lifeline.org.au/get-help/                                                                                                    | `crisis-contacts.ts:96`                                                                                                                               | `2026-09-25`                        | `crisis-contacts.ts:88` (`SYN-CRISIS-CONTACT-005`), re-exported via `publicCrisisContacts`                                            |
| 6   | Suicide Call Back Service                                          | `1300 659 467`    | https://www.suicidecallbackservice.org.au/                                                                                               | `crisis-contacts.ts:108`                                                                                                                              | `2026-09-25`                        | `crisis-contacts.ts:100` (`SYN-CRISIS-CONTACT-006`), re-exported via `publicCrisisContacts`                                           |
| 7   | 13YARN (for Aboriginal and Torres Strait Islander people)          | `13 92 76`        | https://www.13yarn.org.au/                                                                                                               | `crisis-contacts.ts:120`                                                                                                                              | `2026-09-27` (`2026-09-25` initial) | `crisis-contacts.ts:112` (`SYN-CRISIS-CONTACT-007`), re-exported via `publicCrisisContacts`                                           |
| 8   | Poisons Information Centre                                         | `13 11 26`        | https://scgh.health.wa.gov.au/Our-Services/Service-directory/Poisons                                                                     | `crisis-contacts.ts:141`                                                                                                                              | `2026-10-13`                        | `crisis-contacts.ts:132` (`POISONS_INFORMATION_CONTACT` / `SYN-CRISIS-CONTACT-008`, separate from `WA_CRISIS_CONTACTS`)               |

The safety-plan-prose line references this table used to carry (`patient-safety-plan.tsx:787`,
`:818`, `:847`, `:876`) were already stale before this update — that file has grown well past
those line numbers since 2026-09-04 from unrelated work. As of 2026-09-25 the prose no longer
hand-types any of these numbers at all: it reads them from `WA_CRISIS_CONTACTS` by id (see
`patient-safety-plan.tsx`'s `crisisContact()` helper and the `EMERGENCY_CONTACT` /
`MHERL_METRO_CONTACT` / `MHERL_PEEL_CONTACT` / `RURALLINK_CONTACT` constants near the top of the
file), so no further line-number chase is needed there — the identity guarantee in
`tests/crisis-contacts.test.ts` (`publicCrisisContacts` is `WA_CRISIS_CONTACTS` itself) covers it.

### What is verified, and by what

- **All eight contacts are pinned.** `tests/care-plan-domain.test.ts` asserts the seven
  `WA_CRISIS_CONTACTS` names, numbers, emergency-service flags and cohort dates, and that each
  carries an `https://` source URL, including the "not an emergency service" caveat for both MHERL
  entries. `tests/crisis-contacts.test.ts` also pins those contacts and the separate
  `POISONS_INFORMATION_CONTACT` number, `verifiedOn` and non-emergency flag. The tests check only
  that each source URL starts with `https://` (for the Poisons contact, `https://scgh.health.wa.gov.au/`);
  they do not pin the exact URLs, so a changed source link must be caught at the next verification.
- **The after-hours pathway must stay real.** `tests/care-plan-domain.test.ts:498` fails if any
  of the three WA numbers disappears from the fixtures, so a later change cannot quietly swap a
  working crisis line for a dead fictional one. The reasoning is `docs/care-plan/sdd-ledger.md:634`:
  the after-hours pathway prints on the patient-facing safety plan under "who to call at 2am", so a
  reader who dials it must reach a real service.
- **There is one source of truth, now one level deeper.** `src/lib/crisis-contacts.ts` defines
  `WA_CRISIS_CONTACTS` once; `src/components/care-plan/mockups/fixtures.ts` re-exports it
  unchanged as `publicCrisisContacts` (`export { WA_CRISIS_CONTACTS as publicCrisisContacts }`,
  an identity re-export, not a copy — pinned by `tests/crisis-contacts.test.ts`'s
  `toBe(WA_CRISIS_CONTACTS)` assertion), and both
  `src/components/care-plan/mockups/patient-plan-fixtures.ts:68` and
  `src/components/patient-safety-plan.tsx` read from that same re-export, so a correction in
  `crisis-contacts.ts` reaches every printed surface without retyping anything.

### What is NOT verified

- **Nothing ages `verifiedOn`.** No test, script, gate or ledger row fails when the date goes stale.
  The date is asserted to be exactly `2026-08-20`, which means the pin will have to be updated by
  hand as part of any re-verification — the assertion is a change-detector, not a currency check.
- **The numbers were not checked against their sources while writing this document.** To verify — no
  network access in this session. Every statement above is about what the repository records, not
  about what WA Health currently publishes.
- **Availability windows were not checked either.** Rurallink's stated hours ("4:30 pm to 8:30 am on
  weeknights, and 24 hours on weekends and public holidays", `fixtures.ts:292`) and the 24-hour
  MHERL claims carry the same 2026-08-20 provenance and the same absence of any ageing check.

## Re-verification cadence

**Every six months, from the `verifiedOn` date recorded in the fixture.**

| Contacts                                   | Last verified | Next due       | Owner        |
| ------------------------------------------ | ------------- | -------------- | ------------ |
| Emergency services                         | 2026-08-20    | **2027-02-20** | Josh (owner) |
| Lifeline, Suicide Call Back Service        | 2026-09-25    | **2027-03-25** | Josh (owner) |
| MHERL Perth, MHERL Peel, Rurallink, 13YARN | 2026-09-27    | **2027-03-27** | Josh (owner) |
| Poisons Information Centre                 | 2026-10-13    | **2027-04-13** | Josh (owner) |

**Six months is the canonical re-verification cadence across the repository, reconciling and
superseding the 2026-09-02 audit finding L4 (which had proposed 12 months).** Two things bear on the
choice and are worth stating plainly:

- The repository's review-interval constant `REVIEW_INTERVAL_MONTHS = 12`
  (`src/components/care-plan/mockups/types.ts:88`) governs **care-plan reviews, not contact
  numbers**. The prototype's `verificationState` for its synthetic community teams is a stored
  fixture value, not a value derived from any threshold, so it is not a precedent either.
- The 2026-09-02 audit's own fix sketch (finding L4) initially proposed twelve months ("fails loudly on 2027-08-20").

Six months is the more conservative of the two, which is appropriate for numbers dialled in crisis
at 3am. The 6-month re-verification cadence is now canonical across all care-plan
surfaces. (The Caring Contacts prototype, which also printed crisis numbers on this cadence, was
retired on 2026-09-26.)

### The procedure

1. Open each source URL in the table above.
2. Confirm the number, the coverage area, and the availability window still match what
   the seven `WA_CRISIS_CONTACTS` entries and the separate `POISONS_INFORMATION_CONTACT`
   hold (`src/lib/crisis-contacts.ts`).
3. **If a value has changed, correct it in `src/lib/crisis-contacts.ts` and nowhere else.**
   The poisons contact is a separate record in that module, not an array entry.
   `fixtures.ts` only re-exports the array by identity, and `patient-safety-plan.tsx` reads the
   same array by id — neither hand-types a number, so neither needs a matching edit. The
   after-hours entries in `syntheticCmhtContacts` (`fixtures.ts`) still repeat the three WA
   numbers as plain strings and must be corrected separately — they are listed per number in the
   table above.
4. Update `verifiedOn` for every entry checked, and update the matching assertion in
   `tests/care-plan-domain.test.ts` and `tests/crisis-contacts.test.ts`, which pin the cohort
   dates; the separate poisons record is pinned in `tests/crisis-contacts.test.ts`.
5. Update the "Last verified" and "Next due" rows in this document, and record who checked.
6. Run `npx vitest run tests/care-plan-domain.test.ts tests/crisis-contacts.test.ts`.

### Verification history

| Date       | Checked by                                                         | What was checked                                         | Outcome                                                                     |
| ---------- | ------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| 2026-08-20 | Recorded in the fixture; the person is not named in the repository | All four numbers, against the source URLs above          | Recorded as verified; the evidence is the `verifiedOn` field itself         |
| 2026-09-04 | This document                                                      | Nothing. The record was written from the repository only | **Not a verification.** No network access; no number was checked or changed |

## The fictional numbers printed alongside them

Recorded here because they also print on a patient-facing sheet, and a reader deserves to know which
numbers on it connect to nobody.

The synthetic duty lines `0491 570 101`, `0491 570 111` and `0491 570 121`
(`fixtures.ts:194`, `:211`, `:228`), and the personal-support numbers `0491 570 131`, `0491 570 132`
and `0491 570 141` (`:781`, `:782`, `:814`), are inside the block
`0491 570 006`–`0491 570 156` that this repository treats as reserved for fiction
(`docs/care-plan/sdd-ledger.md:613`). `tests/care-plan-domain.test.ts:444` enforces that numerically
for every number in the main fixture bundle, and `src/components/care-plan/mockups/types.ts:234-236`
carries an `isRealContact` flag so a printed sheet can say which is which.

**Unverified:** `docs/care-plan/cloud-session.md:258-259` records that the implementer did **not**
verify where the reserved block ends. The `156` upper bound is this repository's own working
assumption. To verify against the ACMA determination — no network access in this session.

## Adjacent observation — not part of this record, and nothing was changed

Recorded because it concerns numbers printed on a patient-facing sheet and would otherwise be lost.

`src/components/care-plan/mockups/patient-plan-fixtures.ts` — the resources printed on a person's
**own copy** of their plan — contains invented contact numbers at `0491 570 210`, `220`, `230`,
`240`, `250`, `260` and `270` (lines `236`, `246`, `257`, `267`, `299`, `310`, `353`). These sit
**above** the `0491 570 156` upper bound of the block this repository treats as reserved for
fiction. That is the same defect `docs/care-plan/sdd-ledger.md:623-627` records finding and fixing
in `fixtures.ts` — the ruling notes those numbers "sit above the reserved span and are ordinary
allocatable numbers" and that "these print onto a patient-facing safety plan".

The numeric range assertion that catches this (`tests/care-plan-domain.test.ts:444`) runs over
`serialisedFixtures`, which is built from `fixtures.ts` only
(`tests/care-plan-domain.test.ts:49-76`); `patient-plan-fixtures.ts` is not in that bundle, so the
guard does not see these numbers.

**Nothing here was acted on.** Changing a number is outside the scope of this record, and whether
these are in fact allocatable is exactly the question `cloud-session.md` says nobody has verified.
This paragraph is a pointer for whoever picks it up.

## Claims in this document that could not be verified from the repository

1. **That all eight numbers are still correct today.** To verify — no network access in this session.
2. **That the stated availability windows are still correct.** Same reason.
3. **Who performed the 2026-08-20 verification.** The repository records the date, not the person.
4. **The six-month re-verification cadence.** Now established as canonical across the repository,
   reconciling and superseding the 2026-09-02 audit finding L4 (which had proposed 12 months).
5. **Where the ACMA fiction block actually ends.** `cloud-session.md:258-259` records that this was
   never checked.
