# Caring Contacts — copy review

## Before you start

This is every word a human being can currently read anywhere in the Caring Contacts
workspace, gathered in one place so you can mark it up. It is the last checkpoint before
Phase 2B builds on this wording.

There are **189 distinct pieces of wording**: **8 a patient could read**, and **181 only a
clinician using the workspace ever sees**. Everything is quoted exactly as written — I have
not paraphrased anything, because the words themselves are what you are reviewing.

Please look hardest at these, in this order:

1. **Part 1 — the three messages a patient receives.** Two of them make firm promises about
   what happens to a reply. One of them names a crisis line as "Fictional".
2. **Part 2 — the wording shown when all sending has been stopped.** This appears on every
   screen, to every team, during an incident.
3. **Part 7 — the ten pieces of wording I think are risky or misleading as written.**

Everything else (Parts 3 and 4) is ordinary screen furniture. Skim it.

All patients, phone numbers and messages in this workspace are invented. Nothing has ever
been sent to a real number.

---

## How to mark this up

After every group there is a line that begins **Your notes**, followed by a blank ruled space.
Write in it. If you want
wording changed, strike the old and write the new — I will not guess at intent.

---

## Part 1 — What a patient could read

**8 pieces of wording. This is the part with clinical weight.**

Everything here is marked in the code as **provisional and not clinically approved**, waiting
on you and a lived-experience representative.

### 1.1 The three complete messages

#### ⚠ Message A — the one supportive message a patient receives

**Exact wording:**

> Hi Rowan, Alex from Example Aftercare Team is thinking of you. This is a one-way message.
> No one reads replies to this number. For timing changes call +61 491 570 157, 9 am-6 pm. In
> an emergency call 000. Fictional Support Line: +61 491 570 158. - Alex

**Where it appears:** as a text message on the patient's own phone. Inside the workspace, the
same wording is shown to the clinician in a preview panel headed "Exact patient-visible
message" before anything is scheduled.

**When it appears:** at each scheduled contact time in the patient's plan, between 9 am and
6 pm Perth time. In this prototype it is never actually sent — no sending mechanism is built.

**Who sees it:** the patient, and the clinician previewing it.

**What fills in the blanks:** "Rowan" is the patient's first name. "Alex" is the name of the
staff member who owns the plan, and appears twice — once at the start and once as the
sign-off. "Example Aftercare Team" is the name of the service. The two numbers are reserved
fictional numbers that cannot connect to anybody: `+61 491 570 157` is the staffed programme
phone, `+61 491 570 158` is the crisis line.

**Length:** 252 characters, which is two SMS segments — the maximum this programme allows.
Adding roughly nine characters would push it to three and the message would be rejected. I
verified this by running the counting code, not by trusting a comment.

⚠ **Flag:** a patient reads the literal words "Fictional Support Line" before a crisis number.
Correct for a prototype; nothing in the code forces it to be replaced before a real send.

#### ⚠ Message B — the automated response to anyone who texts back

**Exact wording:**

> This number is not read. Your message has not been seen by anyone and has not been kept. To
> talk to someone, call +61 491 570 157, 9 am-6 pm every day. In an emergency call 000.
> Fictional Support Line: +61 491 570 158.

**Where it appears:** as a text message straight back to the patient's phone.

**When it appears:** the moment a patient replies to a caring contact. The design is that the
number can receive, sends this back automatically, and then discards what the patient wrote.

**Who sees it:** the patient only. It is never shown to a clinician and no count of replies is
kept.

**Length:** 218 characters, two SMS segments. Verified by running the counting code.

⚠ **Flag:** "has not been seen by anyone and has not been kept" is a firm factual claim about
storage. Whether the telephony provider retains a copy is outside this code and I could not
verify it.

#### ⚠ Message C — the no-reply notice

**Exact wording:**

> No one reads replies to this number

**Where it appears:** inside Message A above (as a sentence), and separately as a standing note
on the clinician's message-preview panels.

**When it appears:** every time.

**Who sees it:** the patient, in Message A. The clinician, on preview screens.

**Why it is worded this way:** the code carries a written explanation. An earlier version said
"Replies are not received, stored, analysed or monitored". That became untrue once the number
was made able to receive, so it was narrowed to describe only what is still true — that nobody
reads them. The change is dated 19 August 2026 and is explicitly awaiting your ruling.

> **Your notes on the three messages:**
>
> ---

### 1.2 The five fragments a message is required to contain

These are not messages. They are the exact phrases a checking routine requires to be present
inside a message before it can go out. A message missing one is rejected.

| The exact phrase                              | Required in             | What it is for                     |
| --------------------------------------------- | ----------------------- | ---------------------------------- |
| `Example Aftercare Team is thinking of you`   | first and last messages | identifies the service             |
| `9 am-6 pm`                                   | first message           | when the staffed phone is answered |
| `In an emergency call 000`                    | first message           | what to do in an emergency         |
| `Fictional Support Line: +61 491 570 158`     | first and last messages | the one crisis contact             |
| `This is the final message in this programme` | last message            | says this is the last one          |

**Who sees them:** the patient, embedded inside whatever message they sit in.

⚠ **Flag:** the last of these, "This is the final message in this programme", is **required but
does not yet exist in any written message.** No closing message has been drafted. If a plan
reached its end today there would be nothing to send.

> **Your notes on the required fragments:**
>
> ---

### 1.3 What patient-visible wording does NOT exist yet

Stated explicitly rather than filled with invented placeholders:

- **There is no library of message templates.** One message exists, hard-written, for one
  fictional patient. There is no per-week, per-stage or per-pathway wording.
- **There is no closing or final message**, despite one being required (above).
- **There is no seed or demo data containing message bodies.** The database has a column
  reserved to hold approved message content, and it is empty — no rows exist anywhere.
- **There is no wording for a stopped, paused or withdrawn patient.** If sending stops
  mid-plan, the patient is told nothing. That may be correct; it is a decision nobody has
  recorded.
- **There is no consent, enrolment or opt-out wording** shown to a patient.

> **Your notes on what is missing:**
>
> ---

---

## Part 2 — What a clinician reads when all sending has been stopped

**14 pieces of wording. Second-highest clinical weight.**

There is one control that halts caring-contact sending for the whole service — every patient,
every team — the moment a serious incident is confirmed. While it is active, this wording
appears on **every screen**, including screens showing no patient at all. Restarting requires
three approvals from three different people.

### ⚠ 2.1 The red bar at the top of every screen

**The state word:**

> Sending stopped

**The sentence below it** is assembled from three parts and reads, for example:

> All caring-contact sending is stopped for the whole service because a message reached the
> wrong recipient. 0 of 3 restart approvals recorded. Still needed: the incident lead, the
> privacy and security owner and the clinical programme lead, each from a different person.

The count and the list of outstanding people update as approvals are recorded.

**Where it appears:** a red band immediately under the page header, above the screen's own
content, so it is the first thing read.

**When it appears:** whenever the service is stopped, on every screen. Nothing while sending is
running.

**Who sees it:** every clinician in every team, including teams with no part in the incident.

**The five reasons** that can fill the "because" slot — one of these, exactly:

| Exact wording                                          |
| ------------------------------------------------------ |
| `a message reached the wrong recipient`                |
| `the same message was sent more than once`             |
| `a message went out with content nobody had approved`  |
| `a privacy or security incident was confirmed`         |
| `the record of what was sent can no longer be trusted` |

**The three people** who must each approve a restart, named in the sentence:

| Exact wording                    |
| -------------------------------- |
| `the incident lead`              |
| `the privacy and security owner` |
| `the clinical programme lead`    |

The free-text note the responder types during an incident — which routinely names a patient, a
number or a ward — is deliberately unreachable from this bar and can never appear in it.

### ⚠ 2.2 The condensed bar that stays pinned when you scroll

**Exact wording** (example with no approvals yet):

> Sending stopped for the whole service. 0 of 3 restart approvals recorded.

**Where it appears:** a thin red bar pinned directly under the header.

**When it appears:** only once the full red band above has scrolled out of sight. The two are
never on screen together. It exists because on a phone the full band scrolls away entirely, and
a stop that has scrolled away is not visible.

**Who sees it:** every clinician, on every screen, during a stop.

Note it says less than the full band — no reason, no outstanding names — but never anything
weaker. "for the whole service" travels with it deliberately, so it cannot be misread as one
patient's plan having stopped.

### 2.3 The button inside the red band

**Its label:**

> Service stop record

**What a screen reader reads out:**

> Service stop record is not built yet. What stopped sending, and the three approvals from
> three different people that start it again.

**Its tooltip:**

> Service stop record — coming soon

**When it appears:** always, inside the red band. The screen behind it does not exist yet, so
the button states its reason rather than leading to a missing page.

> **Your notes on the stopped-sending wording:**
>
> ---

---

## Part 3 — The 24 overlay screens

**104 pieces of wording** — four for each of the 24 screens (96), plus eight shared strings.

Every one of these is a panel that slides up from the bottom on a phone, or opens as a box in
the middle of the screen on a computer. Each carries exactly four pieces of wording:

- **Heading** — the bold line at the top
- **Body** — the sentence underneath explaining what is about to happen
- **Button** — the words on the button that goes ahead
- **Name** — a short name read aloud after the button by a screen reader, so it is clear which
  panel the button belongs to

Alongside each I have noted:

- **Availability** — whether the button works (`Available`), whether the panel only shows
  information with nothing to confirm (`Read only`), or whether the button is present but
  refuses until the underlying problem is fixed (`Unavailable until resolved`)
- **Emphasis** — `red` for a destructive action, `strong` for the main emphasised action,
  `plain` otherwise

**Who sees all of these:** clinicians only. A patient never sees any of it.

**An honest caveat that applies to all 24:** at present these panels can only be reached by
typing a special address into the browser bar. Nothing in the workspace opens them yet, and
confirming one records nothing. Phase 2B wires them up. Several of the sentences below
therefore describe behaviour that does not happen yet.

### 3.1 Setting a plan up — 11 panels

#### Verify identity — Available, strong

- **Heading:** "Check the identity before changing patient"
- **Body:** "Compare the person selected here with the invented source record before going any
  further."
- **Button:** "Confirm identity"
- **Name read aloud:** "Verify identity"
- **When:** before switching which patient a plan is being built for.

#### Change patient — Available, red

- **Heading:** "Change the selected patient"
- **Body:** "Choosing a different patient clears the current draft and everything picked for
  this one."
- **Button:** "Change patient"
- **Name read aloud:** "Change patient"
- **When:** on choosing a different patient with unsaved work in progress.

#### Pathway preview — Available, plain

- **Heading:** "Preview the approved pathway"
- **Body:** "Read the approved pathway in full before choosing it. Nothing here is ranked or
  recommended for you."
- **Button:** "Use this pathway"
- **Name read aloud:** "Pathway preview"
- **When:** while choosing which approved schedule of contacts to use.

#### ⚠ Message preview — Read only, plain

- **Heading:** "Preview the message the patient would see"
- **Body:** "The wording is shown exactly as it would arrive, with every detail already filled
  in."
- **Button:** "Back to personalisation"
- **Name read aloud:** "Message preview"
- **When:** while checking the wording before activating a plan.
- ⚠ The body promises the message itself. The panel as built shows only these words — no
  message. Phase 2B must add it or the sentence is untrue.

#### Communication preference — Available, plain

- **Heading:** "Record a communication preference"
- **Body:** "Record only a preference the patient gave through the staffed programme phone."
- **Button:** "Record preference"
- **Name read aloud:** "Communication preference"
- **When:** after a patient has phoned the staffed line and stated a preference.

#### Adjust date and time — Available, strong

- **Heading:** "Adjust the time of one contact"
- **Body:** "A contact can be moved only within the day it is already scheduled for."
- **Button:** "Save the new time"
- **Name read aloud:** "Adjust date and time"
- **When:** on moving a single contact to a different hour.

#### ⚠ Outside-window warning — Unavailable until resolved, strong

- **Heading:** "Outside the approved sending window"
- **Body:** "The time asked for falls outside 9:00 am to 6:00 pm AWST, so it cannot be
  scheduled."
- **Button:** "Keep the approved time"
- **Name read aloud:** "Outside-window warning"
- **When:** on asking for a send time before 9 am or after 6 pm Perth time.

#### Save draft — Available, strong

- **Heading:** "Save this activation draft"
- **Body:** "The draft is kept as it stands. Nothing is sent and no plan starts."
- **Button:** "Save draft"
- **Name read aloud:** "Save draft"
- **When:** on leaving a part-built plan.

#### Discard changes — Available, red

- **Heading:** "Discard unsaved changes"
- **Body:** "Only the edits made in this session go. The approved versions and the history stay
  as they are."
- **Button:** "Discard changes"
- **Name read aloud:** "Discard changes"
- **When:** on abandoning edits.

#### ⚠ Final activation — Available, strong

- **Heading:** "Last check before the plan starts"
- **Body:** "Everything is checked once more: the person, the agreement, who owns the plan, the
  approved versions, the wording and every send time."
- **Button:** "Confirm and activate"
- **Name read aloud:** "Final activation"
- **When:** the last step before a plan begins sending. This is the point of no return.

#### ⚠ Activation success — Read only, plain

- **Heading:** "Plan activation recorded"
- **Body:** "The plan is recorded. This confirmation carries no patient detail."
- **Button:** "View the plan"
- **Name read aloud:** "Activation success"
- **When:** straight after activating.
- ⚠ Says the plan is recorded. Today nothing is recorded — confirming closes the panel and does
  nothing else.

> **Your notes on the eleven set-up panels:**
>
> ---

### 3.2 Changing a plan that is already running — 4 panels

#### ⚠ Pause — Available, red

- **Heading:** "Pause this plan"
- **Body:** "Pausing can be undone, but the original dates never shift. Contacts that fall
  inside the pause are skipped for good."
- **Button:** "Pause future contacts"
- **Name read aloud:** "Pause"
- **When:** on pausing a running plan.
- ⚠ Contacts inside a pause are permanently lost — the patient simply never receives them.
  Please confirm this is the intended clinical behaviour.

#### ⚠ Withdrawal — Available, red, requires you to confirm who you are

- **Heading:** "Record a withdrawal the patient asked for"
- **Body:** "Every contact not yet sent is cancelled straight away. This needs no approval and
  cannot be undone."
- **Button:** "Continue and confirm who you are"
- **Name read aloud:** "Withdrawal"
- **When:** when a patient asks to stop receiving contacts.
- ⚠ Irreversible, immediate, and needs nobody else's agreement.

#### Reassignment — Available, strong, requires you to confirm who you are

- **Heading:** "Reassign the coordinator"
- **Body:** "Coordination moves to someone else and the whole handover stays on the record."
- **Button:** "Continue and confirm who you are"
- **Name read aloud:** "Reassignment"
- **When:** on handing a patient's plan to another staff member.

#### Team switcher — Available, red

- **Heading:** "Switch to another team"
- **Body:** "Switching team clears the selected patient and every draft for that patient before
  the new team appears."
- **Button:** "Clear and switch team"
- **Name read aloud:** "Team switcher"
- **When:** on changing which team's work you are looking at.

> **Your notes on the four running-plan panels:**
>
> ---

### 3.3 When something has gone wrong with a contact — 3 panels

#### ⚠ Delivery detail — Read only, plain

- **Heading:** "What the phone network reported"
- **Body:** "This shows how the message travelled and nothing else. It does not show that it
  was read or that it helped."
- **Button:** "Close this detail"
- **Name read aloud:** "Delivery detail"
- **When:** on opening the technical detail of one contact.
- This is the wording that keeps a network receipt from being read as a clinical outcome. It is
  the clearest statement of that boundary anywhere in the workspace.

#### ⚠ Resolve failed delivery — Available, strong

- **Heading:** "Close off a delivery that failed"
- **Body:** "All three attempts in the original window are finished and there is no later
  retry. Record what was done instead."
- **Button:** "Record what was done"
- **Name read aloud:** "Resolve failed delivery"
- **When:** after a contact has failed three times inside its window.
- ⚠ States the retry policy as fact: three attempts, then nothing. A patient whose contact
  fails simply receives nothing that day.

#### ⚠ Contact-changed block — Unavailable until resolved, red

- **Heading:** "The contact number has changed"
- **Body:** "A changed mobile number pauses future contacts until a coordinator has checked
  where it came from."
- **Button:** "Keep the plan paused"
- **Name read aloud:** "Contact-changed block"
- **When:** when a patient's mobile number changes in the source record.

> **Your notes on the three delivery panels:**
>
> ---

### 3.4 When the wording or template has moved under you — 2 panels

#### Template changed or retired — Unavailable until resolved, strong

- **Heading:** "This template is no longer the current one"
- **Body:** "The template was retired after this draft was opened. The older wording stays
  readable in the history."
- **Button:** "Choose the current version"
- **Name read aloud:** "Template changed or retired"
- **When:** when approved wording is retired while you have a draft open.

#### Draft version conflict — Unavailable until resolved, strong

- **Heading:** "This draft and the approved version differ"
- **Body:** "An approved template changed after this draft was opened. Compare the two; neither
  is overwritten on its own."
- **Button:** "Review the current version"
- **Name read aloud:** "Draft version conflict"
- **When:** when a draft and the approved wording have drifted apart.

> **Your notes on the two template panels:**
>
> ---

### 3.5 When the app itself cannot proceed — 4 panels

#### Session expiry — Unavailable until resolved, plain

- **Heading:** "The session has expired"
- **Body:** "The session ended before this could finish, so nothing was changed. Sign in again
  to carry on."
- **Button:** "Sign in again"
- **Name read aloud:** "Session expiry"
- **When:** when a login times out mid-action. It fills the screen and cannot be dismissed —
  signing in again is the only way out.

#### Offline banner — Unavailable until resolved, plain

- **Heading:** "There is no connection"
- **Body:** "Without a connection nothing can be started or changed, and no patient detail is
  kept on this device for later."
- **Button:** "Try connecting again"
- **Name read aloud:** "Offline banner"
- **When:** whenever the device loses its connection. It appears as a strip along the bottom of
  the screen rather than a box, and never blocks what is behind it.

#### Recoverable error — Available, plain

- **Heading:** "Those records could not be loaded"
- **Body:** "Nothing about the plan or its deliveries has changed. Try the same page again."
- **Button:** "Try loading again"
- **Name read aloud:** "Recoverable error"
- **When:** when a page fails to load its data.

#### ⚠ Permission unavailable — Unavailable until resolved, plain

- **Heading:** "This action is not available to you"
- **Body:** "This role cannot carry out this action. The attempt is recorded and nothing has
  changed."
- **Button:** "Back to the plan"
- **Name read aloud:** "Permission unavailable"
- **When:** on attempting something your role does not allow.
- ⚠ Marked "unavailable until resolved", but a role limit is not something the person reading
  it can resolve. The label and the sentence say different things.

### 3.6 The eight strings shared across all 24 panels

| Exact wording                                                                                            | Where and when                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Fresh authentication checkpoint. Confirm who you are before this is recorded. Nothing has changed yet.` | A box inside Withdrawal and Reassignment, after the first button press, before the identity check.         |
| `Confirm and continue`                                                                                   | Replaces the panel's own button wording once that identity check is open.                                  |
| `You do not have permission to carry out this action.`                                                   | Red line above the button when it has been refused on permission grounds.                                  |
| `There is no connection, so nothing can be changed from here.`                                           | Red line above the button when it has been refused because the device is offline.                          |
| `Available`                                                                                              | Internal label for the panel's state — see the note below.                                                 |
| `Read only`                                                                                              | Internal label for the panel's state.                                                                      |
| `Unavailable until resolved`                                                                             | Internal label for the panel's state.                                                                      |
| ` (panel name)`                                                                                          | Read aloud after the button by a screen reader only, never shown on screen. The panel's own name fills it. |

The three availability labels are recorded against each panel in the design record but are
**not currently printed anywhere on screen.** I have listed them because you may want to decide
their wording now, before Phase 2B chooses how to display them.

> **Your notes on the shared panel wording:**
>
> ---

---

## Part 4 — The rest of the workspace

**63 pieces of wording.** Ordinary screen furniture. None of it is patient-visible. Skim it.

### 4.1 The standing marker on every screen

**Exact wording:**

> Synthetic prototype — fictional data only

**Where:** a small badge in the top-right of the header, as visible text — not a tooltip.

**When:** always, on every screen, including while loading and after an error. It is
deliberately kept on printouts and screenshots.

**Who sees it:** every clinician.

### 4.2 The one screen that exists

| Exact wording                                                                                                                                                                                                                                         | Where and when                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `Today`                                                                                                                                                                                                                                               | The page's main heading, and the first navigation item. |
| `The day's caring-contact work for this team. Every patient, number and message in this workspace is invented; nothing here is ever sent to a real number.`                                                                                           | The paragraph directly under the heading. Always.       |
| `What this screen will show`                                                                                                                                                                                                                          | A sub-heading below that.                               |
| `The contacts due today, the ones that did not go out, and the patients whose plans need a decision. The workspace is being built one screen at a time; the More destinations panel lists what is still to come and what each destination will hold.` | The paragraph under that sub-heading.                   |
| `Caring Contacts`                                                                                                                                                                                                                                     | The workspace name, beside the logo.                    |
| `Caring Contacts - Clinical KB`                                                                                                                                                                                                                       | The browser tab title.                                  |

### 4.3 The four main navigation items

Only "Today" leads anywhere. The other three are present but not built; each states in words
what it will hold, which a screen reader reads out.

| Label       | The reason a screen reader reads out                                        |
| ----------- | --------------------------------------------------------------------------- |
| `Today`     | `The day's caring-contact work for this team.`                              |
| `Patients`  | `Every patient with a caring-contact plan, and where each plan has got to.` |
| `Schedule`  | `Contacts due, day by day.`                                                 |
| `Templates` | `Governed pathways, message wording and approval history.`                  |

On a phone the bar at the bottom carries Today, Patients, Schedule and a fourth item labelled
`More` that jumps to the panel below.

### 4.4 The main button on the page

| Exact wording                                   | Where                                                |
| ----------------------------------------------- | ---------------------------------------------------- |
| `New plan`                                      | The one prominent button, top right of the page.     |
| `Starting a caring-contact plan for a patient.` | The reason a screen reader reads out. Not built yet. |

### 4.5 The "More destinations" panel

Ten planned screens, none built. Heading and introduction:

> More destinations
>
> These destinations are planned. Each one states what it will hold once it is built.

| Label            | The reason a screen reader reads out                      |
| ---------------- | --------------------------------------------------------- |
| `Team`           | `Ownership, capacity and unclaimed work.`                 |
| `Guidance`       | `Programme boundaries and operational guidance.`          |
| `Reports`        | `Aggregate operational reporting.`                        |
| `Service stop`   | `Stopping the whole service, and restarting it.`          |
| `Access trail`   | `Who opened which record, and when.`                      |
| `Workload`       | `Work waiting across the team.`                           |
| `Reconciliation` | `Differences between what was planned and what happened.` |
| `Notifications`  | `What the team is told, and how.`                         |
| `Training`       | `Practice mode, kept apart from real records.`            |
| `Coverage`       | `Who is covering while someone is away.`                  |

### 4.6 The pattern used for every unbuilt button

Every not-yet-built control above uses the same two strings, with the button's own label and
reason filling the blanks:

- **Tooltip on hover:** the label, then " — coming soon". For example, "Reports — coming soon".
- **Read aloud by a screen reader:** the label, then " is not built yet.", then the reason from
  the tables above.

### 4.7 Loading and error screens

| Exact wording                                                                          | Where and when                                                                               |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `Loading the Caring Contacts workspace`                                                | Read aloud while the page loads. Not shown on screen.                                        |
| `The Caring Contacts workspace could not be shown`                                     | Heading, when a screen fails to load.                                                        |
| `Nothing was sent and nothing was changed. You can try again, or refresh the browser.` | The sentence under it. ⚠ A safety claim, and the honest fallback for any unexpected failure. |
| `Try again`                                                                            | First button on that error screen.                                                           |
| `Reload page`                                                                          | Second button.                                                                               |
| `Copy Diagnostics`                                                                     | Third button — copies technical detail for a developer.                                      |
| `Copied Diagnostics`                                                                   | Replaces it briefly after a successful copy.                                                 |
| `Copy failed — try again`                                                              | Replaces it if the copy fails.                                                               |

### 4.8 Wording only a screen reader ever encounters

| Exact wording     | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `Workspace`       | Names the sidebar navigation.                 |
| `Phone workspace` | Names the bottom bar on a phone.              |
| `Compact layout`  | Announces the phone layout is active.         |
| `Rail layout`     | Announces the narrow-tablet layout is active. |
| `Split layout`    | Announces the laptop layout is active.        |
| `Wide layout`     | Announces the large-screen layout is active.  |

### 4.9 The card that leads into this workspace

Shown in the main tools list of the wider Clinical KB app.

| Exact wording                                                                                                                                           | Where                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `Caring Contacts`                                                                                                                                       | Card title.                         |
| `A synthetic demonstration of caring-contact follow-up after a hospital stay.`                                                                          | Card description.                   |
| `Seeing how caring-contact follow-up is coordinated`                                                                                                    | Shown as what the tool is best for. |
| `A working demonstration built on invented patients and invented numbers. Nothing in it is ever sent to a real number, and none of it is patient data.` | Expanded detail.                    |
| `Open`                                                                                                                                                  | The button on the card.             |

### 4.10 Two messages that only appear if something is misconfigured

These are error texts written for whoever is running the system, not for a clinician at work.

| Exact wording                                                                            | When                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Caring Contacts must run against its own database, never the live Clinical KB project.` | If the workspace is pointed at the wrong database. It refuses to start. |
| `Caring Contacts demo actors are unavailable in production.`                             | If the demonstration mode is switched on where it should not be.        |

> **Your notes on the rest of the workspace:**
>
> ---

---

## Part 5 — The banned vocabulary check

This project bans certain words from every interface string. I checked each one by searching
the code, rather than asserting it.

**Result: none of the banned words appear as wording anyone reads, in either the patient
messages or the built workspace.**

| Banned term                          | Found as visible wording? | Where it does appear                                               |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------------ |
| `high risk`                          | No                        | Only inside the ban list itself.                                   |
| `safe`                               | No                        | Only in developer comments and internal names, e.g. "safety stop". |
| `engagement score`                   | No                        | Only inside the ban list itself.                                   |
| `campaign`                           | No                        | Only inside the ban list itself.                                   |
| `lead`                               | See flag below            | As the ordinary English noun, in the stopped-sending sentence.     |
| `conversion`                         | No                        | Only inside the ban list itself.                                   |
| `best match`                         | No                        | Only inside the ban list itself.                                   |
| `inbox`                              | No                        | Once inside a filename in a code comment.                          |
| `conversation`                       | No                        | Only inside the ban list itself.                                   |
| `clinical risk`                      | No                        | Nowhere at all.                                                    |
| `risk score`                         | No                        | Nowhere at all.                                                    |
| `wellbeing score`                    | No                        | Nowhere at all.                                                    |
| any claim that replies are monitored | No                        | The opposite claim is made, twice, deliberately.                   |

**Transport words used as patient-state labels:** none. "Delivered" and "Not delivered" exist
only as internal codes in the database and in code — they are never printed on any screen. The
only place delivery is described to a clinician is the Delivery detail panel, which says in
plain words that it shows how the message travelled and nothing about whether it was read or
helped.

### ⚠ Three things the check turned up that you should decide on

1. **"lead" appears in visible wording, in its ordinary English sense.** The stopped-sending
   sentence names "the incident lead" and "the clinical programme lead". These are people, not
   sales prospects, and I believe they are fine — but the ban is a plain word match, so if that
   sentence were ever put through the outgoing-message checker it would be rejected. Worth
   either narrowing the ban to "leads" in the commercial sense, or noting the exception.

2. **The ban is only enforced on outgoing messages, not on screen wording.** The checking
   routine runs against a message about to be sent. Nothing checks the words on a screen. The
   ban on interface wording is currently policy held by people, not by the software.

3. **One banned word does appear in a rendered sentence — in the old design-scratch prototype,
   not in the built workspace.** The sentence reads: "Delivered is a transport receipt only and
   never means the message was read or the patient is safe." It uses "safe" in order to deny
   it, which is arguably the right use, but it is the banned word on a screen. Those
   design-scratch screens do not exist in the live app and Phase 2B replaces them, so this is a
   decision for when that wording is carried across, not a live defect.

> **Your notes on the banned vocabulary:**
>
> ---

---

## Part 6 — What my search covered, and where it stops

So you know how much to trust the claim that this is everything.

**I read, in full, every file in:**

- the caring-contacts logic and rules (26 files)
- the built workspace screens and panels (all of them)
- the four page files of the live workspace, plus the shared error screen it uses
- the four database migration files
- the frozen design record of the 24 panels
- the card in the main tools list that links here

**After drafting, I ran a second sweep** for any sentence-like text I might have missed across
all of the above, and for each banned word individually. That sweep found nothing new.

**Where this document is incomplete, stated plainly:**

1. **The old design-scratch prototype is not transcribed.** There are about 5,900 lines of
   earlier prototype screens that do not exist in the live app. They contain a great deal more
   clinician-facing wording. I searched them for the patient messages and for banned words —
   both reported above — but I did not list their wording. If Phase 2B is going to carry that
   wording across rather than rewrite it, that is a second review and I have not done it.

2. **I did not open the app.** Every description of where and when something appears comes from
   reading the code, not from looking at a screen. I am confident about which screen each string
   belongs to, and less confident about exact visual position.

3. **Wording assembled at the moment it is shown cannot be fully shown here.** The
   stopped-sending sentence, for example, changes as approvals are recorded; I have given you a
   worked example and every part that can fill each slot.

4. **I could not verify the storage claim in the automated reply.** Whether a telephony
   provider keeps a copy of an inbound message is outside this code entirely.

5. **Documentation and test files are excluded** — nobody using the workspace reads them.

---

## Part 7 — Wording I think is risky or misleading as written

My ten concerns, strongest first. Each needs a decision from you, not from a developer.

1. **A patient is given a crisis number labelled "Fictional Support Line".** Correct while
   nothing is sent. Nothing in the code forces it to be replaced, and no automated check would
   catch it.

2. **"Your message has not been seen by anyone and has not been kept" may not be true.**
   Whether the phone provider retains inbound messages is outside this code. If it does, the
   workspace is making a false promise about a safety boundary to a patient in distress.

3. **"No one reads replies to this number" tells a patient what does not happen, not what
   does.** They then receive an automatic reply. A person may reasonably read "no one reads
   replies" as "nothing at all will come back". Consider saying so.

4. **The required closing message does not exist.** The rules demand that a final message
   contain "This is the final message in this programme", and no final message has been written.
   A plan reaching its end today would send nothing.

5. **A patient is never told when sending stops.** During a service-wide stop, or a pause, or a
   contact-changed block, the workspace tells clinicians in detail and tells the patient nothing.
   That may be right. Nobody has recorded a decision.

6. **"Contacts that fall inside the pause are skipped for good."** Pausing quietly and
   permanently removes contacts from a suicide-prevention schedule. Please confirm this is
   intended.

7. **Withdrawal is immediate, irreversible, and needs nobody else's agreement** — "This needs no
   approval and cannot be undone." Compare with restarting the service, which needs three
   people. The asymmetry may be right; it should be deliberate.

8. **"All three attempts in the original window are finished and there is no later retry."** A
   patient whose contact fails receives nothing that day and nothing later. That is a clinical
   policy stated in a button panel.

9. **Two panels describe content they do not show.** "Preview the message the patient would see"
   shows no message; "Plan activation recorded" records nothing. Both are true statements about a
   finished product and false about the one that exists. Phase 2B must close the gap or the words
   must change.

10. **"000" is the only emergency direction given.** There is no Lifeline, no 13YARN, no
    after-hours mental health line. Whether a caring contact should carry more than the emergency
    number is your call, and it is constrained: the message is already at its two-segment
    maximum, so anything added means something removed.

> **Your overall notes:**
>
> ---
