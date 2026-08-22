# ED Care Plans — detailed Claude build handover

> **Historical handover (21 August 2026).** The product name is now Care Plan and the route family is `/mockups/care-plan`. Binding specs live at [`2026-08-20-care-plan-design.md`](../superpowers/specs/2026-08-20-care-plan-design.md), [`care-plan-context.md`](../care-plan-context.md), and [`2026-08-20-care-plan-implementation.md`](../superpowers/plans/2026-08-20-care-plan-implementation.md). Identifiers below (`ED Care Plans`, `/mockups/ed-care-plans`, `ed-care-plans-*.md`) are the names as they stood on this date.

## Handover outcome

ED Care Plans is fully brainstormed, clinically bounded, visually selected, specified, and decomposed into a nine-task implementation plan. No application code has been written. This handover is the bridge from the approved Codex design session to a Claude implementation session.

The next worker should build the complete synthetic standalone prototype in the existing isolated worktree, beginning with the domain and reducer rather than the UI shell.

## Authority and read order

When sources differ, use this priority:

1. Current user instructions in the Claude session.
2. Repository [`AGENTS.md`](../../AGENTS.md).
3. Approved [`Care Plan design specification`](../superpowers/specs/2026-08-20-care-plan-design.md).
4. Binding [`domain glossary`](../care-plan-context.md).
5. Executable [`implementation plan`](../superpowers/plans/2026-08-20-care-plan-implementation.md).
6. This handover and the [`conversation transcript`](./conversation-transcript-2026-08-21.md).

The specification is the product authority. The implementation plan is deliberately more detailed about files, symbols, tests, and order, but it may not relax a specification invariant.

## User-approved product

**Name:** Care Plan (recorded on this date as ED Care Plans)  
**Descriptor:** Continuity for recurrent presentations  
**Route family:** `/mockups/care-plan` (recorded on this date as `/mockups/ed-care-plans`)  
**Cohort:** Adults and older adults in a fictional multi-site WA health-service network  
**Delivery:** Complete, linked, interactive, deterministic synthetic prototype  
**Persistence:** In-memory only; state resets on refresh

The app exists to help an authorised clinician rapidly find a person who has recurrent psychiatric ED presentations, locate the approved Current Management Plan, understand the continuity approach, record the current ED Presentation, contact the relevant CMHT, and reach or print the patient's distinct Personal Safety Plan.

## Approved decisions that must not be reopened

- Search authorised synthetic records by name, MRN, date of birth, and alias. Do not search clinical narrative, diagnosis, indication, or Safety Plan content.
- Each patient has one longitudinal clinician Management Plan with version history.
- A version becomes the visible **Current Plan** only after approval by a named senior clinician.
- Draft and Awaiting Approval versions remain visibly separate. They never replace or obscure the existing Current Plan.
- The previous Current Plan remains in force until a replacement is approved; approval supersedes it atomically.
- The Personal Safety Plan is a distinct patient-owned, co-produced, independently versioned document. It is printable and does not use the Management Plan's senior-approval gate.
- ED Presentations are a separate append-only record. Corrections are signed amendments, never silent overwrites.
- CMHT contact details include the shared mailbox, duty telephone, hours, care coordinator where appropriate, after-hours pathway, and last verified date.
- Email and telephone controls launch only `mailto:` and `tel:` intents. The email subject is generic and contains no patient identifier or clinical detail. The prototype never claims a message was sent, delivered, read, answered, or that contact was completed.
- The desktop direction is **A — Clinical Snapshot**. Use Direction B's longitudinal timeline within the patient record and Direction C's queues within Reviews.
- The phone layout is single-column at 320 px and 390 px, respects the effective safe-area inset, has 48 px targets, and keeps Current Plan, CMHT, Safety Plan, and Record ED Presentation directly reachable.
- The repository Clinical White / Sky Graphite system, shared components, dark mode, forced colours, reduced motion, visible focus, and keyboard contracts apply.

## Deliberately unresolved governance decision

The numeric identification threshold is **not approved**.

The user explicitly asked to leave the previously suggested “four ED presentations in a rolling 12 months” open for further review. Therefore:

```ts
IdentificationPolicy.status === "pending_governance";
IdentificationPolicy.thresholdCount === null;
IdentificationPolicy.thresholdLookbackMonths === null;
```

The prototype may display objective raw activity such as “7 ED presentations in 12 months” and may support authorised manual referral to Identification Review. It must not automatically create a patient label, diagnosis, risk state, eligibility decision, plan, mandatory workflow, or “Review suggested” state from a count.

## Core clinical and privacy invariants

- The Management Plan supports continuity but never replaces fresh triage, physical assessment, mental-state assessment, or immediate risk assessment.
- A patient is never defined by their presentation count. Do not use “frequent flyer”, “problem patient”, or punitive utilisation language.
- Medication content is limited to allergies and a reference/link to the authoritative medication record. Do not build a parallel prescribing record or orders workflow.
- Record patient and carer involvement as co-produced, discussed, declined, or patient unavailable. Never describe non-participation as non-compliance.
- Support-person, carer, interpreter, cultural, Aboriginal Liaison, peer, accessibility, and communication preferences are consent-aware clinical context, not decorative demographics.
- Presentation records capture the plan version available at that time, whether it was available/used/helpful, any deviation and reason, outcome/disposition, CMHT contact outcome, and whether review is requested.
- Printing uses minimum necessary identifiers, printed-at/version metadata, a “check the electronic record” warning, and a confidential-document footer.
- Public WA crisis numbers may be real; all patients, clinicians, services, teams, sites, events, plans, and internal contacts must be unmistakably synthetic and use `SYN-` identifiers.
- No network, provider, analytics, storage, persistence, database, API, route handler, Server Action, Supabase, OpenAI, EDIS, EMR, PAS, PSOLIS, or real email transport is in scope.

## Complete route suite

All routes are below `/mockups/ed-care-plans`:

- `/`
- `/patients`
- `/patients/[patientId]`
- `/patients/[patientId]/management-plan`
- `/patients/[patientId]/management-plan/edit`
- `/patients/[patientId]/management-plan/review`
- `/patients/[patientId]/safety-plan`
- `/patients/[patientId]/safety-plan/edit`
- `/patients/[patientId]/safety-plan/print`
- `/patients/[patientId]/presentations`
- `/patients/[patientId]/presentations/new`
- `/patients/[patientId]/presentations/[presentationId]`
- `/patients/[patientId]/history`
- `/reviews`
- `/team`
- `/governance`
- `/system-states`

The route must also be linked from the existing Developer hub at `src/app/mockups/development/page.tsx`.

## Primary information architecture

### Global navigation

- Home
- Patients
- Reviews
- Team
- Governance

### Patient workspace

- Overview
- Management Plan
- Personal Safety Plan
- ED Presentations
- Version and audit history

### Reviews queues

- Awaiting Approval
- Review Suggested
- Contact Verification
- Identification Review

### Clinical Snapshot desktop

Use a fixed Sky Graphite clinical rail, prominent search, compact recent/directory list on the left, and the selected patient workspace on the right. The approved Current Plan is the centre of gravity. CMHT and Safety Plan access remain visible without burying them in secondary navigation.

### Phone

Collapse to search followed by one full-width patient workspace. There must be no horizontal page scroll at 320 px or 390 px. Background may paint behind the system region, but meaningful top content stays below the effective safe-area inset.

## Personal Safety Plan contract

The patient-voice structure follows seven Australian safety-planning steps:

1. Warning signs.
2. Making the environment safer.
3. Reasons for living.
4. Personal coping strategies.
5. Supportive people and places.
6. Family and friends to contact.
7. Professional and emergency support.

The print view is plain language, generous spacing, monochrome-safe, and minimal. It includes current CMHT and urgent-help information without confusing MHERL with an emergency service.

Public crisis details verified from the official sources during planning:

- Emergency: `000`.
- MHERL Perth: `1300 555 788`.
- MHERL Peel: `1800 676 822`.
- Rurallink: `1800 552 002`; 4:30 pm–8:30 am weeknights and 24 hours on weekends/public holidays.
- MHERL must be described as not an emergency service.

Source links:

- [WA Health — Mental Health Emergency Response Line](https://emhs.health.wa.gov.au/Hospitals-and-Services/Mental-Health-Alcohol-and-Other-Drugs/Inpatient-and-Other-Services/MHERL)
- [WA Health — Rurallink](https://emhs.health.wa.gov.au/Hospitals-and-Services/Mental-Health-Alcohol-and-Other-Drugs/Inpatient-and-Other-Services/Rurallink)

Recheck official public details if implementation happens materially later than this handover; do not silently change them from a secondary source.

## Safe and degraded states to demonstrate

- No Management Plan.
- Draft only.
- Awaiting Approval while the previous Current Plan remains visible.
- Review overdue.
- Withdrawn plan.
- Superseded version in history.
- Conflicting concurrent draft.
- Identity uncertainty.
- CMHT contact details not verified/stale.
- Temporary offline or unavailable record.
- ED Presentation amendment.
- Patient unavailable or declining participation.
- No search results.
- Unauthorized transition or role.

The interface must never quietly substitute a draft, superseded version, or empty state for the Current Plan.

## Explicitly deferred or prohibited

- AI or predictive scoring.
- Automatic identification, risk labelling, or plan creation.
- Automated clinical recommendations.
- Medication ordering or a second medication list.
- Automated messages or emails containing patient information.
- Staff chat, inbox, or monitored-reply workflow.
- Real clinical-system integrations.
- Patient portal editing.
- Attendance-reduction targets.
- Complex population analytics.
- Claims that the prototype is clinically validated, production-ready, interoperable, secure for real data, or suitable for clinical use.

## Existing planning artifacts

| Artifact            | Location                                                                                                        | State                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Start point         | [`CLAUDE-START-HERE.md`](./CLAUDE-START-HERE.md)                                                                | Complete                          |
| Approved design     | [`2026-08-20-ed-care-plans-design.md`](../superpowers/specs/2026-08-20-ed-care-plans-design.md)                 | Complete and user-approved        |
| Domain glossary     | [`ed-care-plans-context.md`](../ed-care-plans-context.md)                                                       | Complete                          |
| Implementation plan | [`2026-08-20-ed-care-plans-implementation.md`](../superpowers/plans/2026-08-20-ed-care-plans-implementation.md) | Complete; nine tasks              |
| Conversation        | [`conversation-transcript-2026-08-21.md`](./conversation-transcript-2026-08-21.md)                              | Complete through handover request |
| Evidence            | [`verification-log-2026-08-21.md`](./verification-log-2026-08-21.md)                                            | Current handover evidence         |

At handover creation the three original planning files contained 1,554 lines in total: glossary 135, design 418, and implementation plan 1,001.

## Relevant repository locations

### Binding orientation and design system

- `D:\Worktrees\Database\ed-care-plans\AGENTS.md`
- `D:\Worktrees\Database\ed-care-plans\CLAUDE.md`
- `D:\Worktrees\Database\ed-care-plans\docs\codebase-index.md`
- `D:\Worktrees\Database\ed-care-plans\docs\design-system\README.md`
- `D:\Worktrees\Database\ed-care-plans\docs\wiring-conventions.md`
- `D:\Worktrees\Database\ed-care-plans\docs\testing.md`
- `D:\Worktrees\Database\ed-care-plans\docs\process-hardening.md`
- `D:\Worktrees\Database\ed-care-plans\src\app\globals.css`
- `D:\Worktrees\Database\ed-care-plans\src\components\ui`

### Current Caring Contact precedent in this worktree

- `src/app/mockups/caring-contacts/layout.tsx`
- `src/app/mockups/caring-contacts/route-page.tsx`
- `src/components/caring-contacts/mockups/types.ts`
- `src/components/caring-contacts/mockups/fixtures.ts`
- `src/components/caring-contacts/mockups/prototype-state.ts`
- `src/components/caring-contacts/mockups/routes.ts`
- `src/components/caring-contacts/mockups/routable-suite.tsx`
- `src/components/caring-contacts/mockups/caring-contact-shell-frame.tsx`
- Caring Contact focused unit/DOM tests under `tests/caring-contact-*`
- Caring Contact browser journey `tests/ui-caring-contact-mockup.spec.ts`

Use this precedent for the gated mockup route, in-memory reducer/provider, route reconstruction, shell, and wrapped browser-test pattern. Do not import the Caring Contact one-way-SMS product semantics into ED Care Plans.

### Earlier work-in-progress references

- WA Ward Flow / Patient Flow: `C:\Users\joshs\.codex\worktrees\ward-management-design\Database\src\app\ward-management`
- WA Ward Flow components: `C:\Users\joshs\.codex\worktrees\ward-management-design\Database\src\components\ward-management`
- Caring Contact linked mockup: `D:\Worktrees\Database\caring-contact-linked-mockup\src\app\mockups\caring-contacts`
- Caring Contact components: `D:\Worktrees\Database\caring-contact-linked-mockup\src\components\caring-contacts\mockups`

These are reference-only. The implementation target remains the ED Care Plans worktree.

### Gate and navigation owners

- `src/app/mockups/development/page.tsx`
- `src/app/mockups/mockups-layout-client.tsx`
- `src/lib/developer-area/headers.ts`
- `src/proxy.ts`
- `tests/proxy.test.ts`
- `package.json`
- `playwright.config.ts`

### Installed Next.js documentation

Next.js is 16.3. Read the relevant installed guide under `node_modules/next/dist/docs/` before framework code. The prior planning pass already checked layouts/pages, linking/navigation, server/client boundaries, dynamic routes, and CSS; a new implementer should still read the exact version-matched files needed for each task.

## Requested skills and execution method

The user explicitly requested the Superpowers process. Relevant skill locations are:

- `C:\Users\joshs\.codex\skills\20-superpowers\SKILL.md`
- `C:\Users\joshs\.codex\skills\20-superpowers\brainstorming\SKILL.md`
- `C:\Users\joshs\.codex\skills\grill-me\SKILL.md`
- `C:\Users\joshs\.agents\skills\grill-with-docs\SKILL.md`
- `C:\Users\joshs\.codex\plugins\cache\openai-curated-remote\superpowers\6.3.0\skills\subagent-driven-development\SKILL.md`
- `C:\Users\joshs\.codex\plugins\cache\openai-curated-remote\superpowers\6.3.0\skills\writing-plans\SKILL.md`
- `C:\Users\joshs\.codex\plugins\cache\openai-curated-remote\superpowers\6.3.0\skills\test-driven-development\SKILL.md`
- `C:\Users\joshs\.codex\plugins\cache\openai-curated-remote\superpowers\6.3.0\skills\requesting-code-review\SKILL.md`
- `C:\Users\joshs\.codex\plugins\cache\openai-curated-remote\superpowers\6.3.0\skills\verification-before-completion\SKILL.md`

Brainstorming and grilling are complete; do not restart them. The implementation plan requires one implementer at a time, a fresh specification reviewer, a fresh quality reviewer, test-first behaviour changes, and recorded task evidence.

Repository skills relevant during the build:

- `.agents/skills/ui/SKILL.md`
- `.agents/skills/clinical/SKILL.md`
- `.agents/skills/test/SKILL.md`
- `.agents/skills/handover/SKILL.md`

## Nine-task build sequence

The implementation plan is executable and names every file, symbol, red/green command, and review gate. Its task sequence is:

1. Domain types, deterministic fixtures, selectors, and privacy invariants.
2. Reducer, provider, role permissions, and lifecycle transitions.
3. Gated route family and shell.
4. Clinical Snapshot, patient search, and CMHT contact actions.
5. Management Plan drafting, submission, comparison, approval, withdrawal, and history.
6. ED Presentation recording, plan-use feedback, and append-only amendments.
7. Personal Safety Plan lifecycle and print view.
8. Reviews queues, Team, Governance, audit history, and degraded/system states.
9. Browser/accessibility coverage, generated documentation, and handoff verification.

Do not parallelize overlapping writes. Each task should end with the required reviews and the smallest green gate before the next implementer starts.

## Git and worktree state at handover

### Intended worktree

- Path: `D:\Worktrees\Database\ed-care-plans`
- Branch: `codex/ed-care-plans`
- HEAD: `eeea74a160c19553f94347dda5102b2dff2ed591`
- Upstream: `origin/main`
- `origin/main` at the final 00:51 AWST snapshot: `1cc0d298774e4dc2ec8dd04d03ecf4fe789d5564`
- Divergence at that snapshot: behind by four commits, ahead by zero.
- Existing ED Care Plans files: untracked planning/handover documents only.
- Product files changed: none.

The worktree was created from then-current `origin/main`; main advanced afterward. No pull, merge, rebase, or branch movement was authorized or performed. Inspect the four commits and ask before moving the base. The design is not tied to those commits, so implementation may continue safely on the current base if repository inspection confirms no required conflict.

### Shared checkout to preserve

Do not work in `D:\Repos\Database`. At handover it was:

- Branch: `gemini/safe-tooling-ui-layout-and-workflow-hardening`
- HEAD: `ad44f2b1466c3091ba0c0bbb36125d2631c5509a`
- Upstream: gone.
- Unrelated modified files:
  - `docs/scripts-index.md`
  - `docs/testing.md`
  - `scripts/check-bundle-budget.mjs`
  - `tests/bundle-budget.test.ts`

These changes belong to another task/process and must not be staged, moved, stashed, reset, or absorbed.

## Authorization boundary

This handover authorizes no external effect.

- Routine local implementation in the isolated worktree is the intended next activity in Claude.
- Offline/mock verification is intended.
- No API, provider, production data, hosted CI, migration, deployment, message, or external publication is authorized.
- No commit, push, pull, merge, rebase, PR, or branch deletion is authorized.
- The Codex implementation plan asked for explicit permission to create local SDD checkpoint commits. The user switched to requesting a Claude handover instead of granting that permission. Claude must ask before creating local commits.

## Verification state

Planning artifacts were formatted and self-reviewed. The plan self-review reported `PLAN_SELF_REVIEW=PASS tasks=9`. The route inventory matched all 17 approved routes, and the unfinished-marker scan returned no matches.

The handover lifecycle classifier reported:

```text
Changed files: docs/ed-care-plans-context.md, docs/superpowers/plans/2026-08-20-ed-care-plans-implementation.md, docs/superpowers/specs/2026-08-20-ed-care-plans-design.md
Risk classes: docsOnly
Local/offline checks:
- npm run verify:pr-local — Complete the local handoff gate.
```

Exact final documentation checks are recorded in [`verification-log-2026-08-21.md`](./verification-log-2026-08-21.md).

No application test, typecheck, lint, build, browser journey, accessibility run, or product gate has run because no product code exists yet. Do not present planning proof as implementation proof.

## Visual companion

The approved visual comparison is preserved outside Git:

- Direction source: `C:\Users\joshs\.codex\visualizations\2026\08\20\01a01fb2-575f-7c11-a245-332db7a85a25\ed-care-plans\.superpowers\brainstorm\17559-1787239654\content\ed-care-plans-directions.html`
- Post-selection screen: `C:\Users\joshs\.codex\visualizations\2026\08\20\01a01fb2-575f-7c11-a245-332db7a85a25\ed-care-plans\.superpowers\brainstorm\17559-1787239654\content\waiting-after-direction.html`
- Former URL: `http://localhost:65531/?key=c8ec5482b262fbd2da66537c291b1258cac85114af2a9fbf107ee70cf5dfec47`
- Server status: not running at handover; the HTML assets remain.
- Approved direction: A — Clinical Snapshot.

The former URL is historical evidence, not a promised live endpoint. Use the file or create a new task-owned server if visual comparison is necessary.

## Original Codex task

- Task title: `Management plan`
- Task ID: `01a01fb2-575f-7c11-a245-332db7a85a25`
- Task working directory: `D:\Repos\Database`
- Portable transcript: [`conversation-transcript-2026-08-21.md`](./conversation-transcript-2026-08-21.md)

The transcript contains every visible user and assistant message returned by the native task-history reader through the handover request. It intentionally omits private reasoning, hidden instructions, and raw tool payloads. Tool and verification evidence is separately recorded in the verification log.

## Remaining risks and open decisions

- Numeric presentation threshold remains pending local governance.
- The prototype is not clinically validated and must stay synthetic.
- Public crisis details can change; recheck official sources if implementation is delayed.
- The branch was four commits behind `origin/main` at the final handover snapshot; recheck, and do not silently rebase or merge.
- Local commits are not yet authorized, although the requested SDD process normally depends on them.
- Physical iPhone Safari/PWA acceptance cannot be closed by Chromium emulation; if phone chrome changes are material, report that gap separately.
- Browser, dark-mode, forced-colour, reduced-motion, print, and 320/390 px evidence remain future Task 9 work.

## Exact next action

In Claude, verify `git status --short --branch --untracked-files=all`, `git rev-parse HEAD`, and `git rev-parse origin/main`; confirm the handover files are intact; then execute implementation-plan Task 1 using its prescribed failing focused test. Do not scaffold routes first, and do not encode a numeric identification threshold.
