# Caring Contact Coordination Workspace — Repository-Native Rollout Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use `- [ ]` checkboxes. Treat each implementation tranche below as an independent reviewed plan; do not execute the whole programme as one branch.

**Goal:** Deliver a premium, responsive, one-way caring-contact coordination workspace for WA hospital services, beginning with an approved visual and clinical-operating model and progressing through a controlled synthetic-data build, governed integration, limited pilot, and measured expansion.

**Architecture:** Keep the feature in this repository so it inherits the current Clinical KB design system, accessibility primitives, testing discipline, and application infrastructure, but give it a dedicated route group and operational shell. Do not make it a searchable Clinical KB mode and do not send patient data through the existing RAG/OpenAI path. Before real-patient use, deploy the workspace against an explicitly approved PHI-capable identity, hosting, datastore, audit, records, and SMS boundary rather than assuming the current Clinical KB deployment is suitable.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript, the repository v2 design system, Tailwind CSS token utilities, Vitest/Testing Library, repository-wrapped Playwright, PostgreSQL/Supabase only if separately approved, and a provider-neutral SMS outbox/adapter.

**Decision revision:** 15 August 2026 — incorporated the completed product, clinical-operating, privacy, rollout and visual-direction grilling session.

## Global constraints

- Initial cohort: clinician-enrolled adults leaving an emergency department or hospital after a suicidal crisis.
- A broader clinician-selected mental-health discharge cohort is a later, separately governed expansion. It is not part of the initial clinical scope or pilot acceptance criteria.
- Initial channel: one-way caring-contact SMS. No inbox, conversation thread, reply workflow, automated urgency detection, risk score, risk prediction, triage, or clinical advice.
- Caring contacts supplement usual care and person-to-person follow-up. Delivery is never evidence of safety, wellbeing, engagement, or treatment response.
- Every plan has one owning clinical team and one visible coordinating clinician. Safe reassignment must preserve audit history.
- Patient-visible messages come from the named clinical team and are signed by the coordinating clinician. The sender label, signature, escalation wording and substitution rules are governed content, not free text.
- Agreement remains the approved lightweight collaborative verbal-agreement model. The UI label is `Agreement confirmed`, not a claim of legal or treatment consent. Its exact local policy classification and clinical-record documentation are approval gates before pilot.
- Pathways and message variants are locally approved and versioned. Clinicians personalise only within deterministic, governed boundaries. There is no generative-AI message authoring.
- The twelve-month cadence is illustrative: day 1, week 1, months 1, 2, 3, 4, 6, 8, 10 and 12. It must be labelled `Service approved` or `Illustrative locally governed pathway`, never presented as a universal prescription.
- Use fictional patient data in plans, mockups, screenshots, fixtures, tests, demos and local verification until the real-patient pilot is explicitly authorised.
- Patient identifiers, phone numbers, message content and clinical context must never enter the existing Clinical KB search, answer, RAG, OpenAI, query-log, favourites, recent-search, browser-history or analytics paths.
- No production or patient-data API, Supabase, SMS-provider, migration, deployment or live canary work is authorised by this plan. Those actions require an explicit later request naming the target.
- Use `Australia/Perth` for operational scheduling and `en-AU` for display. Preserve machine ISO timestamps and the original timezone/offset in audit events.
- Meet WCAG 2.2 AA and the repository's stronger contracts: 48px targets except an existing documented exception, 320px and 400% reflow, dark mode, forced colours, reduced motion, keyboard use, screen-reader naming, safe areas and no patient data in transient notifications.
- Design and implementation must preserve exact operational language. Prohibited concepts include `high risk`, `safe`, `engagement score`, `needs attention` without a named reason, `campaign`, `lead`, `conversion`, `best match`, `inbox`, `messages` and `conversation`.
- The design approval gate comes before production route, database, API or delivery implementation.

## Approved decision lock — 15 August 2026

These decisions refine the approved concept and must not be reopened during routine implementation. A formal clinical, privacy, security, records, procurement or service approval may block a decision from production use, but it must record the conflict and accountable owner rather than silently changing the product model.

### Service, referral and ownership model

- The first real-patient pilot serves one dedicated hospital aftercare/transition team at one hospital/service. It is not a statewide or multi-health-service tenancy pilot.
- The discharging clinician confirms the source-system identity, mobile information and verbal agreement. The existing hospital record/referral workflow sends a structured referral to Caring Contacts.
- The dedicated aftercare team reviews, personalises, activates and owns the caring-contact plan for its full duration.
- New referrals appear first on Today in `Referrals to review`, ordered by discharge and first eligible contact-window timing, never inferred clinical risk.
- The aftercare team may accept, return for clarification or decline using structured reasons. Clarification and decline write back to the hospital referral system, which owns referrer notification.
- The referring team retains responsibility until explicit acceptance. Caring Contacts must not imply that a pending or returned referral has transferred ownership.
- Accepted referrals enter the team queue and require an explicit coordinator claim or team-lead assignment. There is no automatic round-robin assignment.
- Authorised teammates provide audited coverage during coordinator absence; the named coordinator and any formal reassignment remain visible.
- Eligibility uses objective prerequisites only: adult status, qualifying discharge/referral, pilot-service scope, patient-controlled mobile flag and agreement. Diagnosis, presentation details and risk assessments never drive automated eligibility.
- Search is restricted to referrals and caring-contact episodes belonging to the pilot team. Caring Contacts is not a hospital-wide patient directory.

### Mobile, agreement and patient control

- Caring Contacts imports the current hospital-record mobile number without test SMS, verbal read-back or separate referrer attestation.
- Activation nevertheless requires an explicit source-system flag that the destination is patient-controlled and suitable for discreet SMS. A plain mobile-number field is insufficient. Family, carer and shared destinations are ineligible.
- The agreement interface is a simple `Agreement confirmed: Yes/No`. The audit automatically retains the source referral, referring clinician and received timestamp; no separate Caring Contacts agreement ceremony is added.
- A source-system mobile-number change automatically pauses future contacts and creates a coordinator-review exception. Caring Contacts never silently switches the destination.
- Patients request timing changes, pause or withdrawal through the named programme phone. It is staffed seven days during every sending window, and any authorised team member can act immediately.
- Withdrawal immediately cancels all unsent contacts, requires no approval, retains immutable history and writes back the milestone. A reason is optional.
- A pause keeps the original discharge-anchored calendar. Contacts falling inside the pause are skipped permanently; explicit resumption begins with the next future contact.

### Schedule and message policy

- The schedule is anchored to actual discharge time. The first message uses the next occurrence of the patient's approved sending time.
- Contacts may send on weekends and WA public holidays between 9:00 am and 6:00 pm AWST.
- Each patient plan stores one selected preference: `Morning`, `Afternoon` or `Early evening`, mapping to predictable service times of 10:00 am, 2:00 pm and 5:00 pm respectively. All contacts in that plan derive the same window; the Schedule dashboard may aggregate different patients across the three service windows.
- A missed first or later contact is recorded but never sent retrospectively. The pathway retains its original calendar.
- Coordinators may move a contact only within its scheduled day. A date change requires a reason and team-lead approval.
- Personalisation is structured only: preferred name, neutral team identity, coordinator signature and approved message variants. There is no unrestricted clinician free text or dynamic translation.
- The first pilot uses approved English content only. Interpreter-supported enrolment uses existing service processes; translated pathways require separate professional translation and cultural approval.
- Patient-visible sender and message wording are discreet but recognisable and never expose suicide, crisis or mental-health treatment on a lock screen.
- Use a non-receiving sender. Caring Contacts receives, stores, analyses and displays no replies.
- Enrolment and the first SMS provide complete support information. The first SMS includes the programme phone and hours, emergency direction and one approved crisis-support contact in plain text; later messages retain the short no-reply boundary and programme contact.
- Every fully substituted message, including required notices and signature, is limited to two concatenated SMS segments. The UI shows encoding and exact segment count and blocks overflow.

### Episode, delivery and hospital-status policy

- A new referral for a patient with an active plan is blocked as a duplicate and routed to review of the existing episode.
- A later qualifying discharge creates a new linked episode after the earlier episode is completed, cancelled or withdrawn. Earlier episodes are never reopened or mutated.
- Hospital readmission automatically pauses future contacts. A later discharge requires a new linked referral and coordinator decision; the old episode never automatically resumes or rebases.
- A recorded death immediately and irreversibly cancels all unsent contacts. A later source correction is an incident and requires a new referral for any future plan.
- Completed, cancelled and withdrawn plans become read-only, leave active worklists and remain available for the formally approved retention period.
- Structured clinical-record write-back covers referral outcome, activation, pause, withdrawal, cancellation, material delivery exception and completion. Detailed transport and access evidence remains in Caring Contacts.
- Transient transport failures receive two bounded application retries, for three attempts total, within the original window. The application never retries outside that window.
- A permanent failure pauses future contacts and creates a same-day operational task. It never automatically triggers patient contact or clinical review.
- Provider outage contacts that miss their window are marked missed and never sent late. Future cadence remains unchanged after restoration.
- Active plans keep immutable pathway and message snapshots. An urgent safety retirement pauses affected future contacts for explicit review; ordinary version updates do not rewrite them.

### Governance, identity, privacy and reporting

- A clinical programme lead and a lived-experience/content representative both approve new or materially changed pathway/message versions. Privacy or legal review joins when disclosure or agreement changes.
- The pilot proves operational safety, reliability, clinician usability and patient acceptability. It is not a clinical-effectiveness study.
- Patient acceptability uses a separately consented evaluation process outside Caring Contacts, with aggregate reporting only.
- WA Health enterprise SSO/MFA and service-managed team groups control access. No Caring Contacts-local credentials exist.
- Any device may access Caring Contacts only when WA Health SSO/MFA, conditional access and managed-session controls succeed. No patient download or persistent browser-local patient storage is permitted.
- Enterprise policy controls session timeout. Activation, withdrawal, reassignment and any allowed export require fresh authentication.
- The pilot permits no patient-level export. Approved aggregate reporting may include imported clinical-source demographic fields with a governance-configured small-cell threshold and a non-inferable `Suppressed` state.
- Every patient search, view, decision, mutation, write-back and administrative access enters an immutable audit trail. Clinicians see episode-relevant operational history; privacy/security auditors see the complete access trail.
- Today activity shows patient name, exact action, clinician and time to authorised team members, but never phone number, message text or clinical details.
- External WA Health email or managed-push alerts contain no patient identifiers and require authentication. During staffed hours, referrals must be reviewed before their first eligible window, permanent delivery exceptions receive same-day review and unclaimed work escalates to the team lead after 60 minutes.

### Hosting, incident and pilot controls

- Real-patient hosting uses a separately contracted PHI-capable Australian-region cloud environment, not the current Clinical KB deployment.
- Identifiers, message content, application data, backups, logs and SMS-provider processing remain in Australia. Overseas support access requires explicit approval and auditing.
- Vendors may manage encryption only through dedicated tenant-scoped Australian-region keys with documented rotation and contractually reviewable privileged access.
- Any confirmed wrong-recipient message, duplicate send, unauthorised content, material privacy/security incident or loss of audit integrity immediately pauses the entire pilot.
- Restart requires joint approval from the incident lead, privacy/security owner and clinical programme lead after reconciliation and remediation.
- Downtime fails closed: no offline patient cache, no new activation and no uncertain send. Staff use the approved service downtime process and reconcile before resuming.
- Provider webhooks are the normal transport-status source. Staff perform manual provider reconciliation when an outage, discrepancy or suspected incident occurs; there is no routine daily full reconciliation. This is a conscious residual risk requiring provider, service and security acceptance before pilot.
- The single-team pilot has no numeric patient cap and accepts every eligible referral while open. This is a conscious exposure choice; strict automatic stopping rules, workload monitoring and the 6–8-week early governance review are mandatory.
- Production access requires assessed simulation of identity review, activation, withdrawal, delivery failure, readmission, downtime and incident handling.
- Lived-experience approval is required at message-content, complete-prototype and pilot-findings gates, and may block progression.
- Go-live receives two weeks of seven-day hypercare with named clinical, service, technical, privacy and incident leads plus daily Caring Contacts queue/state review. Provider-side reconciliation remains event-triggered by outage, discrepancy or suspected incident.
- Rollout remains sequential: approved design specification → complete synthetic prototype → secure datastore/tenancy → fake-provider simulation → authorised non-production provider → staged real-patient pilot.

### Approved visual direction

- **Today:** guided command centre with `Referrals to review`, distinct `Needs action` and today's sending-window panels, recent activity, then quiet metrics.
- **Activation:** guided split with persistent patient identity, focused stage content and live exact-message preview; phone uses a labelled preview sheet.
- **Continuity:** widening horizontal thread whose close early nodes spread across twelve months, followed immediately by the complete chronological text/list equivalent.
- **Phone navigation:** four-item dock — Today, Patients, Schedule and More. Templates, Team, Guidance and Reports live in the More sheet. Desktop exposes all five primary areas directly.
- **Schedule:** day-led split with a seven-day strip, named exceptions separated from ordinary sending-window lists, and a secondary week inspection.
- **Patient results:** identity-forward action rows with minimum distinguishing identifiers and a separate identity-confirmation step.
- **Delivery exceptions:** contextual desktop resolution drawer; the same content becomes a full-screen phone sheet.
- **Final activation:** sectioned assurance review showing identity, source eligibility, agreement, ownership, exact message, cadence and one-way boundaries together before fresh authentication.

## 1. Outcome and recommended direction

Build Caring Contacts as a **dedicated caring-contact workspace inside this codebase, with a separate operational shell and a separately approved runtime/data boundary**.

That choice deliberately separates three things:

1. **Shared design language** — tokens, typography, controls, overlays, focus behaviour, accessibility, responsive states, iconography and quality gates come from Clinical KB.
2. **Dedicated product navigation** — Today, Patients, Schedule, Templates and More belong to caring-contact coordination, not to the global search composer or the thirteen reference modes.
3. **Patient-data boundary** — the current product and PIA assume no solicited patient-identifiable data. Caring Contacts cannot silently widen that assumption by adding a route to the existing RAG deployment.

The memorable product signature is one restrained **continuity thread**: close early nodes that widen across the approved cadence. It is a schedule and continuity device only. It never changes colour or geometry based on clinical state, inferred risk, delivery success or patient behaviour.

## 2. Evidence-backed repository design audit

### 2.1 Source-of-truth order

Use the repository's declared order, not historical preference:

1. `AGENTS.md` — execution, UI, search-chrome, wiring, verification and clinical-governance rules.
2. `src/app/ckb-v2-tokens.css` — authoritative v2 roles and values.
3. Committed design-system and browser tests.
4. `.design-sync/conventions.md`.
5. `docs/design-system/README.md`, `SPEC.md`, `TOKENS.md`, `COMPONENTS.md`, `DECISIONS.md`, `GATES.md` and `ADOPTION.md`.

`docs/design-system.md` is a transitional description, not the current specification. The older `docs/redesign/*` material remains useful rationale, but the `docs/design-system/` set wins when they disagree. `docs/design-system/HANDOVER-2026-08-07.md` is explicitly superseded and must not scope this work.

### 2.2 Current visual language to inherit

- True-white clinical canvas with quiet graphite text and chrome.
- Graphite `--command` for the one dominant primary action in a surface.
- Clinical Sky `--clinical-accent` for clinical identity, selected state, focus and the continuity-thread signature.
- Green, amber and red reserved for exact semantic status; never decoration, identity or charts.
- Geist typography, sentence case, Australian English, tabular numerals and typography-led hierarchy.
- Four-pixel spacing rhythm; v2 semantic size, radius and elevation tokens; one edge owner per surface.
- Flat light-mode surfaces with hairline separation and restrained elevation. Glass/blur only where the overlay contract already allows it.
- Sparse cards. Prefer headings, spacing, dividers and rows before adding another panel.
- Five responsive layout states: `compact`, `stacked`, `rail`, `split` and `wide`.
- Page titles wrap; one `<h1>` is owned by `PageHeader`; actions yield before the title does.
- Degraded and exception states say what happened, what it means and what action is available.

### 2.3 Rendered evidence used

The repository's six canonical Linux baselines are human-approved hosted-CI artifacts recorded in `tests/__screenshots__/linux/provenance.json` and governed by `docs/design-system/adoption-contract.json`:

| Rendered surface         | Evidence file                                               | Caring Contacts lesson                                                                    |
| ------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Dashboard shell, desktop | `tests/__screenshots__/linux/dashboard-shell.png`           | Quiet centred hierarchy, one obvious command and minimal chrome.                          |
| Dashboard shell, phone   | `tests/__screenshots__/linux/dashboard-shell-phone.png`     | Compact header, large reachable action and safe-area discipline.                          |
| Results band, desktop    | `tests/__screenshots__/linux/search-results-band.png`       | Dense operational metadata belongs in calm rows, not KPI cards.                           |
| Results band, phone      | `tests/__screenshots__/linux/search-results-band-phone.png` | Controls collapse to explicit actions instead of shrinking unreadably.                    |
| Document viewer          | `tests/__screenshots__/linux/document-viewer.png`           | Split-pane inspection, progressive disclosure, provenance and action hierarchy.           |
| Therapy Compass home     | `tests/__screenshots__/linux/therapy-compass-home.png`      | Repository-native workflow launcher with a restrained choice set and plain clinical copy. |

The local app identity was also confirmed through `/api/local-project-id` as `Clinical KB`. The verified server started at the repository-selected port; no assumed localhost port is part of this plan.

### 2.4 Reuse map

| Need                                                                | Reuse                                                                                       | Rule                                                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Global theme, fonts, CSP, auth context, announcements, overlay root | `src/app/layout.tsx`                                                                        | Keep the root layout; do not duplicate providers or create a second overlay root.                                                            |
| Tokens                                                              | `src/app/ckb-v2-tokens.css`, `src/app/globals.css`                                          | No raw colour, pixel, z-index, duration, radius or shadow values in production components.                                                   |
| Actions                                                             | `src/components/ui/button.tsx`, design-system `IconButton`                                  | One filled command action per region; verb-first labels.                                                                                     |
| Fields and errors                                                   | `FormField`, `TextField`, `SearchField`, `Select`, `Checkbox`, `RadioGroup`, `ErrorSummary` | Labels are persistent; errors are field-connected; autocomplete semantics are reviewed for patient fields.                                   |
| Modal decisions and phone sheets                                    | `src/components/ui/sheet.tsx`, `src/components/ui/confirm-dialog.tsx`, `OverlayRoot`        | Desktop dialog/drawer and phone bottom-sheet/full-screen treatment share one focus-safe primitive.                                           |
| Tabs and view choices                                               | `Tabs`, `SegmentedControl`                                                                  | Tabs change panels; segmented controls change sort/density/view.                                                                             |
| Status and tags                                                     | `Chip`, `InlineNotice`, `StatusMark` where status is the content                            | Text is the primary status channel; colour and shape are secondary. Create domain vocabularies rather than reusing source-governance status. |
| Page structure                                                      | `PageHeader`, `Breadcrumb`, `PanelHeading`, `Disclosure`, `AccessibleTable`                 | Titles never truncate; compact tables become labelled cards.                                                                                 |
| Feedback                                                            | `ToastProvider`, `LiveAnnouncer`, `EmptyState`, `ErrorState`, `LoadingPanel`, `Skeleton`    | Toasts contain no patient details. A spinner is never a terminal state.                                                                      |
| Dates                                                               | `DateDisplay`                                                                               | ISO in, `en-AU`/Perth out; relative dates are secondary.                                                                                     |
| Launcher entry                                                      | `src/lib/tools-catalog.ts`, `/tools`                                                        | Add one `coordination` destination after production-route approval. Do not add a searchable `AppModeId`.                                     |
| Route reachability                                                  | `docs/wiring-conventions.md`, `tests/route-reachability.test.ts`                            | Every production route has a real inbound path or a documented, tested exception.                                                            |

### 2.5 Components not to extend as Caring Contacts foundations

- `GlobalSearchShell`, `MasterSearchHeader` and the shared composer: Caring Contacts is patient-first, not query-first.
- `app-modes.ts`: every current mode declares a search contract; caring-contact coordination is not a search result surface.
- `patient-profile-storage.ts`: browser-local reference context is not an acceptable patient-plan datastore.
- `AsyncButton`: deprecated; use `Button` busy state.
- `FilterBar` and `DataTable`: retired names; use surface-owned filters and `AccessibleTable`.
- Legacy teal, blue-corporate, warm-porcelain, pure-monochrome, glass-heavy and generic-SaaS directions rejected in `docs/redesign/permanent-colour-direction.md`.
- Mockup-specific raw colour or layout exceptions. Promotion to production requires full token adoption.

### 2.6 Repository maturity conflict that changes the rollout

The existing product explicitly tells clinicians not to enter patient-identifiable information. Its current persistence is individual-owner scoped, and its PIA describes Clinical KB as a knowledge base rather than a patient record. Caring Contacts requires deliberate identity confirmation, mobile details, agreement, team ownership and longitudinal communication history. Therefore:

- Design work can proceed in this repository with synthetic data.
- Production code can proceed only behind a non-production feature boundary.
- Real-patient use cannot proceed on the current deployment assumptions without a new privacy, security, records, tenancy and hosting decision.
- The current Railway/OpenAI RAG route is irrelevant to message generation and must not receive Caring Contacts data.

## 3. WA clinical, service and evidence grounding

### 3.1 What the authoritative sources support

- The WA Mental Health Commission announced an Aftercare Services Program on 15 June 2026 providing brief interventions, psychosocial support and care coordination for people discharged after a suicidal crisis. This supports the cohort and coordination context, not a particular SMS workflow: [Aftercare Services launched](https://www.mhc.wa.gov.au/news-and-resources/latest-news/aftercare-services-launched).
- WA guidance emphasises direct, coordinated post-discharge follow-up, documented clinician responsibility, collaborative discharge planning and local protocols. Caring Contacts must remain additive to these arrangements, never their substitute: [Principles and Best Practice for the Care of People Who May Be Suicidal](https://www.health.wa.gov.au/-/media/Files/Corporate/general-documents/Mental-health/PDF/Best-Practice-for-the-Care-of-People-Who-May-Be-Suicidal.pdf).
- NSQHS Action 5.32 requires follow-up arrangements to be developed, communicated and implemented. Caring Contacts may coordinate one bounded element of an approved follow-up plan but cannot claim to satisfy the standard by itself: [Comprehensive Care Standard](https://www.safetyandquality.gov.au/national-standards/nsqhs-standards/comprehensive-care-standard).
- EMHS distinguishes clinically relevant community follow-up from administrative contact. Caring-contact delivery must not be counted as clinical follow-up unless the health service's measure owner explicitly defines it that way: [Community follow-up within seven days](https://emhs.health.wa.gov.au/Patient-Care/Safety-and-Quality/Mental-Health/Community-Follow-Up).
- WA Health's consent policy requires collaborative, informed decision-making and consistent documentation. Local governance must decide how the caring-contact agreement maps to treatment consent, communication preference and the clinical record: [Consent to Treatment Policy](https://www.health.wa.gov.au/About-us/Policy-frameworks/Clinical-Governance-Safety-and-Quality/Mandatory-requirements/Consent-to-Treatment-Policy).
- WA Health's Digital Health and Information Security policies make consumer consent, privacy, cyber security, confidentiality, integrity and availability mandatory design inputs: [Digital Health Policy Framework](https://www.health.wa.gov.au/about-us/policy-frameworks/digital-health), [Information Security Policy](https://www.health.wa.gov.au/about-us/policy-frameworks/digital-health/mandatory-requirements/information-security-policy).

### 3.2 What the research does not establish

The illustrative cadence comes from a 12-month trial of 11 nondemanding messages in a US military population. Primary outcomes were not significant, while some secondary outcomes favoured the intervention. The protocol monitored replies and was adapted when participants found unresponsive messaging mechanical. The research therefore does **not** validate an unmonitored one-way WA hospital service, the exact cadence, or its channel notice: [Comtois et al. randomised clinical trial](https://pmc.ncbi.nlm.nih.gov/articles/PMC6495345/).

A systematic review found mixed estimates across outcomes and time points, with a protective one-year estimate for attempts but uncertainty for mortality and emergency presentations/hospitalisation. The product must describe caring contacts as a locally governed service intervention with an evidence base that remains heterogeneous, not as a proven universal suicide-prevention mechanism: [Caring Contacts systematic review and meta-analysis](https://pubmed.ncbi.nlm.nih.gov/35420858/).

### 3.3 Clinical-language guardrail

Every design and implementation review must reject copy or visuals that imply:

- a patient is safe because a message was delivered;
- failure to deliver is a clinical deterioration signal;
- non-response or reply content has been interpreted;
- a pathway is a prescription for all patients;
- the application is monitoring the patient;
- automated contact replaces active follow-up, safety planning, review or emergency care;
- a team has transferred duty of care merely by reassigning a plan in software.

## 4. Repository-native approaches considered

### Approach A — add Caring Contacts as another shared search mode

**Shape:** Extend `app-modes.ts`, `GlobalSearchShell` and the shared composer.

**Benefits:** Lowest shell work; automatic access to mode navigation and search chrome.

**Costs:** The query-first shell conflicts with patient-first enrolment; it would force a false search contract, invite patient details into the global composer, blur the PHI boundary and make Today/Patients/Schedule/Templates secondary.

**Disposition:** Reject.

### Approach B — dedicated route group and operational shell in this repository

**Shape:** Add `/caring-contacts/**` outside `(search-app)`, inherit the root v2 layer and primitives, launch it from Tools, and use a dedicated five-destination shell. Keep patient APIs and delivery services isolated from RAG and approved separately.

**Benefits:** Native visual maturity without semantic compromise; clean patient-data and navigation boundaries; direct reuse of accessibility, overlays, tokens and testing; one codebase for maintainers.

**Costs:** Requires a new shell, team tenancy model, operational routes and an explicit production-data architecture.

**Disposition:** Recommend.

### Approach C — separate application repository with copied design assets

**Shape:** Build Caring Contacts independently and manually mirror Clinical KB tokens/components.

**Benefits:** Strongest operational and deployment isolation.

**Costs:** Immediate design-system drift, duplicated accessibility work, slower visual convergence and a second governance/tooling estate.

**Disposition:** Reserve for a future organisational decision if WA hosting, ownership or procurement requires full code isolation. Do not choose it merely for visual separation.

## 5. Information architecture and route plan

### 5.1 Primary navigation

1. **Today** — referrals awaiting review, named exceptions, today's scheduled contacts and recent team activity.
2. **Patients** — patient search, enrolled patients and caring-contact history.
3. **Schedule** — team day/list default with week inspection.
4. **Templates** — approved pathways and message variants.
5. **More** — active team, handover, guidance, help and role-appropriate reporting.

No Inbox, Messages or Conversations destination exists in the initial product.

Today keeps the approved action-first order on every viewport: `Referrals to review`, named operational exceptions, today's scheduled contacts, recent team activity, then quiet aggregate service metrics. Responsive layouts may change presentation, but must not promote reporting above work that requires action.

### 5.2 Production route inventory

| Route                        | Responsibility                                              | Primary layout state                              |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `/caring-contacts`           | Today dashboard                                             | compact cards; wide action/list split             |
| `/caring-contacts/patients`  | Pilot-team referral and caring-contact episode search       | stacked/rail                                      |
| `/patients/[patientId]`      | Patient identity, agreement, plan history and current plan  | stacked/split                                     |
| `/plans/new`                 | Four-stage activation for one accepted referral             | compact full-stage; wide stepper + live preview   |
| `/plans/[planId]`            | Plan detail, future schedule, ownership and audited actions | stacked/split                                     |
| `/caring-contacts/schedule`  | Team day/list and week inspection                           | compact list; wide rail/split                     |
| `/contacts/[contactId]`      | Contact detail and exact delivery state                     | full page on phone; drawer-capable detail on wide |
| `/caring-contacts/templates` | Approved pathways and message variants                      | stacked/rail                                      |
| `/templates/[pathwayId]`     | Cadence, version, governance and variant preview            | stacked/split                                     |
| `/caring-contacts/team`      | Active context, team ownership and handover                 | stacked/rail                                      |
| `/caring-contacts/guidance`  | Programme boundaries and contextual help                    | readable wide/rail                                |
| `/caring-contacts/reports`   | Privacy-conscious aggregate operations                      | stacked/wide                                      |

The `More` control opens a navigation sheet on compact layouts and exposes direct links on wide layouts. Patient search is scoped to the pilot team's received referrals and retained Caring Contacts episodes. It never queries the hospital-wide directory directly and never writes to browser search history or the Clinical KB search store.

### 5.3 Overlay and full-screen decision inventory

Use `Sheet`/`ConfirmDialog`; on phone, promote clinical decisions to a bottom sheet or dedicated full-screen stage:

1. Verify patient identity.
2. Change patient confirmation.
3. Pathway preview.
4. Message-variant preview.
5. Add optional communication preference.
6. Adjust date/time within policy.
7. Outside permitted contact-time warning.
8. Save draft.
9. Discard unsaved changes.
10. Final activation confirmation.
11. Activation success.
12. Pause remaining contacts.
13. Record withdrawal.
14. Reassign coordinator.
15. Delivery-status detail.
16. Resolve failed delivery.
17. Contact-details-changed block.
18. Template changed or retired.
19. Session-expiry warning.
20. Offline/connection banner.
21. Recoverable error.
22. Permission unavailable.
23. Active-team switcher.
24. Draft/version conflict.

## 6. Core workflows and safety behaviour

### 6.1 Review a referral and start a plan

1. The hospital referral workflow sends a structured referral containing the approved minimum identity, discharge, mobile-source and agreement fields.
2. Today lists the referral under `Referrals to review`, ordered by first eligible contact-window timing without risk ranking.
3. An authorised aftercare clinician chooses `Accept`, `Return for clarification` or `Decline` with a structured reason. The latter two outcomes write back to the source workflow.
4. Until acceptance, the referring team remains responsible and Caring Contacts displays `Awaiting handover`; it never shows an aftercare owner.
5. Acceptance moves the referral to the team queue. A coordinator explicitly claims it or a team lead assigns it before activation.
6. Search and selection reveal only the minimum identifiers needed to distinguish this team's referrals and episodes.
7. A deliberate identity-confirmation step repeats the selected referral, source identifiers, patient-controlled-mobile flag and imported agreement status.
8. The selected patient persists as a compact identity header through every stage, with an explicit `Change patient` confirmation.
9. Missing objective eligibility, source-controlled mobile evidence, agreement, owning team or coordinator blocks pathway selection with a named resolution path.

### 6.2 Choose a pathway

- Show only current, locally approved versions available to the active team.
- Preview duration, exact cadence, sender, one-way boundary, example tone and approval owner.
- Do not rank pathways, calculate fit or mark one as `best`.
- The clinician makes and owns the selection.

### 6.3 Personalise

- Select approved, warm, non-demanding variants.
- Permit only governed substitutions such as preferred name, discreet team display name, coordinator signature and selection among approved message variants.
- Render the exact patient-visible SMS, GSM-7/Unicode segment count and sender identity.
- Block any fully substituted message over two concatenated SMS segments.
- Show the selected `Morning`, `Afternoon` or `Early evening` window and its exact 10:00 am, 2:00 pm or 5:00 pm AWST send time.
- Show the full continuity thread and readable date list.
- Deterministically block missing mandatory wording, reply invitations, appointment/task language, clinical advice and prohibited placeholders.
- Preserve entered work across recoverable errors and session-warning recovery.

### 6.4 Review and activate

- Repeat patient identifiers, the imported mobile and source, patient-controlled/discreet-SMS suitability evidence,
  agreement, owning team and coordinator. Do not claim separate destination verification or reverification.
- Show exact text, dates, send times, timezone, pathway version, two-segment evidence and one-way/no-monitoring notice.
- Detect stale drafts, template retirement, patient detail changes and competing activation.
- Require fresh WA Health authentication for the object-specific final action: `Activate 10-contact plan`.
- Activation atomically creates immutable contact snapshots and one audit event; retrying the request must not duplicate a plan or contact.

### 6.5 Manage an active plan

- Future contacts can be adjusted only within policy and with an audited reason.
- Pause is reversible; withdrawal is a patient preference and terminal for future contact; cancellation is an authorised operational action with a reason.
- Pausing never moves dates; contacts inside the pause are skipped permanently, and explicit resumption begins with the next future scheduled contact.
- Withdrawal immediately cancels every unsent contact and may be recorded by any authorised teammate who receives the request through the staffed programme phone.
- Reassignment changes the coordinator, not the owning team's history.
- A source mobile-number change or hospital readmission automatically pauses future contacts for review.
- A recorded death irreversibly cancels every unsent contact; a corrected source event remains an incident and any future episode requires a new referral.
- A later discharge after readmission requires a new linked referral and never automatically resumes or rebases the earlier episode.
- A contact already claimed by the dispatcher shows `Processing — too late to change` and cannot be silently cancelled.
- Contact-detail changes pause future sends until updated source-system mobile, patient-controlled
  and discreet-SMS-suitability evidence is imported and reviewed; no test SMS, read-back or Caring Contacts
  attestation is added.
- A retired template never silently edits activated message snapshots. Governance defines whether affected future contacts continue, pause for review or require a replacement pathway.

### 6.6 Delivery exception

- Delivery states remain transport states: Scheduled → Processing → Sent → Delivered.
- Exact exception states: Not delivered, Number invalid, Contact changed, Status unavailable.
- Each exception names the operational action and owner.
- Apply at most two bounded retries—three attempts total—inside the original sending window; never expose `Retry` as an unbounded send button.
- A permanent failure pauses future contacts and creates a same-day operational task until details are reviewed.
- Attempted replies are never rendered as a conversation. The approved technical path must either prevent inbound SMS or send the approved automatic channel notice. Raw reply content is not analysed, triaged or displayed.
- The selected production path uses a non-receiving sender. A transport failure creates no inferred clinical alert or automatic patient call.
- Provider-outage contacts that miss their approved window are recorded as missed and never sent late.

## 7. State and invariant model

### 7.1 Plan lifecycle

`Draft → Active → Paused → Active → Completed`

Alternative terminal states: `Withdrawn` and `Cancelled`.

Referral lifecycle: `Received → Awaiting review → Accepted | Clarification requested | Declined`.

Invariants:

- Completed, withdrawn and cancelled plans cannot schedule new contacts.
- Withdrawal cancels every unclaimed future contact in the same transaction.
- Pausing does not alter historical delivery events or rebase future dates; contacts inside the pause become skipped.
- Reactivation cannot recreate already-sent contacts.
- A duplicate referral cannot create a second active plan.
- Readmission pauses; death cancels irreversibly; either event records its source-system provenance.
- Every state change records actor, active team, timestamp, previous state, next state and reason code.

### 7.2 Contact lifecycle

`Scheduled → Processing → Sent → Delivered`

Exception/terminal transitions:

- Scheduled → Cancelled because plan paused, withdrawn or cancelled.
- Processing → Sent or Not delivered.
- Sent → Delivered, Not delivered or Status unavailable.
- No transition leaves Delivered for a clinical state.

### 7.3 Template lifecycle

`Draft → Approved → Retired`

- Approval produces an immutable version.
- A pathway references exact approved message-variant versions.
- Activation snapshots exact text and schedule policy.
- Retirement blocks new selection and creates a named review task for affected drafts; it never rewrites active history.

## 8. Patient data, privacy, security and records architecture

### 8.1 Data minimisation

Store only what coordination requires:

- external patient identifier and a minimal identity snapshot for deliberate confirmation;
- imported mobile number, source-system provenance and explicit patient-controlled/suitable-for-SMS flag;
- preferred name and explicitly selected communication preferences;
- imported agreement boolean plus source referral, referring clinician and received timestamp;
- owning team and coordinator identifiers;
- approved pathway/version, exact scheduled contacts and exact message snapshots;
- delivery metadata, operational exception codes and append-only audit events.

Do not store free-text suicide-risk assessments, prediction features, clinical notes, diagnosis narratives, message-reply interpretation, engagement scores or copied EMR content.

### 8.2 Runtime boundary

- Keep `/caring-contacts/**` out of service-worker content caching and browser-local persistence containing PHI.
- Use authenticated server-side access and short-lived responses with `Cache-Control: no-store` for patient routes/APIs.
- Prevent patient identifiers in URLs where a stable opaque plan/patient reference can be used.
- Redact identifiers and phone numbers from application logs, error reports, analytics, metrics labels and webhook diagnostics.
- Never put patient details in toast titles, browser notifications, document titles, telemetry breadcrumbs or screenshot fixtures.
- Disable RAG/OpenAI calls for the entire route group by architecture, not by convention.
- Use WA Health enterprise SSO/MFA, conditional access and managed-session controls on every device. Follow the enterprise idle-expiry policy and require explicit reauthentication for activation, withdrawal, reassignment and export.
- Do not allow patient-level downloads, offline patient caches or persistent browser-local patient data.

### 8.3 Team tenancy and roles

The current individual `owner_id` model is insufficient. The approved datastore must represent:

- `team_member` — view team plans and perform ordinary coordination permitted by role.
- `coordinator` — create, personalise, activate and manage assigned plans.
- `team_lead` — reassign coordinators and approve exceptional operational actions.
- `template_governor` — approve/retire pathways and message variants; cannot gain patient access solely from this role.
- `report_viewer` — access authorised aggregates with small-cell suppression; no patient detail by default.
- `system_operator` — delivery operations without unnecessary clinical identity fields.

Every read and mutation is team-scoped and deny-by-default. Service-role access is not a substitute for RLS/authorisation. Cross-team switching clears cached patient state before the new context renders.

### 8.4 Record of truth

Caring Contacts is not the clinical record. The design requires structured milestone write-back while detailed transport and access evidence remains in Caring Contacts. Before pilot, the service must approve:

- which system is authoritative for patient identity and mobile details;
- where agreement, activation, pause, withdrawal, exception resolution and plan completion are recorded clinically;
- the structured referral-outcome, activation, pause, withdrawal, cancellation, material delivery-exception and completion events written to the approved clinical record service;
- retention, deletion, legal hold, audit access and patient-access/correction processes;
- how corrected/deceased/contact-changed patient states stop future messages.

### 8.5 Delivery architecture

Use a transactional outbox with lease-fenced dispatch:

1. Activation writes plan, contacts, message snapshots and audit event atomically.
2. The dispatcher claims due contacts with a lease and unique provider idempotency key.
3. The provider adapter sends only the approved snapshot.
4. A signature-verified, replay-protected webhook records transport events idempotently.
5. Timeout/retry logic cannot create a second send.
6. Pause/withdrawal/cancellation races are resolved against the lease before provider submission.
7. Every provider payload and log is minimised; secrets remain in the approved secret store.

Provider webhooks are the routine transport-status source. An outage, discrepancy or suspected incident initiates manual reconciliation against provider records; uncertain contacts are never resent automatically. The absence of scheduled daily reconciliation is an explicit residual risk and pilot approval item.

The adapter interface is implemented first with a deterministic fake provider. A real provider adapter, webhook endpoint, credentials or live call requires explicit provider approval and security/procurement evidence.

## 9. Governance decision register

These are not questions about the product model; they are launch gates whose answer must come from the named local owner.

| Decision                                                                             | Accountable owner                                  | Evidence required before pilot                                           | Safe default while unresolved                  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| Participating hospital/service and cohort eligibility                                | Service clinical governance                        | Approved protocol and inclusion/exclusion rules                          | Synthetic-only design/build                    |
| Whether verbal caring-contact agreement is consent, communication preference or both | Clinical governance + legal/privacy                | Approved wording and documentation procedure                             | Label `Agreement confirmed`; no real enrolment |
| Patient identity/mobile source of truth                                              | Health information/integration owner               | Interface contract and correction workflow                               | Fictional directory only                       |
| Clinical-record write-back                                                           | Records owner + service                            | Approved event set and filing responsibility                             | Downloadable fictional summary only            |
| One-way inbound-reply handling                                                       | Clinical governance + lived-experience + SMS owner | Approved non-receiving sender, no-reply wording and support route        | Fake provider; no inbound UI                   |
| Exact pathway cadence and contact windows                                            | Service governance                                 | Versioned pathway using discharge anchor and 10:00/14:00/17:00 AWST      | Illustrative twelve-month pathway label        |
| Message library and prohibited content                                               | Clinical governance + lived-experience             | Approved variants and revision owner                                     | Fictional governed variants                    |
| Team membership and role model                                                       | Service + identity/security owner                  | Role matrix, joiner/mover/leaver process                                 | Local synthetic roles                          |
| Hosting, residency, privacy notices and breach response                              | Privacy + security + legal                         | Australian-only data flow, tenant-key, PIA, contracts and incident proof | No PHI deployment                              |
| SMS provider and delivery-status semantics                                           | Procurement + security + service owner             | Contract, data-flow review, status mapping and cost approval             | Provider-neutral fake                          |
| Reporting and small-cell suppression                                                 | Governance + analytics owner                       | Imported-field dictionary, configured threshold and access rules         | Operational fixture aggregates only            |
| Pilot evaluation                                                                     | Clinical governance + evaluation/lived-experience  | Operational-safety/acceptability protocol and independent feedback route | No effectiveness claims                        |

## 10. Reusable component plan

### 10.1 New domain components

Create domain components under `src/components/caring-contacts/`; promote only genuinely general patterns to `src/components/ui/` through the design-system authoring contract.

- `caring-contact-shell.tsx` — desktop rail, tablet collapsed rail, phone header/bottom navigation and active-team context.
- `clinical-context-switcher.tsx` — active hospital/service/team, with context-clear behaviour.
- `patient-identity-header.tsx` — minimum identifiers, source-state and change action; do not claim patient verification beyond imported evidence.
- `identity-assurance-checklist.tsx` — deliberate identity confirmation.
- `communication-eligibility-panel.tsx` — mobile, agreement and optional preferences.
- `plan-summary.tsx` — lifecycle, team, coordinator, pathway and next contact.
- `continuity-thread.tsx` — schedule geometry plus accessible ordered-list fallback.
- `activation-stepper.tsx` — four-stage journey with current/completed/error semantics.
- `approved-pathway-card.tsx` and `pathway-selector.tsx`.
- `message-variant-selector.tsx`.
- `sms-preview.tsx` and `sms-segment-count.tsx`.
- `one-way-boundary-notice.tsx`.
- `review-summary.tsx`.
- `plan-state-chip.tsx` and `contact-state-chip.tsx` with closed vocabularies.
- `action-required-row.tsx` and compact card treatment.
- `team-schedule-row.tsx` and labelled compact card.
- `delivery-history.tsx` and `audit-event-list.tsx`.
- `coordinator-selector.tsx`.
- `programme-metric.tsx` for quiet aggregates only; no clinician ranking.

### 10.2 Approved composition contracts

- `caring-contact-shell.tsx` exposes all five desktop areas. Compact navigation contains Today, Patients, Schedule and More; the More sheet contains Templates, Team, Guidance and Reports.
- Today uses the guided command-centre composition: referral command, separate action and sending-window panels, recent team activity, then quiet metrics.
- Activation uses a wide split between the current decision and live patient-visible preview. Compact mode keeps identity in flow and opens the preview in a labelled sheet.
- `continuity-thread.tsx` uses close early nodes that widen across the year; a complete chronological list immediately follows and remains the accessible source of truth.
- Schedule defaults to one day with a seven-day strip. Named exceptions remain visually separate from routine morning, afternoon and early-evening lists.
- Patient results use identity-forward rows, not a dense table or card grid. Selection always leads to a distinct identity-assurance step.
- Delivery exception inspection uses a right drawer on wide layouts and full-screen sheet on compact layouts.
- Final activation uses sectioned assurance review and places fresh-authentication activation after the entire review content.

### 10.3 Component-state specimen requirements

Each new component specimen covers:

- default, hover, active, focus-visible, disabled, busy and invalid where operable;
- loading, empty, no-results, offline, partial-data and recoverable-error states;
- long patient names, long service names, 200% text and narrow 320px width;
- dark, forced-colour and reduced-motion modes;
- full keyboard path and screen-reader name/role/state;
- print applicability explicitly stated;
- fictional data only.

## 11. Responsive behaviour

### 11.1 Widths to design and verify

Design explicitly at 320, 390, 430, 768, 1024 and 1440 CSS pixels. Verify 400% zoom at 1280px as equivalent narrow reflow.

### 11.2 Shell behaviour

- **320–430 compact:** repository-native phone header, four-item bottom navigation, no persistent side rail. Today begins with `Referrals to review`; Templates, Team, Guidance and Reports live in the More sheet. Identity and current activation stage remain visible in flow without becoming a second fixed header.
- **768 rail:** collapsed desktop navigation and supporting rail. This is not an enlarged phone layout.
- **1024 split:** list/detail and workflow/preview pairs appear when both panes preserve minimum viable widths.
- **1440 wide:** persistent navigation and context with comparison-friendly plan/schedule layouts.

### 11.3 Overlay behaviour

- Short reversible decisions: centred desktop dialog, bottom phone sheet.
- Inspection: desktop right drawer, phone dedicated screen or full-height sheet.
- Identity, withdrawal, activation and conflict resolution: dedicated full-screen stage on phone.
- Sticky actions never cover validation, identity, banners, keyboard focus or safe-area navigation.

### 11.4 Continuity thread

- Visual nodes show spacing over time, not clinical importance.
- Early nodes are close together and later nodes widen across the twelve-month cadence; this geometry never changes for patient, delivery or clinical state.
- The accessible name is `Caring-contact schedule` and the DOM contains a complete ordered list of dates/messages.
- Compact mode may present a short horizontal overview, but the complete vertical list follows and cannot omit dates or transport-state labels.
- Forced colours use system strokes and text; reduced motion removes path-drawing animation.
- Print shows the exact date list; the decorative line is optional.

## 12. Screen-generation sequence

Follow this exact order so the shell and product signature stabilise before edge pages multiply:

1. Foundation board: tokens, type, iconography, status vocabularies, controls, responsive shell and continuity thread.
2. Today — desktop, phone, tablet risk check.
3. Patient and agreement — desktop and phone.
4. Pathway selection — desktop and phone.
5. Personalisation with exact SMS preview — desktop and phone.
6. Review and activation — desktop and phone.
7. Patient overview — desktop and phone.
8. Schedule — desktop and phone.
9. Patient boundary and exception screens.
10. Template/pathway library and version states.
11. Delivery exception and resolution.
12. Team context, reassignment and handover.
13. Guidance, help and authorised reporting.
14. All 24 overlays/states.
15. Complete component specimens.
16. Dark, forced-colour, reduced-motion and 320px review boards.

## 13. Delivery programme

### Phase 1 — repository grounding

**Deliverable:** approved evidence-backed repository audit and design direction. No application code.

**Files**

- Create: `docs/superpowers/specs/2026-08-14-caring-contact-coordination-design.md` — binding product/design specification.
- Create: `docs/caring-contacts/repository-design-audit.md` — source, route, component and rendered-evidence map.
- Create: `docs/caring-contacts/clinical-boundaries.md` — exact claims, prohibited language and service boundary.
- Create: `docs/caring-contacts/governance-decisions.md` — decision register with owners/evidence/status.

**Steps**

- [ ] Re-verify `origin/main`, the design-system source ranking and canonical visual provenance at execution time.
- [ ] Record the three approaches in §4 and retain Approach B unless repository or governance evidence materially changes.
- [ ] Trace every proposed component to a current primitive, a new domain component or a justified future design-system promotion.
- [ ] Map every confirmed product decision to a screen, component, state or governance rule.
- [ ] Review the design spec for placeholders, contradictions, reply/inbox drift, risk-language drift and PHI leakage.
- [ ] Run `npm run format:check -- docs/superpowers/specs/2026-08-14-caring-contact-coordination-design.md docs/caring-contacts/*.md`; expect Prettier success.
- [ ] Run `npm run docs:check-links`; expect no broken local or external documentation link.
- [ ] Present the written spec for explicit approval before mockups.

**Exit gate:** product owner approves the repository-native direction; clinical/governance owners accept the boundary language as suitable for design exploration, not clinical approval.

### Phase 2 — concept foundation

**Deliverable:** responsive mockup foundation, complete IA and the continuity-thread signature.

**Files**

- Create: `src/app/mockups/caring-contacts/page.tsx` — noindexed visual-suite entry.
- Create: `src/components/caring-contacts/mockups/foundation-board.tsx`.
- Create: `src/components/caring-contacts/mockups/caring-contact-shell-frame.tsx`.
- Create: `src/components/caring-contacts/mockups/continuity-thread-specimen.tsx`.
- Create: `src/components/caring-contacts/mockups/fixtures.ts` — obviously fictional patients, teams, pathways and events.
- Create: `tests/caring-contact-mockups.dom.test.tsx`.
- Create: `tests/ui-caring-contact-mockups.spec.ts`.
- Modify: `package.json` — add repository-wrapped focused mockup verification script.

**Interfaces**

- `MockPatient`, `MockTeam`, `MockPathway`, `MockPlan`, `MockContact` live only in mockup fixtures and cannot be imported by production code.
- `ContinuityThreadSpecimen` consumes ordered ISO date strings and labels; geometry never consumes risk or engagement values.

**Steps**

- [ ] Write DOM tests for one `<h1>`, five desktop destinations, the four-item compact dock plus More-sheet destinations, no inbox/conversation label, exact one-way notice, widening thread geometry inputs and a complete accessible schedule list.
- [ ] Run the focused DOM test and confirm the new assertions fail before the mockup exists.
- [ ] Build the shell frames at 320, 390, 430, 768, 1024 and 1440 using v2 tokens and registered primitives.
- [ ] Build light/dark, forced-colour and reduced-motion continuity-thread specimens.
- [ ] Run the focused DOM test and expect all assertions to pass.
- [ ] Run the new repository-wrapped Playwright mockup script; expect every viewport to avoid horizontal overflow, clipped focus and covered sticky actions.
- [ ] Run `npm run check:design-system-contract`; expect no new production token violation.
- [ ] Run `npm run format`; inspect and retain only intended changes.
- [ ] Present the foundation board and shell for approval before producing the core suite.

**Exit gate:** approved shell, continuity thread, status language and responsive model.

### Phase 3 — core visual suite

**Deliverable:** complete desktop and phone designs for Today, the four activation stages, patient overview and schedule.

**Files**

- Create: `src/components/caring-contacts/mockups/today-screen.tsx`.
- Create: `src/components/caring-contacts/mockups/patient-agreement-screen.tsx`.
- Create: `src/components/caring-contacts/mockups/pathway-selection-screen.tsx`.
- Create: `src/components/caring-contacts/mockups/personalisation-screen.tsx`.
- Create: `src/components/caring-contacts/mockups/review-activation-screen.tsx`.
- Create: `src/components/caring-contacts/mockups/patient-overview-screen.tsx`.
- Create: `src/components/caring-contacts/mockups/schedule-screen.tsx`.
- Modify: `tests/caring-contact-mockups.dom.test.tsx`.
- Modify: `tests/ui-caring-contact-mockups.spec.ts`.

**Steps**

- [ ] Add failing assertions for exact screen inventory, `Referrals to review` dominance, identity-forward results, patient-identity repetition, imported agreement, owning team, coordinator, exact 10:00/14:00/17:00 schedule, two-segment SMS preview and one-way boundary.
- [ ] Implement each screen in the sequence from §12 using the eight approved composition contracts in §10.2 at compact and wide widths.
- [ ] Verify tablet treatment for patient selection, personalisation and schedule rather than assuming interpolation.
- [ ] Exercise every interactive mockup control; no enabled inert button is permitted even in mockups.
- [ ] Verify keyboard order, focus return, 200% text, reduced motion and forced colours.
- [ ] Run focused DOM and Playwright mockup scripts; expect all cases to pass.
- [ ] Run `npm run build` only if the focused mockup route changes bundle composition enough to warrant bundle-budget evidence; remove stale `.next` first as required by the repository contract.
- [ ] Hold a design approval checkpoint before completion screens.

**Exit gate:** the complete core journey is visually approved at desktop, tablet and phone widths.

### Phase 4 — completion suite

**Deliverable:** every remaining page, overlay, state and component specimen.

**Files**

- Create focused mockup modules under `src/components/caring-contacts/mockups/` for patient boundaries, plan/contact detail, templates, delivery exceptions, team, guidance, reports, overlays and component specimens.
- Modify: `src/app/mockups/caring-contacts/page.tsx` — expose a navigable suite index.
- Modify: focused DOM and Playwright mockup tests.

**Steps**

- [ ] Add every item in §§5.2–5.3 to the suite inventory and test the inventory count.
- [ ] Add loading, empty, no-results, offline, session-expiry, partial-data, permission and recoverable-error states.
- [ ] Add template-changed, draft-conflict, processing-too-late, contact-changed, withdrawal, readmission, death-event, corrected-death incident and reassignment states.
- [ ] Prove dialog/drawer/bottom-sheet selection at compact and wide widths.
- [ ] Prove no patient detail appears in toast specimens or page titles.
- [ ] Complete component specimens with default/hover/active/focus/disabled/busy/invalid states.
- [ ] Run focused DOM and browser suites, then `npm run verify:ui` because the completed visual suite spans all responsive/accessibility concerns.
- [ ] Record physical iPhone Safari and installed-PWA review as a separate acceptance item; Chromium cannot close it.

**Exit gate:** no missing page, overlay, state or responsive treatment remains.

### Phase 5 — meticulous design and clinical review

**Deliverable:** approved developer handoff; still no patient-data production implementation.

**Files**

- Create: `docs/caring-contacts/design-handoff.md` — screen-to-route/component/state mapping.
- Create: `docs/caring-contacts/content-style-guide.md` — exact labels, prohibited copy and message-governance rules.
- Create: `docs/caring-contacts/accessibility-acceptance.md`.
- Create: `docs/caring-contacts/clinical-language-review.md`.

**Steps**

- [ ] Review every screen against `docs/design-system/` and record justified domain-specific exceptions.
- [ ] Scan visible copy for risk prediction, false reassurance, clinical-outcome inference, reply invitation and caring-contact/follow-up confusion.
- [ ] Trace identity, agreement, activation, pause, withdrawal, failed delivery and team handover end to end.
- [ ] Verify continuity across all six target widths and every overlay transition.
- [ ] Complete keyboard, screen-reader, reflow, dark, forced-colour and reduced-motion reviews.
- [ ] Obtain lived-experience approval of message content and again of the complete visual prototype; either gate may block progression.
- [ ] Obtain product, service-clinical, privacy/security and accessibility design sign-off with limitations recorded.
- [ ] Freeze the approved screen/state inventory; later visual changes require a documented decision rather than silent drift.

**Exit gate:** explicit approval to begin production implementation planning.

### Phase 6 — secure domain and datastore foundation

**Deliverable:** independently testable local domain model and approved datastore contract. No SMS provider.

**Files**

- Create: `src/lib/caring-contacts/model.ts`.
- Create: `src/lib/caring-contacts/schedule.ts`.
- Create: `src/lib/caring-contacts/message-policy.ts`.
- Create: `src/lib/caring-contacts/permissions.ts`.
- Create: `src/lib/caring-contacts/audit.ts`.
- Create: `src/lib/caring-contacts/repository.ts`.
- Create: `supabase/migrations/20260814000000_caring_contacts_foundation.sql` only if Supabase is approved for this boundary; otherwise create the equivalent migration in the selected datastore's native location.
- Regenerate: `src/lib/supabase/database.types.ts` only after the approved local migration workflow.
- Create focused model, schedule, policy, permission, audit and migration tests under `tests/`.

**Interfaces**

- Closed TypeScript unions mirror the plan, contact and template lifecycles in §7.
- `buildApprovedSchedule(pathwayVersion, dischargeAt, sendingPreference): ScheduleResult` is pure, discharge-anchored and deterministic; preferences map to 10:00, 14:00 or 17:00 AWST.
- `validateGovernedMessage(input): ValidationResult` returns exact blocking codes; it never calls a model/provider.
- `applyHospitalStatusEvent(plan, event): PlanTransition` pauses on readmission and irreversibly cancels on death.
- `canPerformCaringContactAction(actor, action, resource): boolean` is deny-by-default and team-aware.
- Repository writes accept an idempotency key and actor/team context; audit creation occurs in the same transaction.

**Steps**

- [ ] Write failing referral, lifecycle, readmission, death/correction, discharge-anchor, missed-window, weekend/public-holiday, timezone, leap-date, two-segment, prohibited-copy, permission and idempotency tests.
- [ ] Implement only the pure model/schedule/message-policy layer and make focused tests pass.
- [ ] Review the approved data classification, retention, RLS and audit design before adding schema.
- [ ] Add tables, checks, foreign keys, unique constraints, team-scoped RLS and transactional functions.
- [ ] Add migration tests proving anonymous denial, cross-team denial, role boundaries, atomic withdrawal and duplicate-activation prevention.
- [ ] Regenerate types and prove no manual drift.
- [ ] Run focused Vitest and migration checks, `npm run check:owner-scope`, `npm run check:production-readiness` and `npm run verify:pr-local`.
- [ ] Do not apply a hosted migration without explicit target authorisation.

**Exit gate:** security/privacy owners approve the datastore boundary; all local deterministic/RLS evidence passes.

### Phase 7 — production shell and read-only synthetic routes

**Deliverable:** repository-native production routes backed only by deterministic synthetic fixtures or the approved local repository abstraction.

**Files**

- Create: `src/app/(caring-contacts)/caring-contacts/layout.tsx`.
- Create the route files listed in §5.2 with page-specific `loading.tsx`, `error.tsx` and `not-found.tsx` only where the route owns those states.
- Create the domain components listed in §10 under `src/components/caring-contacts/`.
- Create: `src/lib/caring-contacts/fixtures.ts` for non-production synthetic mode, clearly separated from mockup fixtures.
- Modify: `src/lib/tools-catalog.ts` — one Coordination launcher entry.
- Modify: `docs/codebase-index.md`, generated site map/inventory and `tests/route-reachability.test.ts`.
- Create: `tests/ui-caring-contacts.spec.ts` and focused DOM tests.

**Steps**

- [ ] Read the repository-installed Next.js 16 route/layout/loading/error guidance before writing route code.
- [ ] Add failing reachability, shell-navigation, no-global-composer and route-access tests.
- [ ] Implement the dedicated shell and synthetic Today route first; prove compact/wide navigation.
- [ ] Add remaining read-only routes one coherent journey at a time.
- [ ] Ensure every patient API response and page is `no-store` and excluded from PWA caching.
- [ ] Verify context switching clears patient state and the browser back path returns to the correct workspace view.
- [ ] Run focused DOM tests and a repository-wrapped Playwright caring-contact journey.
- [ ] Run `npm run docs:update`, review generated diffs, then run `npm run verify:ui` and `npm run verify:pr-local` once for handoff.

**Exit gate:** the production route structure and responsive UI are complete with synthetic data, with no provider, hosted migration or real-patient path.

### Phase 8 — governed plan mutations

**Deliverable:** structured referral adapter, referral decisions, draft, activation, pause, withdrawal, reassignment and exception-resolution workflows against an approved non-production environment.

**Files**

- Create API routes under `src/app/api/caring-contacts/` for referrals, referral decisions, plans, contacts, templates, team context and reports.
- Create: `src/lib/caring-contacts/referral-source.ts` — hospital referral/write-back interface plus synthetic adapter; it never exposes a hospital-wide directory search.
- Create: `src/lib/caring-contacts/service.ts` — orchestration; route handlers stay thin.
- Create: `src/lib/caring-contacts/api-contracts.ts` — validated request/response schemas.
- Add focused API, auth, privacy, concurrency and DOM/e2e tests.

**Steps**

- [ ] Write failing API contract tests for auth expiry, conditional-access denial, referral accept/clarify/decline write-back, pending ownership, patient-controlled-source flag, duplicate active referral, fresh-auth activation, stale versions, concurrent pause/send, contact changes, readmission/death and redacted errors.
- [ ] Implement thin authenticated routes over the repository/service layer.
- [ ] Add the referral-source interface and synthetic adapter; keep a real PAS/EMR referral/write-back adapter approval-gated.
- [ ] Implement draft recovery and conflict handling without browser PHI persistence.
- [ ] Implement activation and management actions with object-specific confirmations and audit events.
- [ ] Prove no patient fields reach logs, analytics, URL query strings, RAG or OpenAI using static and request-level tests.
- [ ] Run focused tests, owner/team-scope checks, privacy checks, `npm run check:production-readiness` and `npm run verify:pr-local`.

**Exit gate:** approved test environment supports the full human workflow with synthetic/test patients and no external SMS.

### Phase 9 — delivery outbox and fake provider

**Deliverable:** idempotent scheduling/dispatch pipeline using a deterministic fake provider.

**Files**

- Create: `src/lib/caring-contacts/sms-provider.ts`.
- Create: `src/lib/caring-contacts/fake-sms-provider.ts`.
- Create: `caring-contact-worker/index.ts`, `caring-contact-worker/run-loop.ts`, `caring-contact-worker/dispatcher.ts` and `caring-contact-worker/types.ts` as a separate responsibility from the ingestion worker.
- Create: `src/app/api/webhooks/caring-contacts/delivery/route.ts` with provider-neutral contract tests.
- Add package scripts and worker/API tests through repository wrappers.

**Steps**

- [ ] Write failing tests for lease loss, duplicate claim, provider timeout, duplicate webhook, out-of-order status, pause/withdrawal race, too-late cancellation and redacted logging.
- [ ] Implement lease-fenced claiming and fake-provider sending.
- [ ] Implement signed/replay-safe webhook infrastructure against fake signatures.
- [ ] Run a deterministic accelerated twelve-month simulation and prove exact counts, order and no duplicates.
- [ ] Prove worker shutdown drains claimed work safely and leaves reclaimable leases.
- [ ] Run focused worker/API tests and `npm run verify:pr-local`.

**Exit gate:** local delivery simulation is deterministic, idempotent and privacy-safe.

### Phase 10 — approved SMS adapter and non-production end-to-end acceptance

**Deliverable:** one approved provider adapter in a named non-production account.

**Prerequisite:** explicit user authorisation for the provider, target, data exposure and likely cost.

**Steps**

- [ ] Record the Australian-only provider data flow, tenant-scoped key evidence, discreet sender identity, non-receiving capability, status semantics, rate limits, cost controls and key/secret rotation.
- [ ] Implement the adapter behind the provider-neutral interface without changing domain logic.
- [ ] Verify webhook signatures, replay prevention, status mapping and redacted observability.
- [ ] Run canaries only with approved synthetic/test numbers and an explicit send budget.
- [ ] Prove the selected sender cannot receive replies and that no inbound payload, route, log or user interface exists in Caring Contacts.
- [ ] Test webhook-primary status handling plus manual reconciliation after simulated outage, discrepancy and suspected incident; prove uncertain contacts are never resent automatically.
- [ ] Complete `npm run check:production-readiness`, local release checks and the clinical-governance PR preflight.
- [ ] Record hosted evidence separately from local evidence.

**Exit gate:** service, privacy, security and procurement owners accept the non-production end-to-end evidence.

### Phase 11 — limited clinical pilot

**Deliverable:** an explicitly authorised single-team pilot with real patients under a written protocol, no numeric enrolment cap and strict automatic stopping rules.

**Steps**

- [ ] Approve the single hospital/service, dedicated aftercare team, 9:00 am–6:00 pm seven-day staffing, enrolment script, imported agreement evidence, 10:00/14:00/17:00 windows, pathway version, message variants, non-receiving sender, structured record write-back, no-cap exposure, monitoring and stopping rules.
- [ ] Require assessed synthetic simulation before production access, covering referral handover, source identity, activation, withdrawal, contact change, failed delivery, readmission, death, downtime and incident handling.
- [ ] Perform accessibility acceptance with clinicians using ward desktops and supported phones, including physical iPhone Safari/PWA boundaries where applicable.
- [ ] Open enrolment to every objectively eligible referral from the one pilot team; monitor queue age and workload continuously because there is no numeric patient cap.
- [ ] Monitor duplicate sends, schedule drift, delivery exceptions, unresolved exceptions, withdrawals processed, access anomalies and privacy/security incidents.
- [ ] Run the separately consented patient-acceptability evaluation outside Caring Contacts and review aggregate lived-experience findings on tone, timing, sender identity and the one-way boundary.
- [ ] Run two weeks of seven-day hypercare with named clinical, service, technical, privacy and incident leads plus daily Caring Contacts queue/state review; provider-side reconciliation remains event-triggered.
- [ ] Trigger an immediate service-wide pause for any confirmed wrong-recipient send, duplicate send, unauthorised content, material privacy/security incident or loss of audit integrity.
- [ ] Permit restart only after joint incident-lead, privacy/security and clinical-programme approval.
- [ ] Hold the first governance review at 6–8 weeks; permit only a controlled extension, then require longer-term pathway evidence before broad rollout.

**Exit gate:** governance board accepts pilot evidence and explicitly authorises expansion.

### Phase 12 — controlled expansion

**Deliverable:** staged scale-out by team/site with maintained governance.

**Steps**

- [ ] Expand one team/site at a time with joiner/mover/leaver checks and pathway ownership.
- [ ] Re-approve message/pathway versions before each material cohort change.
- [ ] Keep operational reporting aggregate and privacy-conscious; suppress small cells and never rank clinicians.
- [ ] Rehearse rollback, provider outage, compromised credential, incorrect template and duplicate-send incident paths.
- [ ] Schedule periodic access, retention, audit, pathway, message, provider and lived-experience reviews.
- [ ] Treat broader mental-health discharge cohorts and two-way messaging as separate governed products with new design, hazard, privacy and operational plans.

## 14. Verification ladder

### Design/documentation tranches

- `npm run format:check`
- `npm run docs:check-links`
- `npm run docs:check-scripts`
- Focused mockup DOM tests
- Repository-wrapped mockup Playwright at all required widths
- `npm run check:design-system-contract`

### Domain/data tranches

- Focused pure-function tests for state, schedule, content and permissions
- Migration/RLS/transaction tests
- `npm run check:owner-scope` plus new team-scope proof
- `npm run check:production-readiness`
- `npm run verify:pr-local`

### UI and workflow tranches

- Focused DOM journey
- Repository-wrapped caring-contact Playwright journey
- 320/390/430/768/1024/1440, 400% zoom, dark, forced colours and reduced motion
- `npm run verify:ui` once for a complete UI handoff
- Physical Safari/PWA acceptance recorded separately

### Provider and release tranches

- Fake-provider deterministic simulation first
- Named non-production provider canary only after explicit approval
- Hosted database/provider evidence kept separate from local evidence
- `npm run verify:release` only for an explicitly authorised release-confidence run
- Clinical governance preflight, PIA/security/records evidence and rollback rehearsal

Do not stack broad gates after focused proof unless the broader gate catches a distinct plausible failure class.

## 15. Acceptance criteria

### Product and clinical boundary

- No reply/inbox/conversation surface exists.
- No risk score, prediction, urgency detection or clinical advice exists.
- Every caring contact is visibly supplemental to usual care.
- Delivery states never imply safety, wellbeing or engagement.
- Every plan shows owning team, coordinator, agreement and approved pathway/version.

### Workflow

- Source identity review and deliberate referral selection precede enrolment; the UI does not overstate the imported mobile number as directly re-verified.
- Missing agreement, patient-controlled-mobile flag, team or coordinator blocks activation with a named remedy.
- Final activation shows exact patient, messages, dates, 10:00/14:00/17:00 send times, AWST timezone, two-segment evidence and one-way boundary.
- Pause, withdrawal, cancellation, reassignment and contact change are distinct and audited.
- Retries and concurrency cannot duplicate a plan or message.

### Privacy and security

- No patient data reaches Clinical KB search/RAG/OpenAI or browser-local persistence.
- Team-scoped deny-by-default access is proven.
- WA Health SSO/MFA, conditional access and managed-session controls are proven across supported personal and managed devices.
- Patient data is absent from logs, URLs, analytics, toasts and screenshots.
- Patient data, backups, logs and provider processing remain in Australia under dedicated tenant-scoped vendor-managed keys.
- Retention, record-of-truth, breach and correction processes are approved before pilot.
- Provider secrets, payloads, webhooks and costs are governed.

### Design and accessibility

- The workspace visibly belongs to the current v2 Clinical KB system.
- One dominant action per region; no card soup, glassmorphism, marketing gradient or decorative clinical-state colour.
- Every production control is wired or explicitly unavailable with a stated reason.
- Complete keyboard, screen-reader, 320px, 400% zoom, dark, forced-colour and reduced-motion behaviour is proven.
- The continuity thread has a complete text/list equivalent and never carries risk meaning.
- The eight approved composition contracts in §10.2 are proven at desktop and compact widths.

### Operations and rollout

- Exact duplicate-send count remains zero in simulation and pilot.
- Delivery exception ownership and resolution age are visible without clinician ranking.
- Provider outage and rollback do not lose plan/audit state or silently send late messages.
- Downtime fails closed without offline patient caching, new activation or uncertain sending.
- The no-cap pilot exposes queue age and workload continuously and pauses automatically on the defined safety-stop events.
- Pilot limitations and stopping rules are documented; no production-readiness or clinical-effectiveness claim exceeds the evidence.

## 16. Metrics that are safe to use

Operational metrics may include:

- plans awaiting activation;
- agreement/contact-detail completeness;
- contacts due, dispatched and delayed;
- exact delivery exceptions by approved transport code;
- time to resolve operational exceptions;
- pauses, withdrawals and cancellations processed;
- duplicate sends and schedule drift;
- template/pathway versions in use;
- approved demographic breakdowns sourced from clinical systems, with governance-configured small-cell suppression;
- access, security and privacy incidents.

Do not infer or display patient safety, suicide risk, wellbeing, engagement, therapeutic response or clinician performance from these measures. Any clinical-effectiveness evaluation requires a separate protocol, governance review and statistical plan.

## 17. Rollback model

- **Design rollback:** retain the approved design spec and revert only the unapproved screen tranche.
- **Feature rollback:** disable the caring-contact launcher and route boundary without changing historical plan/audit data.
- **Delivery rollback:** stop new claims, drain or release existing leases, preserve exact status, and require explicit operator review before resumption.
- **Template rollback:** retire a faulty version; never mutate sent/history snapshots; pause affected future contacts according to the approved policy.
- **Provider rollback:** switch only through the provider interface after reconciliation; never resend uncertain contacts automatically.
- **Pilot rollback:** automatically pause all future contacts for a defined safety-stop event, notify named incident owners through the approved operational channel, preserve records, reconcile provider state and require joint incident/privacy/clinical approval before resumption.

## 18. Final handoff package

The programme is ready for implementation handoff only when it contains:

1. Approved repository-grounded design spec.
2. Complete screen/overlay/state inventory and visual suite.
3. Route/component/data/interface map.
4. Clinical-boundary and content-governance specification.
5. PIA, security, records, hosting, identity and team-tenancy decisions.
6. Approved pathway/message versions and inbound-channel policy.
7. Local deterministic, RLS, UI, accessibility and delivery-simulation evidence.
8. Separate hosted/provider evidence where explicitly authorised.
9. Pilot protocol, training, monitoring, stopping and rollback rules.
10. Honest residual-risk list and named owners.

This plan does not claim clinical approval, production readiness, WA Health endorsement, provider acceptance, deployment or migration status.
