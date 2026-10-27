# Access roles

The one list of every kind of account PsychSift has, what each is for, what it opens and what it
must not open. Written 27 October 2026 from the code on `main`. When a role is added or changed,
update this file in the same change.

PsychSift is one app. The screens change with the person's role, and the server checks the role
again on every action, so hiding a button is never the only protection. There is no separate build
per role, by design: one place to fix, and a new role shows its screens at once.

`tests/access-roles-walkthrough.test.ts` walks through each role below against the real checks: the
site gates, the Work mode grant code and role reader, and the Hospital screen. It also follows one
role handing on to the next and checks that every Hospital row opens a page that exists.

## Site roles

| Role                      | How someone gets it                                         | What it opens                                                                                                                                                                                                              | Where it is decided                                                    |
| ------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Visitor                   | Not signed in                                               | Public pages only. Every clinical tool asks them to sign in.                                                                                                                                                               | `requireSignedInClinicalAccess` in `src/lib/clinical-access.ts`        |
| Signed in, no declaration | New account, Terms not accepted                             | Nothing clinical until they accept the health professional declaration.                                                                                                                                                    | `requireHealthProfessionalDeclaration` in `src/lib/clinical-access.ts` |
| Clinician                 | Signed in and Terms accepted                                | Answer, Clinical Ask, calculators, their own Work mode and their own uploads. Other publishers' originals stay locked while `THIRD_PARTY_ORIGINALS_ADMIN_ONLY` is on.                                                      | `src/lib/original-document-access.ts`                                  |
| Administrator             | `app_metadata.site_role = "administrator"`, set in Supabase | Document upload and management, other publishers' originals, shared On Call entries, the Development area, the pilot page, verifying teams and naming roster managers, everything in Work mode except signing assessments. | `src/lib/authorization.ts`                                             |
| Blocked                   | Banned in Supabase Auth                                     | Cannot sign in. An open session is refused on its next server action.                                                                                                                                                      | `isBannedNow` in `src/lib/supabase/auth.ts`                            |

## Work mode roles

These sit on top of a clinician account, and each is limited to one team, one hospital or named
trainees. The rules are in `src/lib/work-roles/model.ts`, mirrored by `work_can()` in SQL.

| Role                   | How someone gets it                                                              | What they can do                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team member            | Joins a team by email invite, which needs a confirmed email                      | Own roster, swaps, open shifts, the team page.                                                                                                          |
| Roster manager         | The administrator names them for one team                                        | Publish the roster, approve swaps, manage people, the sick inbox, courses and rotation rounds, for that team only. Lost at once if they leave the team. |
| Medical Workforce      | Given for one hospital by the administrator                                      | Every team in that hospital: sick calls, short-staffed days, new starters, rotations, courses. Gives DCT and supervisor roles.                          |
| DCT                    | Given for one hospital by Workforce or the administrator                         | Term overview, assessment administration, courses. Assigns supervisors.                                                                                 |
| Supervisor or assessor | Given for one trainee or a whole team by Workforce, the DCT or the administrator | Reviews and signs assessments for those trainees only.                                                                                                  |

Nobody gives a role to themselves, and nobody chooses their own supervisor. A role can only be
given to someone already in one of the hospital's teams, except by the administrator by email. An
archived hospital's roles lapse.

Assessment records stay in Clinical Learning Australia (owner decision, 7 October 2026), so the
supervisor and DCT assessment screens show labelled example records only.

## On Call team roles

Per team, in `on_call_service_members.role`. The creator of a team is its team admin.

| Role       | What they can do                                                                            |
| ---------- | ------------------------------------------------------------------------------------------- |
| Member     | Read the team's handbook, numbers and boards.                                               |
| Editor     | Edit handbook items and set up the emergency pin. Add members.                              |
| Team admin | Everything an editor can, plus change people's roles and set teaching supervision pairings. |

A team member can also be a clinical reviewer, who checks entries before they are shared.

## Not roles

- Demo mode runs only in development without a database.
- Example data changes what is displayed, never what a person may do.
- The preview role on the mockups page is a viewing aid, off in production.

## Known gaps, 27 October 2026

These are open questions for the owner, not defects in the checks above.

1. **Two separate supervisor lists.** A supervisor given in People and roles sees "Registrar
   supervision" on Hospital, but registrar supervision hours use the teaching pairings a team admin
   sets in Teaching. A supervisor in one list is not in the other.
2. **Only the administrator names roster managers.** Medical Workforce cannot, even for teams in
   their own hospital.
3. **Team roster for real staff is held in production** unless `ROSTER_TEAM_RELEASE_ENABLED=true`
   is set on Railway. Until then managers and members see sample data only, and the administrator
   cannot verify teams or name roster managers either.
4. **Roster drafts and agreements** (`draft.*`, `agreement.record`) are planned for Release 3 and
   not built.
5. **A blocked account** sees a generic "Sign-in failed" message.
6. **Two capabilities have no screen yet.** `assessments.overview` and `staffing.manage` are in the
   rules but no app code asks for them. The term overview and safe-number screens check other
   rules.
