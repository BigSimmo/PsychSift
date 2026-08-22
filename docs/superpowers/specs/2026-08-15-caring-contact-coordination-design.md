# Caring Contact Coordination Workspace — binding design specification

**Status:** synthetic design prototype only, 15 August 2026  
**Decision source:** [approved rollout plan](../plans/2026-08-14-caring-contact-coordination-rollout.md), especially the Approved decision lock  
**Design system:** [SPEC](../../design-system/SPEC.md), [TOKENS](../../design-system/TOKENS.md), [COMPONENTS](../../design-system/COMPONENTS.md) and [GATES](../../design-system/GATES.md)

## 1. Scope and product boundary

This specification freezes the design target. It does not authorise production routes, patient data,
APIs, a datastore, SMS, a migration or deployment. Prototype and test screenshots are required to
use clearly fictional synthetic identities and details; real patient information or PHI must never
appear in them. All other fixtures, messages, people, services, identifiers and phone numbers are
fictional too.

Caring Contacts is a dedicated operational workspace inside this repository. It inherits the Clinical KB
v2 visual and accessibility contracts but is not a search mode. Patient or referral information must
not enter shared search, RAG, OpenAI, favourites, recent-search, query-log or analytics paths.

The initial service is one dedicated hospital aftercare/transition team coordinating one-way caring
contacts for objectively eligible adults discharged after a suicidal crisis. Caring contacts
supplement usual care. They are not monitoring, crisis response, triage, clinical advice or a
replacement for person-to-person follow-up. Transport state never represents patient safety,
wellbeing, receipt, engagement or treatment response. A pending or returned referral remains the
referring team's responsibility until explicit acceptance.

## 2. Information architecture

Desktop exposes five primary areas: Today, Patients, Schedule, Templates and More. Compact layouts
use a four-item dock: Today, Patients, Schedule and More; the More sheet contains Templates, Team,
Guidance and Reports. No Inbox, Messages, Conversations or global search composer exists.

Today keeps this action-first order at every width:

1. `Referrals to review`, ordered by discharge and first eligible contact-window timing;
2. `Needs action`, where every row names the observable operational condition, remedy and owner;
3. today's Morning, Afternoon and Early evening sending-window panels;
4. recent activity with patient name, exact action, clinician and time, but no phone number, message
   text or clinical detail; and
5. quiet aggregate metrics.

Reporting never moves above actionable work. `Needs action` is not an inferred-risk label.

## 3. Referral, identity and episode boundaries

The hospital workflow supplies minimum identity, discharge, mobile provenance, an explicit
patient-controlled/suitable-for-discreet-SMS flag and `Agreement confirmed: Yes/No`. Caring Contacts does
not represent the imported mobile as independently re-verified or the agreement as legal/treatment
consent.

An authorised aftercare clinician Accepts, Returns for clarification or Declines with a structured
reason. Before acceptance, the UI shows `Awaiting handover` and the referring team as responsible.
Acceptance moves the referral into the aftercare queue; a coordinator then explicitly claims it or a
team lead assigns it. There is no automatic round robin.

Patient search is limited to the active pilot team's referrals and Caring Contacts episodes. Results are
identity-forward rows followed by a separate assurance step. The chosen identity remains visible in
flow through activation; `Change patient` requires object-specific confirmation. Team switching
clears patient state before the new context renders.

- A duplicate referral cannot create a second active plan.
- A later qualifying discharge creates a new linked episode only after the earlier episode closes.
- Readmission pauses the episode; a later discharge needs a new linked referral.
- Recorded death irreversibly cancels unsent contacts; a correction is an incident and any future
  plan needs a new referral.
- Completed, cancelled and withdrawn episodes are read-only.

## 4. Four-stage activation

Wide layouts use a persistent stepper, focused stage and live exact-message preview. Compact layouts
keep identity and stage in flow and open the preview in a labelled sheet.

1. **Patient and agreement:** repeat source identity/mobile evidence; require the
   patient-controlled-mobile flag, `Agreement confirmed: Yes`, accepted owning team and coordinator;
   name the remedy for each blocker.
2. **Choose pathway:** show current locally approved versions with duration, cadence, sender,
   one-way boundary and approval ownership. Do not rank or label a pathway `best`. Until local
   approval, the cadence reads `Illustrative locally governed pathway`.
3. **Personalise:** allow only preferred name, neutral team identity, coordinator signature and
   approved variant choice. Show exact patient-visible text, encoding, segment count, schedule and
   continuity thread. No free text, generated authoring or dynamic translation. More than two fully
   substituted SMS segments blocks progression.
4. **Review and activate:** section the full assurance review—identity and source, mobile suitability,
   agreement, ownership, exact pathway/message versions, exact text and segment evidence, every date
   and AWST send time, and one-way/no-monitoring boundaries—before the final action
   `Activate 10-contact plan`. Fresh authentication and atomic activation are future implementation
   contracts, not prototype capability.

## 5. Schedule and continuity

The schedule is anchored to actual discharge time. The first contact uses the next approved service
time: Morning 10:00 am, Afternoon 2:00 pm or Early evening 5:00 pm AWST. Store one selected
preference per plan and derive all 10 planned contacts from it; never rotate one episode through the
three windows. The Schedule dashboard may still aggregate different patients. Weekends and WA public
holidays are permitted within 9:00 am–6:00 pm. The illustrative cadence is day 1, week 1 and months
1, 2, 3, 4, 6, 8, 10 and 12.

Missed contacts are never sent late. A pause preserves the original calendar and permanently skips
contacts within the pause. Resumption starts with the next future contact. Withdrawal immediately
cancels unsent contacts; cancellation is a distinct authorised action. A coordinator may move a
contact only within its scheduled day; a date change needs a reason and team-lead approval.

Schedule defaults to one day with a seven-day strip. Named exceptions remain separate from routine
sending-window lists. The continuity thread uses close early nodes widening across the year and
represents elapsed schedule spacing only. Geometry and colour never respond to patient, delivery or
clinical state. A complete chronological ordered list, accessible name `Caring-contact schedule`,
immediately follows and is the source of truth. Forced colours use system strokes; reduced motion
removes path animation; print uses the list.

## 6. Screen and overlay inventory

| Screen                     | Primary composition                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Today                      | Compact stacked commands; wide action/list split                                        |
| Patients / patient detail  | Identity-forward rows, then stacked or split identity/plan detail                       |
| New plan / plan detail     | Compact full-stage plus preview sheet; wide stepper/work/preview or plan/schedule split |
| Schedule / contact detail  | Compact day list and dedicated contact page; wide rail/split and drawer-capable detail  |
| Templates / pathway detail | Stacked or rail list; metadata/preview split                                            |
| Team / Guidance / Reports  | Stacked or rail; readable guidance; aggregate-only reporting                            |

The 24 required overlay/state decisions are: verify identity; change patient; pathway preview;
message preview; communication preference; adjust date/time; outside-window warning; save draft;
discard changes; final activation; activation success; pause; withdrawal; reassignment; delivery
detail; resolve failed delivery; contact-changed block; template changed/retired; session expiry;
offline banner; recoverable error; permission unavailable; team switcher; draft/version conflict.

Use repository `Sheet`, `ConfirmDialog` and `OverlayRoot`. Short decisions are desktop dialogs and
phone bottom sheets; inspection is a wide right drawer and phone full-height sheet/screen; identity,
withdrawal, activation and conflicts become full-screen phone stages. Every overlay is named,
focus-safe, scrollable and leaves validation, focus and safe-area navigation uncovered.
The frozen per-item 24-row modality and dismissal matrix in
`docs/caring-contacts/interaction-matrix.md` is binding; a generic one-modality Sheet path is not an
acceptable implementation substitute.

## 7. Content, visual and responsive contract

- Australian English, sentence case and verb-first, object-specific actions.
- One filled command per region; headings, rows and dividers before another panel.
- Clinical Sky for identity/focus/continuity. Green, amber and red only for exact semantic state,
  always with text and a non-colour channel. No card soup, marketing gradient, glass-heavy treatment
  or decorative clinical colour.
- Closed transport terms: Scheduled, Processing, Sent, Delivered, Not delivered, Number invalid,
  Contact changed, Status unavailable and Missed. None is a patient-state label.
- ISO machine dates; `en-AU`/`Australia/Perth` display; explicit missing-value phrases, never a dash.
- One `<h1>` per page; titles wrap; patient names, ownership and warnings have a full-value path.
- Real patient information or PHI never appears in toasts, URLs, page titles, analytics, logs or
  screenshots. Prototype and test screenshots contain clearly fictional synthetic identities and
  details so the required visual states remain reviewable without weakening the privacy rule.

Freeze the responsive width-to-state mapping as follows; 390 and 430 are required compact samples,
not additional layout states:

| Width   | State and required composition                                                                                                                                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 320–430 | `compact`: repository-native phone header, four-item dock, no persistent side rail; Today starts with `Referrals to review`; More owns Templates, Team, Guidance and Reports; patient identity and the activation stage stay in flow without a second fixed header                                 |
| 768     | `rail`: collapsed desktop navigation plus a supporting rail; this is not an enlarged phone layout. Today retains its action-first order, while Patients, activation and Schedule may place navigation/context in the rail and keep the working content stacked                                     |
| 1024    | `split` where both panes preserve their minimum viable widths: Today may use action/list, Patients list/detail, activation workflow/preview and Schedule seven-day/day-detail. A composition that cannot preserve both panes falls back to `rail` or `stacked` rather than compressing or clipping |
| 1440    | `wide`: persistent navigation and active-team context with comparison-friendly patient, plan and schedule compositions                                                                                                                                                                             |

Review 400% zoom on 1280px as equivalent narrow reflow. Components may use `stacked` between the
frozen shell states when their own container cannot support a rail or split. All controls meet the
repository tap-target, naming, keyboard and focus contracts. Dark mode, forced colours and reduced
motion are first-class. No horizontal page scroll or sticky content covering focus/validation is
permitted.

## 8. Approval boundary

This specification is not clinical approval, WA Health endorsement, clinical-effectiveness evidence
or production readiness. Progression requires the complete synthetic prototype, clinical-language
and accessibility review, lived-experience approval of message content and the complete prototype,
privacy/security review, and explicit approval to begin production implementation planning.

## 9. Final design handoff set

Implementation must treat this specification together with the following records as one frozen
design handoff:

- [content style guide](../../caring-contacts/content-style-guide.md);
- [clinical-language review](../../caring-contacts/clinical-language-review.md);
- [accessibility and responsive acceptance](../../caring-contacts/accessibility-acceptance.md); and
- [interaction matrix](../../caring-contacts/interaction-matrix.md) — the binding 24-row modality and dismissal decisions.
- [linked prototype handoff](../../caring-contacts/linked-prototype-handoff.md).

The local evidence is synthetic Chromium/source evidence only. Physical iPhone Safari and installed-
PWA acceptance are unrun and required later. None of these documents converts the prototype into a
production route or authorises patient data, provider/API work, SMS, migration, deployment or a
pilot.
