# First Nations mode — design

Status: design approved by the owner (final design, 2026-09-26 18:48Z)
Date: 2026-09-26
Owner decisions captured in the project thread "Plan First Nations mode" (cards 1–15, G1–G24 and the
seven final-design cards, answered 2026-09-26). Visual design: the private plan page, final design
(version 12), 23 phone screens plus tablet and desktop. The generators that draw it are kept in the
project files (`first-nations-mode/design-source/v4/`) as the visual reference for the build.

## 1. What this is

A new standalone mode, `first-nations`, for hospital doctors caring for Aboriginal and Torres Strait
Islander patients. It is about **better, culturally safe care**: reaching the right Aboriginal
services fast, communicating well, involving family, avoiding common mistakes, and knowing what to
be aware of. It is built for **all of WA Health**, with **East Metropolitan Health Service (EMHS), starting at
Royal Perth Hospital**, as the first service to add its own layer.

It is a **reference and contacts tool**. It is not clinical decision support, it holds **no disease
or condition content** (owner, 2026-09-26: "this is not a medical condition tool"), it stores
nothing about any patient, and PsychSift never signs off Indigenous content: cultural approval comes
only from the service's Aboriginal health team.

## 2. Decisions taken, and what they rule out

| Decision                     | Chosen                                                                                                                                           | Rejected, and why                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Name                         | "First Nations"                                                                                                                                  | "Aboriginal health" — owner's choice                                                                 |
| Audience                     | All hospital doctors; mental health covered most deeply                                                                                          | Psychiatry only — drops most bedside use                                                             |
| Scope                        | Care tips, services, communication, family, common mistakes, "be aware" background                                                               | Condition cards, doses, region/exposure filter — owner ruled disease content out                     |
| First release content        | Checked contacts and links, plus short tips **credited to published Aboriginal-led or official guides**, each marked "Awaiting service approval" | Our own cultural wording before approval — breaks the owner rule on Indigenous sign-off              |
| Tip format                   | One line "do", one line "why", source line                                                                                                       | Paragraphs — slow at the bedside                                                                     |
| Build approach               | Start simple, grow: typed content files in the repo, one renderer, no database change                                                            | Editable-now (DB tables and editors before anyone owns content); simple-only (never editable)        |
| Sign-in                      | Open to read                                                                                                                                     | Staff sign-in — content is public contacts and links only                                            |
| Cultural approval            | EMHS Aboriginal health team, recorded per section                                                                                                | A statewide body — less local knowledge of the hospitals and communities                             |
| General version              | May go live before a written EMHS agreement, naming no service and showing no endorsement                                                        | Waiting for the agreement — delays a useful tool                                                     |
| Recheck cycle                | Phone numbers 90 days, everything else 12 months                                                                                                 | 12 months for all — numbers go stale first and matter most                                           |
| Wrong-number reports         | To the owner first, then EMHS's named content owner (by role) once agreed                                                                        | —                                                                                                    |
| Device-software status       | Recorded as reference only (owner ruling, beside open decision `#WGH5YF`)                                                                        | —                                                                                                    |
| Offline engine, custody      | Left out                                                                                                                                         | Offline storage conflicts with the privacy model (docs/pwa.md); custody is outside hospital practice |
| Pocket card                  | First release, printable, public numbers only                                                                                                    | —                                                                                                    |
| Patient and family materials | First release, as **links to Aboriginal-produced resources** chosen with the EMHS team                                                           | PsychSift-written patient material — needs co-design and approval first                              |
| Style                        | Live app components; premium, mature, light weights; numbers never bold                                                                          | Ochre theme, Aboriginal art or language page names — tokenistic without permission                   |
| Mode colour                  | Olive `#4d6b2f` (dark `#b5c98c`), shared design standard v13.1                                                                                   | Deep eucalyptus — too close to On Call's teal in lightness                                           |
| After hours                  | The hospital switchboard is the large figure until the service supplies an after-hours contact                                                   | A service after-hours line — none supplied yet                                                       |
| Situation module on open     | Opens on "New admission"                                                                                                                         | Nothing chosen — costs a tap before any words show                                                   |
| Phrases                      | Three per situation (18 in all), each needing service approval                                                                                   | One per situation — no alternatives                                                                  |
| Situations                   | The same six for all of WA Health                                                                                                                | Chosen per hospital — more screens and approvals                                                     |
| Hospital not set up          | Statewide numbers only; the liaison card becomes the state module saying so                                                                      | Hiding the mode — the words and statewide numbers help anywhere                                      |
| "Wants to leave" risk line   | The owner checks the wording himself; it ships only after his typed OK in the thread                                                             | Sending it to the service (it is clinical, not cultural); leaving it out                             |

## 3. Pages and navigation

Navigation copies live On Call and CPD exactly: the mode pill opens the full-height pages sheet
("First Nations pages"); each page has underlined section tabs; rarer actions sit in the ••• menu
(change hospital, report a wrong number, pocket card, cultural safety training, sources, primer).

| Page            | Route                          | Tabs                                     | Holds                                                                                                                                                 |
| --------------- | ------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bedside         | `/first-nations`               | —                                        | Liaison card (hero), crisis strip, this mode's own search box, Situation module, "Before you go in" and "Where is home?" tiles, quiet Acknowledgement |
| Contacts        | `/first-nations/contacts`      | Hospital · Community · Mental · Language | Liaison teams (team numbers only), ACCHOs and Aboriginal mental health services via Services, Aboriginal Interpreting WA, Aboriginal staff roles      |
| Talking         | `/first-nations/talking`       | Yarning · Asking · Language · Be aware   | Clinical yarning (credited), asking about identity (text only), interpreters, one-line background facts                                               |
| Family          | `/first-nations/family`        | Kinship · Consent · Visitors · Safety    | Who decides, consent as a shared process, visitors, children and family safety                                                                        |
| Mental health   | `/first-nations/mental-health` | Act · Assessment · Wellbeing · Restraint | MHA 2014 s 81 verbatim (from the Forms note), what to record, cultural context, SEWB links, restraint                                                 |
| On the ward     | `/first-nations/on-the-ward`   | Respect · Healing · Country · Bias       | Everyday respect, traditional healers and bush medicine (after approval), away from Country, racism and bias                                          |
| Common mistakes | `/first-nations/mistakes`      | Talking · Family · Mental · Ward         | "Avoid / Instead" items; top three also reachable from Bedside                                                                                        |
| Going home      | `/first-nations/going-home`    | Leaving · Medicines · Travel · Follow-up | Leaving early steps, Close the Gap, PATS, follow-up with the patient's ACCHO, patient materials links                                                 |
| End of life     | `/first-nations/end-of-life`   | Family · Country · Afterwards · Coroner  | Family and liaison first, returning to Country, after death (ask, no generic rules), coroner links                                                    |

Situations (New admission, Wants to leave, Family meeting, Mental Health Act, Sorry Business, Going
home) are chips in the Bedside Situation module. The chosen chip shows three phrases to try (one at a
time, stepped with an arrow), the first step, and a "Plan · N steps" button that opens the full plan
as a bottom sheet. Each plan is three to five steps that **reference** existing content blocks by id,
so nothing is written twice. "Wants to leave" opens with the immediate-risk line, which renders only
once the owner's typed OK is recorded.

The pages sheet groups pages under "At the bedside" (Bedside, Contacts, Talking, Family), "During
the stay" (Mental health, On the ward, Common mistakes) and "Leaving hospital" (Going home, End of
life). Inner pages are built from titled modules: a 28 px olive icon tile and an eyebrow, then rows,
steps or cards. Contacts opens with four number tiles; Talking and Family open with a phrase deck;
Mental health pairs s 81 with its three steps; Common mistakes are numbered cards; Going home ends
with copyable lines for the discharge letter.

## 4. Content model

Content lives in `src/data/first-nations/` (so `pr-policy` treats every edit as clinical-risk):
`pages.json` (statewide layer), `profiles/emhs.json` (service layer) and `sources.json`. One Zod
schema in `src/lib/first-nations/content-schema.ts` validates them at build and in tests.

Block types: `statusCall`, `contact`, `tip` (do, why, sourceId), `avoid` (avoid, instead, sourceId),
`steps`, `quote` (verbatim, sourceId), `linkList`, `noteWording` (template text with `[blank]`
markers), `note`.

Every block carries `sourceId` and `checkedAt`. Tips are short paraphrases, or brief quotes within fair dealing, always credited and linked; no guide is reproduced at length. Sources record title, publisher, URL, whether
Aboriginal-led, and checked date.

**Approval** is a separate record per section, never a status field on content:
`{ body, role, date, reference, contentSha256 }`. The renderer hashes the section's current content (normalised JSON, so formatting-only edits do not break approval);
if the hash differs from the approval, or no approval exists, the section renders its **unapproved
state**: credited tips show with an "Awaiting service approval" chip, and our own wording
(`noteWording`, any unattributed text) does not render at all. The words `reviewed`, `signedOff` and
`approved: true` are banned from content files by a contract test.

**Service layer.** `profiles/emhs.json` holds hospitals (Royal Perth first), liaison team numbers and
hours, form names, approved Acknowledgement of Country wording, and content owners by role. It has
`enabled: false` until a written EMHS agreement exists; while disabled the mode shows the statewide
layer only, names no service and shows no endorsement. Setting it back to `false` withdraws the
layer at once.

## 5. Behaviours

- **Liaison card (hero).** Dark hero card: status word with a 6 px dot, "until 16:30" as the one
  36 px light figure, a 24-hour day track (open hours in olive, "now" in product blue), today's hours
  in words, and the one filled call button. After hours the switchboard number becomes the large
  figure and the line reads "Ask who covers liaison tonight". The status dot is success green only
  for a live, fresh state and pulses once for 600 ms when it turns fresh (never with reduced motion).
  Server renders "Hours not confirmed"; the client computes the real
  state in Australia/Perth time with the WA public holiday list (reusing `toAwstParts`/`Clock` from
  `src/lib/caring-contacts/clock.ts`). Out of hours it switches to the switchboard. Past the 90-day
  recheck it never says "open", turns the card to the overdue state and moves the switchboard to the
  top. The number is never hidden.
- **Crisis block.** 000, 13YARN, MHERL and Lifeline read from `WA_CRISIS_CONTACTS`, rendered with the
  page, never lazy-loaded. On Bedside, 000 and 13YARN sit as a two-tile strip directly under the
  liaison card, and the strip renders in every state (loading, empty, offline, error, not set up).
- **Tap a number.** Every number opens a bottom sheet: the number in 44 px light digits, Call (the
  one filled button), Copy and Share, the source and "Checked <date>", and "Report a wrong number".
- **Before you go in.** A five-check sheet from its Bedside tile. It opens unticked every time, says
  "Nothing is saved", and clears with Undo (about six seconds), never "Are you sure?".
- **Where is home?** A line map of WA; tapping a region lists services and languages near home, with
  "Add to letter" and "Copy all". The region is never saved, put in a URL, sent to the server or
  analytics, or entered into the main search bar.
- **Search box.** This mode's own in-page search over its content and contacts, with no microphone.
  Nothing typed goes to the main search bar or to OpenAI.
- **One state module.** Empty, offline, error and not-set-up share one module in the same place: an
  icon, a title, one line and one outlined button. The header, tabs and crisis strip always stay.
  Tabs never carry count badges.
- **Tick-through steps** in situations: React state only, never stored, and the screen says so.
- **Note wording.** Copies the approved template to the clipboard; PsychSift fills in nothing and
  keeps nothing. Hidden until approved.
- **Five contact actions.** Call (`tel:`), copy (existing copy button), send to a colleague (Web
  Share, falling back to copy), save to phone (a generated vCard with the team name and number only),
  report a wrong number (a prefilled email to a configured role address: the owner now, the EMHS content owner later; PsychSift stores nothing).
- **Hospital choice** limited to the profile's hospitals, stored with
  `account-scoped-browser-state` so it clears at sign-out. The page works before a choice.
- **Reference notice / About**: keep the non-CDS and cultural-governance caveat persistently inline; open the full About sheet only from •••, without a dismissal flag. This replaces the original first-visit Primer policy under the [17 October decision](../../decisions/2026-10-17-design-audit-resolution.md).
- **Pocket card**: a print view of liaison, switchboard and crisis numbers, reusing On Call's pocket
  card layout. Public numbers only, from enabled layers only.
- **Links in**: the s 81 note in Forms and the Aboriginal filter in Services link to the mode; the
  mode's pages are registered for main search. No change to the answer engine.

## 6. Privacy and safety

No patient data, notes, flags, names or identity status anywhere; no usage analytics about
Indigenous status. Team and switchboard numbers only (the repository is public): a test rejects
personal names and mobile numbers in `src/data/first-nations/`. No database change, no new
offline caching, no provider calls. Nothing clinically signed off; every item shows its source and
checked date; "checked" means checked against the official page.

## 7. Design

Follows the shared mode design standard (`/mnt/project-files/design/mode-design-standard.md`,
v13.1) and the final design page. Built from live components and tokens: universal header and mode
pill, `InPageNavHeader` tabs, raised cards with the e1 elevation, sheets with e4, hairline borders,
concentric inner corners.

- **Type.** Geist from the app's own font file; sizes 11 (labels, sources), 13 (body, sub-lines,
  tabs, buttons), 15 (row titles and numbers), 17 (sheet titles, quotes, crisis numbers); display
  36 px (liaison figure) and 44 px (number sheet) at weight 300. At most four sizes per screen,
  weights 400–600, numbers 400 with tabular figures, nothing bold.
- **Serif accent.** Newsreader italic 400 via `next/font/local`, only for words to say aloud, the
  quoted Act and the Acknowledgement.
- **Colour.** Olive tokens: light `#4d6b2f`, soft `#f2f5ee`, border `#dce4d2`; dark `#b5c98c`, soft
  `#232b1d`, border `#3a4730`, disc contrast `#172009`. Used only on the pill, the current tab,
  module-header icon tiles, the hero's day track and quotation marks with their 3 px side rule.
  Selection and "now" stay product blue; 000 is the only red; rows, chips and buttons stay neutral.
  Muted small print on a soft tint uses `--text-muted`.
- **Layout.** 12 px gutters and module padding, 48 px taps (row actions 34 px visible inside 48 px),
  one filled button per screen or sheet, sheets rise from the bottom. Tablet: two columns. Desktop:
  a 360 px side panel showing the chosen situation's plan, with previous and next arrows. Dark mode
  follows the phone; text reflows at 200%.
- Target WCAG 2.2 AA.

## 8. Architecture and files

- Mode registration copies the My Work pattern (`c01570c4c`): `src/lib/app-modes.ts`
  (`resultsSurface: "none"`), `mode-secondary-navigation.ts`, `information-pages.ts`,
  `header-addon-slot.ts`, `mode-nav-icons.ts`, `app-mode-icons.ts`, `answer-status.tsx`,
  `universal-search-command-surface.tsx`, `consolidated-mode-home-redirect.ts`,
  `source-usage-presentation.ts`, the category identity and search-shell files; typecheck lists any
  others.
- One claimant nav header: `src/components/first-nations/first-nations-nav-header.tsx`.
- Nine thin route files under `src/app/first-nations/`, each calling one server renderer
  `src/components/first-nations/page-renderer.tsx`; `loading.tsx` on the home only, plus its entry in
  `standaloneModeHomePaths`. Client islands only for the hours card, situation sheet, contact actions
  and primer.
- Organisation map: `src/data/first-nations/**` into clinical-content, `src/components/first-nations/**`
  into app-experience.

## 9. Testing

Contract tests: schema validity; exactly six situations with three phrases each; every block has a source and checked date; no names or mobile
numbers; banned approval words absent; a changed hash drops a section to its unapproved state;
unapproved own wording never renders; service layer off hides every EMHS item. Behaviour tests: the
hours card with a faked clock (open, closed, public holiday, overdue); crisis block present in the
server HTML and in every state; the situation, region and ticks never reach a URL, storage or a
network request; the immediate-risk line stays hidden until its approval record exists. Updated pins: mode counts in `app-modes.test.ts`, `mode-secondary-navigation.test.ts`,
`ui-copy.test.ts`, `ui-smoke.spec.ts`, `design-system-adoption.test.ts` and the nav-slot claimant
list, re-derived after merging `main` because sibling new-mode threads touch the same pins.

## 10. Build route

One pull request, no database change, no retrieval or ranking files. Three parallel parts on
disjoint files (mode plumbing; content files and contract tests; renderer, client islands and their
tests), integrated and committed once. Source checking runs alongside with the `sources` skill.
Local proof: typecheck, lint, the focused tests above, `sitemap:update`,
`design-system:adoption:update`, `snapshot:repo-awareness`, `check:organisation`, `format`. The full
browser suite runs in CI. The PR goes to the merge lineup, one new mode at a time.

## 11. Before the EMHS layer goes live

A written content-ownership agreement naming roles; the recheck cycle; the wrong-number route into
EMHS's incident system; approved disclaimer and Acknowledgement wording; a statement that no
Indigenous status or usage data is collected; permission for any artwork; an accessibility check;
and an Aboriginal Health Impact Statement if EMHS uses one (to be checked).

## 12. Out of scope

Disease or condition content, doses and calculators; editing in the app (later, via On Call's
service entries, team roles and landlines only); offline caching; custody health; "recently viewed";
suggestions inside Answer mode.

## 13. What the review changed

A proportionate adversarial pass on this design (privacy, cultural governance, build) changed:
tips are paraphrased or briefly quoted with credit, never copied at length; approval hashes normalised
JSON so reformatting cannot silently revoke or keep an approval; wrong-number reports go by email to a
role address so PsychSift stores no report data; the pocket card prints only enabled layers, so EMHS
numbers never appear before the agreement; situations reference existing blocks instead of holding
their own text, so an approval can never be bypassed through a situation.
