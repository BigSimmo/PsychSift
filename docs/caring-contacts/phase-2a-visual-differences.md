# Caring Contacts Phase 2A — visual differences against the mockup atlas

Recorded by Task 19, the closing task of Phase 2A. This is the "non-regression" step of the
plan: capture the production surface, compare it against the committed mockup baseline in
`docs/caring-contacts/atlas/`, and justify every difference — or fix it.

Comparison is manual. Nothing in the repository diffs these images automatically, and the only
automated assertions anywhere are the atlas image count and the recorded dimensions.

## Read this first: 26 of the 44 atlas images have no production counterpart

**This is not a 44-image comparison, and no part of this document should be read as one.**

Phase 2A builds exactly one production screen — `/caring-contacts` (Today) — plus the
twenty-four workspace overlays. The remaining thirteen screens in the atlas belong to Plan 2B
and do not exist yet, so there is nothing on the production side to compare them against.

| Atlas images                                    | Count | Compared?                                      |
| ----------------------------------------------- | ----- | ---------------------------------------------- |
| `phone-01-today` / `desktop-01-today`           | 2     | Yes                                            |
| The eight overlay captures, phone and desktop   | 16    | Yes                                            |
| `02-patients` … `14-reports`, phone and desktop | 26    | **No — the screen does not exist in Phase 2A** |
| **Total**                                       | 44    | 18 compared, 26 with no counterpart            |

The 26 with no counterpart are, at both 390 and 1440: `02-patients`, `03-patient-overview`,
`04-patient-agreement`, `05-pathway-selection`, `06-personalisation`, `07-review-activation`,
`08-plan-detail`, `09-schedule`, `10-delivery-exception`, `11-templates`, `12-team`,
`13-guidance`, `14-reports`. Each is a `/mockups/caring-contacts/**` route with no production
equivalent. They are recorded as outstanding work rather than as differences.

### How the production side was captured

A temporary Playwright capture (not committed — it would be a screenshot suite nothing
maintains) drove the production routes in the isolated production server at the atlas's own two
device sizes, phone 390×844 and desktop 1440×1000, and wrote 18 images plus a manifest to
`.local/caring-contacts-production-atlas/`. Targets matched the atlas capture: the `<main>`
element for the Today screen, the overlay panel for a Sheet-borne overlay, and the banner
element for the offline notice.

One capture difference worth stating so a future reader is not misled: the atlas capture hides
the fixed phone dock with an injected style before shooting, and this capture did not. The
production phone Today image therefore shows the dock painted across the middle of a
full-page-height screenshot. That is an artefact of the capture, not a layout defect — dock
clearance at all six widths, including for the last control in the flow, is asserted in
`tests/ui-caring-contacts-workspace.spec.ts`.

## The five differences the plan already expected

These were listed in the Task 19 brief as known and expected before any capture was taken.

1. **The first-contact-date control on review and activation.** Spec §2.3 records that the
   mockup is out of date on that screen. Not observable in this comparison: both
   `07-review-activation` images are Plan 2B screens with no production counterpart.
2. **Reply-handling copy.** The mockup states that replies "are not received, stored, analysed
   or monitored" (visible in `desktop-overlay-message-preview`); spec §2.1 replaces that with
   copy describing the automated response. Not observable here either — production's overlay
   bodies carry only the frozen table's `summary`, and the reply copy belongs to the message
   detail surfaces in Plan 2B.
3. **The month-12 contact as a distinct `closing` message type** (spec §2.2). Not observable:
   the schedule and message screens are Plan 2B.
4. **Nine sendable contacts, not ten**, when the coordinator sets the first contact to discharge
   plus seven days (Phase 1 decision 1). Not observable: the schedule screen is Plan 2B.
5. **Genuine `rail` and `split` compositions at 768 and 1024**, which the mockup never had. Not
   visible in this comparison because the atlas samples only 390 and 1440, but it is proved
   directly in the browser at all six widths by `tests/ui-caring-contacts-workspace.spec.ts`.

Four of the five are therefore accounted for but not yet demonstrable, because the screens that
would show them are Plan 2B. That is worth saying plainly rather than ticking them off.

## The differences actually observed on the screens that do exist

Each one is justified below. Nothing in this section is an unexplained difference, and nothing
was found that needed fixing.

### D1 — The Today screen's body is a statement of intent, not the dashboard

`phone-01-today`: mockup 390×2837 → production 390×1203. `desktop-01-today`: mockup 1360×1208 →
production 1184×721.

The mockup's Today screen is a full operational dashboard: a "Referrals to review" queue with a
named patient card, a "Needs action" list, a "Sending today" panel broken into morning,
afternoon and early-evening windows, a "Recent activity" feed, and three summary counts.
Production's Today screen carries the shell, the page heading and description, the "New plan"
control as an unavailable destination, a short "What this screen will show" paragraph, and the
More destinations panel.

**Justified.** This is the largest single difference and it is the declared shape of Phase 2A.
The plan's own self-review states it twice: every screen other than Today belongs to Plan 2B,
and the seven required screens of spec §4.2 have their rules and data landed in Tasks 3–11
while "their surfaces are Plan 2B". Today's dashboard content is composed of exactly those
surfaces — the referral queue, the sending windows, the activity feed — so it lands with them.
Ruling 52 governs the rest of what is on screen: a destination that has no page renders as an
unavailable control stating what it will hold, never as a link into a not-found page, which is
why the More destinations panel reads as a list of promises.

### D2 — Overlay copy is the frozen matrix's plain Australian English, not the mockup's

`desktop-overlay-message-preview`, and every other overlay pair. The mockup reads "Preview exact
patient-visible message / The fully substituted message is visible exactly as the patient would
receive it."; production reads "Preview the message the patient would see / The wording is shown
exactly as it would arrive, with every detail already filled in." The session gate reads
"Session expired / The managed session ended before a protected decision could complete." in the
mockup and "The session has expired / The session ended before this could finish, so nothing was
changed. Sign in again to carry on." in production.

**Justified.** `docs/caring-contacts/interaction-matrix.md` is the frozen record for these
twenty-four rows, and Task 17 transcribed it into
`src/components/caring-contacts/workspace/overlays/definitions.ts` with the clinical-language
rules applied: plain Australian English, sentence case, no clinical inference, no claim that
anybody is reading replies. The mockup predates that record. Where the two disagree, the matrix
wins by construction — `tests/caring-contacts-overlay-definitions.test.ts` parses the matrix
document and checks the table against it row for row, so the production copy cannot drift from
the frozen record even by accident.

### D3 — Every overlay renders one body, so the mockup's per-overlay content is absent

The mockup overlays carry an "Availability: …" line with a warning glyph, overlay-specific facts
(for the message preview: "GSM-7 · 272 septets · 2 of 2 SMS segments"), and a boxed
"Privacy-safe outcome only …" note. Production renders the frozen `summary`, an optional fresh
authentication checkpoint, an optional refusal reason, and the single `decision` control.

**Justified.** Rule 1 of the Task 18 contract is that there is ONE renderer for all twenty-four
overlays and no switch on an overlay id anywhere in it. That is what makes the twenty-four rows
data rather than code, and it is what lets Task 19 prove all of them in a browser against the
same table the renderer reads. Per-overlay content is screen-level and arrives with the screens
that raise these overlays, in Plan 2B. `availability` and `mutatesState` are already carried in
the frozen table and already drive behaviour (a blocked mutating overlay shows its refusal in
plain words); they are simply not yet drawn as a labelled line.

### D4 — The decision control sits inline in the body, not in a dark footer button

The mockup puts the primary action in a Sheet footer as a filled dark button ("Return to
personalisation", "Sign in again"). Production puts it inline at the end of the body, styled by
the frozen row's `tone` — `primary`, `danger`, or the neutral floating control when a row
declares no tone.

**Justified.** Same cause as D3: one renderer, and the row's `tone` is the only per-overlay
styling input the frozen table provides. Choosing a footer would require the renderer to decide
per overlay which action is the "primary" one, which is exactly the per-id branching Rule 1
forbids.

### D5 — The desktop session gate is a full-width letterbox, not a centred dialog

`desktop-overlay-session-expiry`: mockup 512×382 → production 1392×170.

**Justified, and flagged.** The frozen matrix gives `session-expiry` the desktop modality
`session-gate`, not `dialog`; the mockup drew it as a dialog because it predates the matrix.
Task 18's renderer maps `session-gate` onto the shared `Sheet` with fullscreen mobile placement,
which above the design system's `lg:` breakpoint resolves to an auto-height panel with no
maximum width — hence 1392 wide and 170 tall at 1440. The behaviour the contract cares about is
correct and proved: the gate survives Escape, offers only its recovery action, renders no close
control, and is a modal dialog.

It is still worth the owner's eye. A 1392×170 letterbox reads as a notification bar rather than
as something blocking work, which is the opposite of what a session gate is for. Changing it
means changing either the frozen matrix row or the shared `Sheet` — both owned outside this
task — so it is recorded here as a design-record question rather than altered.

### D6 — The offline notice spans the full viewport width

`desktop-overlay-offline`: mockup 717×149 → production 1440×169. Phone is unchanged at 390 wide
(mockup 167 tall, production 169).

**Justified.** Rule 4 of the Task 18 contract: `status-banner` is not a dialog. It portals to
the document body as a live region, takes no focus, traps none, and offers its recovery action
in place. It is `fixed inset-x-0 bottom-0` by design, so full-bleed is the intended geometry.
The mockup's narrower banner sat inside a content column.

### D7 — Overlay panel geometry is otherwise identical

`pathway-preview`, `message-preview` and `delivery-exception` measure 512×1000 on desktop in both
the mockup and production — the same right-anchored inspection drawer. All eight phone overlays
measure 390×844 in both. `final-activation`, `withdrawal` and `version-conflict` are 512 wide in
both, shorter in production (243 vs 406) purely because they carry less body content (D3).

**No difference to justify.** This is the part of the atlas comparison that genuinely
demonstrates non-regression: where the mockup and production draw the same thing, they draw it
at the same size and in the same place.

## Nothing was fixed as a result of this comparison

Every observed difference on a screen that exists is accounted for by a frozen contract, a
recorded ruling, or the declared scope of Phase 2A. No unexplained difference was found, so no
production change was made under this step.

## Outstanding

The 26 uncompared atlas images are the visual specification for Plan 2B. Recorded in the
outstanding-issues ledger as "Caring Contacts Phase 2B — the screens".
