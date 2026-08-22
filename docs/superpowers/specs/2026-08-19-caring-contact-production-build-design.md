# Caring Contact production build — binding design specification

**Status:** synthetic production build, approved 19 August 2026. No real patient data, no SMS provider, no
migration against the Clinical KB project, and no production deployment. Hosted migrations against the
dedicated caring-contact Supabase project are permitted with confirmation at the time (§3.2).

**Relationship to earlier documents.** This extends the
[rollout plan](../plans/2026-08-14-caring-contact-coordination-rollout.md) and the
[coordination design spec](2026-08-15-caring-contact-coordination-design.md). Where this document and
the 15 August decision lock disagree, §2 records the revision and this document wins.

**Design system:** [SPEC](../../design-system/SPEC.md), [TOKENS](../../design-system/TOKENS.md),
[COMPONENTS](../../design-system/COMPONENTS.md), [GATES](../../design-system/GATES.md).

## 0. Three phases, all of them buildable

The programme was previously described in twelve phases. Most of those boundaries were not real: nothing
outside the code changed between them, and several described work that cannot be done without a sponsoring
service. This specification covers **three phases, every one of which can be built now, on invented
patients, without anyone's permission.**

| Phase | Deliverable                    | Contains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | **The rules and the database** | The sealed domain boundary and clock; plan and message lifecycles; the discharge-anchored twelve-month schedule; hospital events (readmission, death, changed number, third-party request); deny-by-default team permissions; governed-message validation with its replaceable provisional rulebook; audit events; retention and de-identification; the storage contract; the twelve-month simulation proving zero duplicate sends; and the team-scoped Postgres schema with row-level security. |
| **2** | **The working screens**        | The production shell and navigation; every existing screen from the approved mockup, elevated per §7 and without design regression per §6; all 24 overlays as working components; the seven screens required by existing decisions but never designed (§4.2); the four recommended screens (§4.3); every loading, empty and error state; and full responsive and accessibility proof from 320px to 1440px including dark mode, forced colours, reduced motion and 400% reflow.                   |
| **3** | **Make it demonstrable**       | The demo clock; the synthetic caseload of at least twelve fictional patients spread across every plan state; training mode with its assessed scenarios; the bounded clinical-record summary (§2.9); and the rehearsed five-minute demonstration path.                                                                                                                                                                                                                                            |

Phases run in order — Phase 2 consumes Phase 1's rules, Phase 3 populates Phase 2's screens. You see the
work at the end of Phase 1 and again at the end of Phase 3.

### Deliberately out of scope

Not because they are unimportant, but because none of them can be done from a keyboard. Each needs a
contract, a sponsoring service, or a person outside this project:

- **Any text message actually sent** to any number, real or test. No SMS provider, no provider account, no
  adapter beyond a deterministic fake.
- **Hosting for real patients.** The decision lock requires Australian residency; the current application
  tier has no Australian region available.
- **Any hospital system connection.** The referral interface is built and exercised against a synthetic
  adapter only.
- **Enterprise sign-on.** Sign-in is a demo role switcher, because the decision lock requires WA Health
  sign-on and forbids local credentials.
- **Any real patient, and therefore the pilot and everything after it.**
- **Any migration against the Clinical KB Supabase project.** The build runs against local Postgres;
  provisioning a dedicated hosted project is optional and confirmation-gated.

The governance, hazard, evidence and outreach material for that parked work has been removed from the
working tree to keep this specification focused on what is being built. It remains in git history at
commit `32d408c2f` and is restored with a single `git checkout` when a sponsoring service appears.

## 1. Purpose and standing

The design phase is complete. The linked prototype, screenshot atlas, interaction matrix, accessibility
acceptance and clinical-language trace landed in PR #2095; the decision lock, design-phase plan and
coordination spec landed in PR #2133.

This specification covers the next tranche: **a genuinely working caring-contact coordination workspace
running on synthetic patients**, comprising the domain rules layer, a real datastore, and the complete
production screen set.

**Programme context that sets the sequencing.** The destination remains a real WA Health pilot. No
sponsoring service, executive sponsor or governance route exists yet. Real patient data is therefore not
available for at least six months, and the hosting, privacy-impact, enterprise sign-on, records and
SMS-procurement work cannot be specified against requirements nobody has written. The artefact that
unlocks all of it is a complete, credible, working system on synthetic data, built to a standard that
will not need rebuilding. That is what this document specifies.

## 2. Decision-lock revisions — 19 August 2026

The Approved decision lock of 15 August 2026 remains binding except for the following ten revisions.
Each records its reasoning so a later reviewer re-opens it deliberately rather than by accident.

### 2.1 Replies receive an automated non-monitored response

**Was:** "Use a non-receiving sender. Caring Contacts receives, stores, analyses and displays no replies."

**Now:** patient-visible messages originate from a **receiving-capable dedicated number**. Any inbound
message triggers an immediate automated response naming the programme line and its hours, one approved
crisis-support contact, and emergency direction. Inbound content is **discarded at the provider boundary
and never persisted, transmitted to Caring Contacts, displayed, logged, counted per patient, or analysed**.
Caring Contacts still has no inbox, no thread, no reply workflow, and no per-patient reply signal.

**Reasoning:** a non-receiving sender leaves a distressed patient who replies with either a carrier error
or complete silence, immediately after a message from a mental-health team. Silence is the worst
clinically available outcome, and it was previously being decided by a carrier default rather than by the
service. The automated response removes the silence while preserving the one-way boundary in substance:
nothing is received, stored, seen, or acted upon by a human.

**Consequences:** the provider adapter must support inbound auto-response with non-persistence; provider
selection criteria change; privacy review must confirm the position because inbound content transits the
provider even though it is never retained.

### 2.2 The pathway ends with a closing message

**Was:** the cadence ends silently after the month-12 contact.

**Now:** the month-12 contact is a distinct governed message type, `closing`, stating plainly that this
is the final message, thanking the person, and repeating the programme line while it remains open, their
usual services, and crisis support. It requires its own clinical-programme-lead and lived-experience
approval, separately from the ordinary variants.

**Reasoning:** ending a year of contact from a mental-health team without naming the ending risks being
experienced as being forgotten. The closing message costs nothing operationally.

### 2.3 The coordinator sets the first contact date

**Was:** "The first message uses the next occurrence of the patient's approved sending time."

**Now:** the coordinator selects the first contact date during activation. It **defaults to the day after
discharge**, may be moved within **the discharge day to seven days after discharge inclusive**, and any
value other than the default requires a recorded reason. All later contacts derive from the original
discharge anchor; moving the first contact never rebases the twelve-month calendar.

**Reasoning:** the previous rule could place the first caring contact roughly an hour after discharge,
plausibly while the person is still leaving the hospital, and made behaviour depend on the exact minute a
discharge was recorded.

**Consequences:** the review-and-activation screen gains a first-contact-date control. The existing
mockup does not show it and is now known to be out of date on that screen.

### 2.4 Authorised staff may pause on a third-party request

**Was:** only the patient, via the programme line, or the source system may change a plan.

**Now:** any authorised team member may **pause** future contacts immediately on a third-party request —
family, carer, or another clinician — recording who made the request, their stated relationship, and what
was said. **Permanent withdrawal and recording a death still require the patient or the source system.**
A third-party pause creates a coordinator-review exception.

**Reasoning:** a relative reporting a death not yet in the source system, or a carer reporting distress
caused by the messages, previously had no path other than waiting for records to catch up. Pausing is
always the safe direction to be wrong in. Permanent withdrawal stays restricted so that a third party
cannot end a service the patient chose.

### 2.5 Cultural identity is imported for reach reporting only

**Was:** unaddressed.

**Now:** Aboriginal and Torres Strait Islander status is imported from the source record and used for
exactly one purpose: **aggregate reporting on programme reach**, with a governance-configured small-cell
threshold and a non-inferable `Suppressed` state. It **never** affects eligibility, ordering, timing,
pathway assignment, message content, or any ranking, and never appears on a worklist row.

**Reasoning:** Aboriginal and Torres Strait Islander people in WA experience substantially higher suicide
rates. A programme that cannot report whether it reaches them cannot answer the first equity question a
WA mental-health governance board asks. Restricting the field to aggregate reporting keeps the benefit
without introducing demographic-driven clinical behaviour.

**Consequences:** a culturally appropriate pathway is explicitly out of scope here — that content must be
authored and approved by Aboriginal health and lived-experience representatives. An Aboriginal health
review joins the pre-pilot register (§14).

### 2.6 Retention is configurable with real deletion

**Was:** "the formally approved retention period", unspecified.

**Now:** retention is a **configured policy value, not a code constant**, with a **working assumption of
seven years** from episode completion. The data model supports genuine erasure of patient-identifying
fields while the **audit trail survives in de-identified form**, retaining actor, action, timestamp,
object type and outcome.

**Reasoning:** a records officer sets the real figure and this build must not pre-empt them. Retrofitting
erasure onto a schema that assumed permanence is expensive and error-prone.

### 2.7 Message rules are data, not code

**Now:** `validateGovernedMessage` is mechanism only. The rules live in a single separate module marked
**provisional and not clinically approved**, seeded from the decision lock's prohibited concepts, the
existing `EXACT_PATIENT_VISIBLE_MESSAGE` and `PATIENT_VISIBLE_NO_REPLY_NOTICE` constants, and the
two-segment GSM-7 limit. Replacing that module must not require touching the validator.

**Reasoning:** the promised `content-style-guide.md` was never written. Embedding rules in the validator
would turn an agent's guess into clinical policy.

### 2.8 The workspace stays in this repository behind an enforced seam

**Now:** all domain rules live under `src/lib/caring-contacts/` and **import nothing from outside that
directory** except the TypeScript and Node standard libraries, enforced by a test that fails on any
outward import. Caring-contact database migrations live under `caring-contacts/supabase/migrations/` and **must
never be placed in `supabase/migrations/`**, which is replayed against the live Clinical KB project. UI
may depend on the repository design system as normal.

**Reasoning:** the repository supplies the design system, accessibility primitives, gates and test
harness immediately. A real-patient deployment cannot share a codebase, database or deployment with the
Clinical KB search tool, so the extraction path must be a directory move rather than an untangling
performed under time pressure.

### 2.9 One narrowly bounded patient-level document is permitted

**Was:** "The pilot permits no patient-level export."

**Now:** exactly one patient-level artefact is permitted: a **plan summary for filing in the patient's
hospital record**, containing the plan, pathway version, dates, owning team and coordinator. It contains
**no mobile number, no message text and no clinical detail**. Every generation is audited with actor,
timestamp and purpose. No other export, download, or bulk extract exists.

**Reasoning:** the structured record write-back is the primary channel, but hospital services routinely
require a filed document, and an unscoped later exception is more dangerous than a bounded one written
now. The prohibition otherwise stands.

### 2.10 The service is renamed from `Callback` to Caring Contacts

**Was:** the workspace was named `Callback` throughout the rollout plan, the coordination spec and the
prototype shell header. No document recorded a reason for the choice.

**Now:** the service is named **Caring Contacts**, matching the intervention's established name and the
repository's existing `caring-contacts` module naming. The proposed `callback-worker/` directory becomes
`caring-contact-worker/`.

**Reasoning:** `Callback` names a promise the service explicitly does not keep. It never calls back, never
receives a reply and never responds. A patient told they had been enrolled in `Callback` could reasonably
expect a telephone call, which is the same expectation-mismatch hazard as the silent-reply problem
corrected in §2.1. A name should not have to be explained away in the first line of a patient-facing
script.

**Consequences:** 41 occurrences renamed across the rollout plan, the coordination spec, this document and
the prototype shell header. No test asserted the old name. Any external material already carrying
`Callback` needs updating.

## 3. Architecture

### 3.1 The sealed domain layer

```
src/lib/caring-contacts/
  model.ts             plan/contact/template/referral lifecycles and legal transitions
  schedule.ts          discharge-anchored calendar construction
  hospital-events.ts   readmission, death, correction, contact-change transitions
  permissions.ts       deny-by-default, team-scoped capability checks
  message-policy.ts    governed-message validation mechanism
  message-rules.ts     PROVISIONAL rule data; replaced wholesale on clinical approval
  audit.ts             immutable audit event construction
  retention.ts         retention policy evaluation and de-identification
  clock.ts             injected time source; no ambient time in domain code
  repository.ts        storage interface
  db/                  Postgres implementation of the storage interface
```

No file under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
outside itself, Supabase, or OpenAI. `tests/caring-contacts-domain-isolation.test.ts` enforces this by
parsing every import specifier in the directory.

### 3.2 Datastore

A **dedicated Supabase project, separate from the Clinical KB project**, holding synthetic data only.

**Hard separation rules.**

- The Clinical KB project `sjrfecxgysukkwxsowpy` is **never** the target. Caring-contact tables must not
  be created in it under any circumstances.
- Caring-contact migrations live under `caring-contacts/supabase/migrations/` and **never** in the
  repository's `supabase/migrations/`, which is replayed against the Clinical KB project.
- Connection configuration uses its own environment variables, distinct from every existing
  `NEXT_PUBLIC_SUPABASE_*` and `SUPABASE_*` value. No credential is shared between the two projects.
- `npm run check:supabase-project`, which pins the Clinical KB reference, must continue to pass unchanged.
  A new check asserts the caring-contact configuration never resolves to the pinned reference.
- Region **ap-southeast-2 (Sydney)**, matching the residency requirement even though this project holds no
  real patient data, so the eventual production posture is rehearsed rather than retrofitted.

**Schema requirements.** Team-scoped row-level security enforced in the database rather than only in
application code; audit rows written in the same transaction as the change they describe; unique
constraints preventing a second active plan per patient and duplicate contact dispatch; idempotency keys
on every write; and the §2.6 de-identification path proven by migration test.

**Provisioning is a gated action.** Creating the project, choosing its plan and applying the first hosted
migration each require explicit confirmation at the time, recorded in §14. Until it exists, the same
schema runs against a local Postgres instance so development is never blocked.

### 3.3 Key interfaces

- `buildApprovedSchedule(input): ScheduleResult` — pure and deterministic. Anchored to actual discharge
  time; cadence day 1, week 1, months 1, 2, 3, 4, 6, 8, 10, 12; window preference maps to 10:00, 14:00 or
  17:00 AWST; month arithmetic clamps to the last day of a shorter month; weekends and WA public holidays
  send normally; the coordinator's first-contact date (§2.3) shifts only the first contact; the month-12
  contact is typed `closing`.
- `applyHospitalStatusEvent(plan, event): PlanTransition` — readmission pauses future contacts; a recorded
  death irreversibly cancels every unsent contact; a death correction produces an incident transition and
  never resumes the episode; a source mobile change pauses and raises an exception.
- `canPerformCaringContactAction(actor, action, resource): CapabilityDecision` — deny by default,
  team-scoped, returning a named reason for every denial so the interface can explain itself (§5.4).
- `validateGovernedMessage(input): ValidationResult` — exact blocking codes, never calls a model or
  provider, rules sourced from `message-rules.ts`.

### 3.4 Time and identity in the synthetic build

All domain functions take an injected clock; no domain module reads ambient time. Sign-in is a
**non-production role switcher** (coordinator, team lead, auditor) rather than real credentials: the
decision lock requires WA Health enterprise sign-on and states that no Caring Contacts-local credentials exist,
so building a login would violate it, and the permission and auditor surfaces cannot be demonstrated
without role switching.

## 4. Screen inventory

### 4.1 Existing screens — elevated, not redesigned

Today, Patients, patient detail, the four-stage activation, plan detail, Schedule, contact detail,
Templates, pathway detail, Team, Guidance, Reports and all 24 overlays in
[the interaction matrix](../../caring-contacts/interaction-matrix.md) carry forward. §6 governs what may
change; §7 lists the permitted improvements.

### 4.2 New screens required by existing decisions

Each is demanded by a rule already in the decision lock and currently has no surface.

| Screen                                  | Rule it satisfies                                                                                                                                                            | Notes                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service safety stop**                 | A confirmed wrong-recipient message, duplicate send, unauthorised content, material privacy/security incident or loss of audit integrity immediately pauses the entire pilot | Service-wide halt of all sending across every patient and team, with a categorised reason and acting person. Restart requires recorded joint approval from the incident lead, privacy/security owner and clinical programme lead; the interface must not permit single-person restart. A service-state banner is visible everywhere while active. |
| **Pathway authoring and dual approval** | A clinical programme lead and a lived-experience representative both approve new or materially changed pathway/message versions                                              | Draft, review, dual approval with named approvers and timestamps, publication, retirement, immutable version snapshots. Active plans keep their snapshot; an urgent safety retirement pauses affected future contacts for explicit review.                                                                                                        |
| **Provider reconciliation**             | Staff perform manual provider reconciliation when an outage, discrepancy or suspected incident occurs                                                                        | Caring Contacts's expected dispatch record beside reported provider status for a bounded window; explicit resolution of each discrepancy; never automatically resends an uncertain contact.                                                                                                                                                       |
| **Auditor access trail**                | Clinicians see episode-relevant history; privacy/security auditors see the complete access trail                                                                             | Role-gated, read-only, filterable view of every search, view, decision, mutation, write-back and administrative access.                                                                                                                                                                                                                           |
| **Workload and queue monitor**          | The pilot has no numeric cap, so workload monitoring and stopping rules are mandatory                                                                                        | Queue age, unclaimed work against the 60-minute escalation, active plans per coordinator, exception backlog age. Operational only; never ranks clinicians.                                                                                                                                                                                        |
| **Notification preferences**            | Alerts contain no patient identifiers and require authentication                                                                                                             | Per-user opt-in by alert class, with a preview demonstrating the identifier-free alert body.                                                                                                                                                                                                                                                      |
| **Training and assessed simulation**    | Production access requires assessed simulation of identity review, activation, withdrawal, delivery failure, readmission, downtime and incident handling                     | A badged sandbox with its own synthetic cohort, scenario scripts for each competency, and a per-user completion record. Never shares data with the live workspace; a persistent training indicator on every screen.                                                                                                                               |

### 4.3 New screens recommended and approved

| Screen                           | Why                                                                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Episode timeline**             | One chronological record per episode — referral received, accepted, claimed, activated, each contact, pauses, exceptions, reassignment, closing message. The first thing anyone asks for after an incident. |
| **Coverage and absence**         | Who covers which coordinator and for how long, with the named coordinator and any formal reassignment still visible.                                                                                        |
| **Equity reach report**          | The §2.5 aggregate section within Reports, with small-cell suppression.                                                                                                                                     |
| **Clinical-record plan summary** | The §2.9 bounded document, generated and audited.                                                                                                                                                           |

### 4.4 Cross-cutting interaction: explained automation

Wherever the system has acted on its own — paused, skipped, suppressed, blocked, escalated — the surface
stating that state must also state, in plain words and in place, **why** and **what would change it**. No
bare status chip without a reachable reason. This is a contract asserted in DOM tests for every automated
state, not a visual preference.

## 5. Phone

- **Installable, network-required.** The workspace may be installed to a home screen. It must not cache
  patient data, must not function offline, and must fail closed with the approved downtime message when
  connectivity is lost, following directly from "no offline patient cache" and "downtime fails closed".
- **Deliberately narrower than desktop.** The compact build prioritises today's queue, work needing
  action, the episode currently being handled, and an immediate pause. Pathway authoring, reconciliation,
  the auditor trail and reporting are desktop-first; at compact widths they present a readable summary and
  an explicit statement that the task is better performed on a larger screen, rather than a cramped
  reproduction.
- The four-item dock, More sheet, safe areas, edge-to-edge behaviour and the repository phone-chrome
  contract in `docs/search-chrome-behaviour.md` continue to govern.
- Chromium at 320/390/430 is layout evidence only. Physical iPhone Safari and installed-PWA acceptance
  remain open (§14).

## 6. Design non-regression contract

The approved visual design is a baseline, not a starting point. Improvement is in scope; drift is not.

**Frozen — may not change without a recorded decision:**

1. The screen and overlay inventory of the coordination design spec §6, as extended by §4.
2. The 24-row modality and dismissal decisions in `interaction-matrix.md`.
3. The width-to-state mapping (`compact` / `rail` / `split` / `wide`).
4. The closed transport vocabulary and every prohibited clinical term.
5. Token usage: no hardcoded colour, no new colour semantics, no decorative clinical colour.
6. The continuity thread's meaning — elapsed schedule spacing only, never patient, delivery or clinical
   state.

**Enforcement.** Existing DOM and Playwright suites carry forward unweakened; no existing assertion may be
deleted or loosened to accommodate a change. The 44-image screenshot atlas is re-captured after each screen
wave and compared against the committed baseline. Every intentional visual difference is listed and
justified at a checkpoint; any unexplained difference is a regression.

## 7. Elevation brief

Named, testable improvements. Anything not listed is out of scope for "improvement" and needs a decision
first.

1. **Today earns its first screen.** Referrals-to-review and needs-action legible at a glance at every
   width, each row naming the observable condition, the remedy and the owner. Reporting stays below
   actionable work.
2. **Every empty state does work.** No bare "nothing here": state what will appear, why it is empty now,
   and the single available action if one exists.
3. **Every automated state explains itself** (§4.4).
4. **Denials say why.** `canPerformCaringContactAction` returns a reason and the interface shows it, using
   the repository's `aria-disabled` plus stated-reason pattern rather than a hidden or inert control.
5. **Identity stays anchored.** The patient under work remains visible through every activation stage and
   every overlay; `Change patient` keeps object-specific confirmation.
6. **Dates are unambiguous.** `en-AU` display with weekday and explicit AWST window; machine ISO retained
   underneath; never a bare dash for a missing value.
7. **Keyboard operation is first-class.** Visible focus at every step, correct focus return from all 24
   overlays, no keyboard trap, sensible order through the four-stage flow.
8. **Forced colours, dark mode, reduced motion and 400% reflow** proven per screen rather than sampled.

## 8. Rules layer — behaviour to prove

Written test-first; each is an assertion, not a description.

- Discharge anchoring, all ten cadence points, month-end clamping, leap dates, and the §2.3 first-contact
  window including both boundaries and the reason requirement.
- Windows map to exactly 10:00/14:00/17:00 AWST; one preference per plan; no episode rotates windows.
- Weekends and WA public holidays send; nothing sends outside 09:00–18:00.
- Missed contacts are recorded, never sent late; the calendar never rebases.
- Pause preserves the original calendar and permanently skips contacts inside the pause; resumption begins
  at the next future contact.
- Withdrawal cancels all unsent contacts immediately, needs no approval, retains immutable history.
- Readmission pauses; recorded death irreversibly cancels; death correction raises an incident and never
  resumes.
- A duplicate referral for an active plan is blocked and routed to the existing episode; a later qualifying
  discharge creates a new linked episode and never mutates the earlier one.
- Transient transport failure retries twice, three attempts total, strictly inside the original window.
- Permanent failure pauses future contacts and raises a same-day task, never contacting the patient
  automatically.
- Third-party pause (§2.4) records requester and relationship; third-party withdrawal is refused with a
  named reason.
- Every substituted message including notices and signature fits two GSM-7 segments; overflow blocks with an
  exact count.
- Permissions deny by default, are team-scoped, and refuse cross-team access with a reason.
- Every mutation writes its audit event in the same transaction; no code path can write one without the
  other.
- Retention de-identification removes patient fields and preserves actor, action, timestamp, object type and
  outcome.
- A full twelve-month simulation produces exactly ten contacts in the correct order with zero duplicates
  under retries, concurrent pause and clock jitter.

## 9. Data model additions

Beyond the rollout plan's Phase 6 model: the coordinator-selected first contact date and its reason; the
`closing` message type; third-party pause requester and relationship; imported Aboriginal and Torres Strait
Islander status held in a reporting-only projection separate from operational patient fields; retention
policy value and de-identification state; training-mode ownership so simulation data can never join live
queries; service state (safety stop) as a first-class object with reason, actor and three restart
approvals; and clinical-record summary generation events.

## 10. Non-production affordances

### 10.1 Demo clock

A non-production-only control advancing the injected clock so a reviewer can see month 1, 6 or 12 without
waiting. Never present in a production build; guarded by the same environment-gate pattern as
`mockupsEnabled`, and asserted absent by a production-build test.

### 10.2 Synthetic caseload

At least twelve obviously fictional patients spread across referral, awaiting claim, active early, active
late, paused, withdrawn, readmitted, permanent delivery failure and completed states, so no screen is ever
demonstrated empty.

### 10.3 Training mode

Per §4.2, with its own cohort, persistent indicator, scenario scripts for the seven required competencies
and a per-user completion record. Built last so it can slip without blocking anything else.

## 11. Verification

- Focused Vitest per rules module, written before implementation.
- Domain isolation test (§3.1) and a test asserting no caring-contact migration reaches the repository `supabase/migrations/` directory, and that caring-contact configuration never resolves to the pinned Clinical KB project reference.
- Migration tests for team scoping, transactional audit, duplicate prevention and de-identification.
- DOM tests per screen, including the explained-automation and empty-state contracts.
- Repository-wrapped Playwright journeys at 320/390/430/768/1024/1440, plus dark, forced colours, reduced
  motion and 400% reflow.
- Screenshot atlas re-capture and justified-difference review at each checkpoint (§6).
- `npm run verify:pr-local` once per pull request; `npm run verify:ui` once for the screen pull request.
- No provider-backed gate. `check:production-readiness` remains intentionally gated without live
  configuration.

## 12. Out of scope

Everything in Phases 3 and 4 (§0). Specifically: no SMS provider and no message actually sent to any
number, real or test; no real patient data; no migration of any kind against the Clinical KB Supabase
project; no production deployment; no hosting change; no enterprise sign-on; no hospital system
connection; and no clinical-record write-back adapter beyond the synthetic interface.

The build runs against local Postgres. Provisioning the dedicated Supabase project is optional and
confirmation-gated (§0, §3.2).

Refused on safety grounds regardless of convenience: bulk actions across patients; offline access or any
device-local patient storage; storing, displaying, counting per patient, or acting on replies; any risk
score, prediction, ranking or clinician league table; and search beyond the acting team's own referrals and
episodes.

## 13. Delivery

**Three phases, two checkpoints.**

1. **Phase 1 — rules and database** (§3, §8, §9). Plan:
   `docs/superpowers/plans/2026-08-19-caring-contact-domain-and-datastore.md`, eleven test-first tasks.
   **Checkpoint one.**
2. **Phase 2 — screens** (§4, §6, §7). Its own plan, written once Phase 1 lands.
3. **Phase 3 — demonstrable** (§10, §2.9). Folds into the Phase 2 pull request unless it grows.
   **Checkpoint two.**

Each piece is one agent, written test-first, adversarially reviewed by a second agent before it counts as
done, and committed separately so any single piece can be reverted while the pull request is open.

## 14. Open decisions affecting the build

| Item                                      | Owner                         | Note                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Patient-visible reply wording             | Josh                          | A provisional correction is applied in code — the notice reads "No one reads replies to this number", and `AUTOMATED_REPLY_RESPONSE` supplies the reply a person receives. Both are built and pinned by test at 252 and 218 GSM-7 septets. Confirm or replace the words. |
| Retention figure                          | Josh, later a records officer | Seven years is the working assumption the schema is built around. Changing it is a configuration value, not a migration.                                                                                                                                                 |
| Provisioning a dedicated Supabase project | Josh                          | Optional. The build runs against local Postgres. Sydney region, synthetic data only, confirmation-gated.                                                                                                                                                                 |
| Week 1 collision rule                     | Josh                          | When the coordinator sets the first contact to discharge + 7, it lands on the Week 1 contact. Implemented as: Week 1 is suppressed and recorded, giving nine contacts, because two caring contacts in one day is the worse outcome. Reversible in `schedule.ts` alone.   |

## 15. Approval boundary

This specification is not clinical approval, WA Health endorsement, evidence of clinical effectiveness, or
production readiness. It authorises a synthetic build only.
