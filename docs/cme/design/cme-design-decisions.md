# CME mode — design decisions

**Status: core workflow implementation; broader portfolio and evidence features remain planned.**
This is the decision record behind the screen boards. The 23 September 2026 owner decisions
below supersede the earlier capture, peer-review and year-finalisation proposals. Written or
locally checked code is not evidence that migrations have been applied or the app deployed.

Boards: the canvas (21 screens, phone-first) and the earlier three-way home study in
[`prototypes/cme-screens.html`](prototypes/cme-screens.html), kept for provenance — its
three competing homes were superseded by the single perfected dashboard on 2026-09-19.

---

## 1. What this is

A continuing-education tracker for a doctor registered in Australia. It is the place the
record actually lives; the doctor's CPD home stays the system of record and this feeds it.

**Built to the national requirement, not to one college.** Every registered medical
practitioner is held to the Medical Board's CPD standard; specialists meet their college's
extra requirements on top, whichever CPD home they choose. So the app models one baseline
plus an optional overlay, and works for a GP, an anaesthetist or a psychiatrist without
redrawing anything.

## 2. The requirement model

A **requirement set** belongs to a year and is stamped onto it permanently. Changing status
next year never re-judges a closed year.

For a practitioner outside a training programme, a requirement is one of four shapes. An
hours-only model cannot express the last three, which is why most trackers quietly miss them:

| Shape                                        | Example                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- |
| **Hours in a category**                      | Educational activities ≥ 12.5                                     |
| **Hours across several categories combined** | Reviewing performance + measuring outcomes ≥ 25, with ≥ 5 in each |
| **A count of activities**                    | One activity in each of four practice domains                     |
| **A task**                                   | A written development plan; an end-of-year self-evaluation        |

Categories are the national three: **educational activities**, **reviewing performance**,
**measuring outcomes**.

The **four practice domains** — culturally safe practice, addressing health inequities,
professionalism, ethical practice — sit in the national baseline, not in the college overlay.
They are a count requirement with no hours attached, which is exactly the shape an hours-only
tracker cannot hold. (Corrected 2026-09-20; the first draft had them as a college extra.)

**No target is hard-coded.** The owner confirms the set once; the app stores the confirmation
date and the document it came from, and every screen carries that provenance. The app never
looks a requirement up and never changes one quietly.

**Never pro-rata for part-time work.** Working part-time does not reduce the requirement. A
tracker that silently lowered a target would be the most dangerous thing in this design.

**A status transition is a different thing, and it is real.** Admission to Fellowship part-way
through a year, or first registration after the middle of the year, can legitimately change
that year's target — and colleges do it by two incompatible mechanisms: one reduces the target
by the months remaining, another leaves the target alone and grants a block credit with its
own category split. Neither is computed by this app. Both are held as an owner-confirmed
**period adjustment** on the year, carrying its own date, basis and source. Hard-coding either
one would be wrong for half its users.

## 3. An entry allocates hours; it does not pick one box

One activity can genuinely count toward more than one requirement — a peer review meeting is
both reviewing performance and practice improvement, and it also feeds a college peer-review
requirement that runs alongside rather than competing for the same hours. So an entry holds
one or more allocations of `{category, hours}`, and the capture sheet shows the running total
against the entry's stated hours.

Entry fields: date, title, activity type, allocations, a free-text reflection, evidence
attachments, an optional cost, a claimable flag, a "transcribed into my CPD home" flag, the
routine it came from where it came from one, and — where the app captured it — a link back to
what was read.

**The reflection box asks nothing.** A guided question ("what will you do differently?") was
proposed and declined by the owner on 2026-09-20. The label is "Reflection" and the box is his.

## 4. The dashboard

**The first 560 px is a fixed budget** and buys exactly three things: where you stand,
whether you are on pace, and the one action worth taking. Everything else scrolls.

1. **Total hours**, as a bar with a mark at the position you would need to be at _today_ to
   finish on time, and the shortfall between the two drawn as a hatched segment so the gap is
   an object rather than an absence. A bar at 65% looks identical in March and September; the
   mark is what separates them.
2. **The pace sentence**, directly beneath: _"At this rate, 45 hours by 31 December — about
   5 short."_ Flat arithmetic, never coloured, never a judgement. This is the single most
   load-bearing line on the screen, and the one thing that makes a March shortfall visible.
3. **Next** — one row, computed: drafts to confirm, else a routine due, else an unmet
   count-requirement, else the tightest hours gap, else nothing needed. Confirming a captured
   draft beats any form, because the typing is already done.

Then, scrolling: every requirement with what is short, the requirements that are not measured
in hours, routines due now, quick capture, what would not hold up if audited, the dates that
matter, and the provenance line.

### The dashboard has three seasons

The same three elements, doing three different jobs across the year:

- **January** — a rate computed from six days is noise, so the screen says nothing at all
  about pace. The action is writing the development plan.
- **February to November** — pace is the whole point, and the mark carries the screen.
- **The last fortnight** — pace stops being useful; you either finish or you do not. The
  screen becomes the year-end checklist and the action becomes closing the year.

This is one dashboard with conditional content, not three screens.

**Modules are the owner's to hide and reorder**, via show/hide toggles and move-up/move-down
buttons — never drag alone, which is unusable with a keyboard or a screen reader and fails
WCAG 2.2 SC 2.5.7. The repo already has this exact pattern in `use-sidebar-pins.ts`.

Conditionally-empty modules disappear; a module that has never had data shows a guided empty
state instead. A legitimate zero is information and is shown as a zero.

## 5. Routines

Most of a doctor's hours come from the same few things every month — supervision, journal
club, a peer review group. A routine holds the title, cadence, usual hours and usual
allocation, so logging it is one tap from the dashboard.

**A routine never logs itself.** It offers; the owner confirms. Only he knows whether he was
actually there, and a tracker that auto-filled attendance would be producing a false record.

## 6. Capture

**Owner decision, 23 September 2026: explicit capture only.** The doctor opens an activity
form, optionally prefilled from a routine or an explicitly selected source, checks duration
and allocation, and saves. Opening a document never creates an activity or starts a timer.
There is no passive reading history, automatic attendance or automatic daily draft.

Search text is never copied into a learning record. A source-document link means "what I
read", not "evidence attached". Certificates and assessment uploads belong to the separately
planned private vault, not the clinical upload/ingestion route. Until that vault exists,
screens must not claim an attachment is present or offer a button that pretends to attach one.

## 7. Evidence, and what it cost

Certificates, photographs and receipts live in a vault that **structurally cannot reach
clinical search**. `/api/upload` cannot be reused: it is administrator-gated, rejects JPEG and
PNG, and unconditionally enqueues ingestion, which would make a conference certificate
retrievable as clinical evidence. Reuse the owner-namespaced storage path and the signed-URL
helper; do not reuse the ingestion enqueue.

An entry with no evidence is marked, never blocked.

**An optional cost on each entry.** Conference fees, courses, journals and college dues are
deductible, and the receipt is already being stored beside the certificate. One optional field
turns the same vault into the tax-time folder, and gives a second reason to attach something —
which is the cheapest available fix for the missing-evidence problem. The year's total appears
on the export and nowhere else; this is a by-product of good record keeping, not a finance
feature.

## 8. Renewals

No Australian product ties registration renewal, indemnity cover, working-with-children
checks and mandatory training into one expiry view; they live in email, a wallet card and a
hospital system. They belong here because CPD compliance is declared at registration renewal.

Every date is one the owner entered. The app does not look them up and does not know when
they change, and says so.

## 9. The year end

**Audited today** answers one question: if someone asked for the record this afternoon, what
would not hold up? Entries with no evidence, an unmet requirement, an unwritten
self-evaluation. Where there is a button it offers one; where there is not — a category that
needs an activity rather than a tap — it says so instead of pretending. The screen carries one
unmissable line: this is the app's reading of his own record against his own confirmed
targets, not advice, and not a statement of what a regulator would ask for.

**Finalisation is planned separately from the core workflow.** The owner's 23 September 2026
decision replaces an irreversible lock with an immutable snapshot and explicit, dated
amendments carrying a reason. An amendment preserves the original and produces a revised
export. The next year asks for targets to be confirmed again; unfinished goals may carry
forward, but hours never do. Existing closed-year records remain protected from ordinary edits.

Closing also accepts **a note explaining a shortfall** — leave, illness, anything. The note
goes on the record, where an explanation belongs. It does not reduce the requirement, and the
screen says that too.

## 10. In training

A doctor in an accredited training programme is **deemed to meet the CPD standard by the
programme itself**; there is no separate hour count. So for a trainee the app tracks the
programme.

The dividing line is not seniority. It is **enrolled in an accredited programme, yes or no** —
and it can change mid-year, and retroactively. An unaccredited service registrar carries the
full specialist requirement. A trainee on a long break can lose cover for a year that looked
covered. So the app models an **enrolment timeline** and resolves each requirement against the
state that held on each date, rather than a role field, which would be wrong for a meaningful
share of users a meaningful share of the time.

A trainee needs four requirement shapes a specialist never does:

| Shape                                | Why an hours model cannot hold it                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A cadence with a coverage window** | An hour of supervision a week across forty weeks fails by distribution, not by volume. Two hours next week does not repair a week with none in it, so the app must show missed periods, not a total. |
| **A count scoped to a container**    | Assessments per activity, one observed activity per rotation. The key is compound, not a year-wide sum.                                                                                              |
| **A judgement, not a sum**           | The prevocational year ends in a panel decision with no minimum number of assessments to pass. A requirement whose outcome is entered rather than aggregated.                                        |
| **A due date on a training clock**   | Milestones fall due at a number of full-time-equivalent months, which pauses on breaks and halves at 0.5. The app must carry that clock beside the calendar and translate between them.              |

Rotations are the container almost everything else hangs from: dates, full-time fraction,
supervisor, and an end-of-rotation submission whose deadline is derived from the rotation's
end rather than entered.

**Employer mandatory training belongs on the renewals page, not here**, and it re-triggers
every time a trainee changes hospital — which is the one place a trainee's burden is heavier
than a consultant's, and the one no college system shows.

## 11. What comes out

1. **Copy for your CPD home** — per entry, fields on the clipboard in the portal's order,
   then the entry is ticked as transcribed. Built first; it is the control that gets pressed
   a hundred times.
2. **A summary document**, ordered by requirement, totalled. Use the repo's existing
   `PrintSection` / `PrintOutput` rather than writing a PDF generator.
3. **An evidence bundle**, a spreadsheet with a cost column, and an audit pack that is all of
   the above in the order someone would ask for it.

## 12. What this deliberately does not do

- **No streaks, badges or confetti.** Leave and illness break chains, and the evidence is
  that streak mechanics make people quit.
- **No red.** A shortfall is position, weight and words. `docs/design-system/TOKENS.md`
  reserves the clinical status colours for clinical states, and GOV.UK's own research found
  red status tags on this exact kind of checklist harder to read and anxiety-provoking.
- **No ring or gauge.** `Progress` is the only sanctioned progress primitive and a bar with a
  target mark says more in less space.
- **No daily reminders.** Two in-app banners a year, one at a time, each dismissible and
  snoozable, escalating by specificity rather than colour. The app has no notification
  channel today and building one for two messages a year is not worth it.
- **No guided reflection question.** Declined by the owner, 2026-09-20.
- **No pro-rata for part-time work, and no carry-over of hours between years.** Unfinished
  plan goals do carry forward; hours never do.

## 13. The design system for these screens

One stylesheet, shared verbatim by every board, so twenty-one screens read as one product.

- **Colour.** One accent — `--tone-indigo` `#43508f`, already sanctioned in
  `src/app/ckb-v2-tokens.css` — and a neutral ramp biased very slightly toward it, so the
  greys read as chosen rather than inherited. No second hue anywhere.
- **Dark is designed, not inverted.** The same token names are re-pointed for night; the
  accent lifts to `#97a3df` so it still carries on a dark ground. The boards include a
  side-by-side so the two can be judged together, because most of this app's on-call use is
  after dark.
- **Type.** Geist, at a phone scale rather than a desktop one: 15 px body, 13 px meta, 11 px
  eyebrows. The first draft's 13/12 was a desktop habit and was too small to read one-handed.
- **48 px is the floor for anything tappable**, matching the repo's `min-h-12` production
  rule. The first draft used 44 throughout.
- **Not everything is a card.** One card carries the screen's subject; lists are flat panels
  on a tinted ground; exactly one accented block per screen carries the thing that matters.
- **Figures are tabular** wherever they line up in a column.

## 14. Evidence status of the numbers in the drawings

**Corroborated, not verified.** Two research passes have now been run from this environment,
on 2026-09-19 and 2026-09-20. The second reached no primary source either: the egress proxy
blocked every direct fetch attempted — `medicalboard.gov.au`, `ahpra.gov.au`, `ranzcp.org`,
`racp.edu.au`, `amc.org.au`, `mdanational.com.au` and others — including neutral control
domains, so the block is indiscriminate rather than specific. Web _search_ worked, so
everything below is search-relayed text, not a read page.

The national figures (50 total; ≥ 12.5 educational; ≥ 25 reviewing and measuring combined
with ≥ 5 in each; 12.5 self-allocated; a written plan; an end-of-year self-evaluation;
three-year retention; a CPD year running 1 January to 31 December) were consistent across
several independent sources.

The trainee material in section 10 comes from the same second pass and carries the same
limit. Its _shapes_ — a weekly cadence, container-scoped counts, a panel judgement, an
FTE-month clock — were consistent across several colleges and are what the data model is
built on. Its _figures_ were not checked against a source page and must not be shown to
anyone as authoritative. One conflict is unresolved: record retention is given as three years
in one place and five in another.

Sections 2 and 10 are the mitigation, not a caveat. The app never asserts a requirement;
it holds the owner's confirmed numbers, with the date and the document he confirmed them
against, and shows that provenance on every screen that displays a target.

---

## 15. The demo corpus, and one number the drawings get wrong

The synthetic corpus in `src/lib/cme/demo-year.ts` is what every screen renders before a
database exists, and what the browser tests and pixel baselines assert against. It is 47
entries totalling **32.5 hours**, on a frozen instant of 19 September 2026.

**The drawings say educational 15.0. The build says 22.5, and the build is right.** Only
three categories exist, so the year's total _is_ the sum of the three — that is an identity,
not a coincidence. `15.0 + 8.0 + 2.0` is 25.0, which cannot coexist with a 32.5-hour total:
7.5 hours would have nowhere to live. Holding reviewing at 8.0 and measuring at 2.0 — the
pair the design uses to show one floor met and one not — forces educational to 22.5. Found
while building the corpus, 2026-09-20.

**Correction, 23 September 2026: formal peer review is measured in hours.** The
[RANZCP CPD overview](https://www.ranzcp.org/cpd-program-membership/cpd-program/cpd-overview),
read directly on 22 September UTC, specifies at least 10 hours. Seven peer-review hours can
be a subset of eight reviewing-performance hours; the earlier claim that these figures
conflicted was incorrect. Qualifying hours contribute to the specialist requirement without
adding to the activity's total a second time. Session attendance may be recorded as a routine,
but a session count is not a replacement for the hours requirement.

The starting preset covers the Australian baseline plus the psychiatry peer-review
requirement. It is not the complete RANZCP CPD-home programme: the doctor must confirm any
additional CPD-home requirements. Saved years are never silently replaced by a newer preset.

Per this file's own rule, where it and a drawing disagree, this file wins. The boards carry
the old figure and should be re-exported when they are next touched; nothing in the build
reads them.

The synthetic record retains 47 entries and 32.5 allocated hours. Earlier drawing labels
claiming "evidence" from a document link are superseded: source links and private evidence
attachments are separate facts. Current tests must assert the implemented record, not those
obsolete labels. The artwork is historical design material, not evidence of functional or
hosted acceptance.

## 16. Core workflow repair, 23 September 2026

The first implementation milestone completes requirement confirmation, private activity
capture and correction, practice-domain selection, explicit routine attendance and
previous-year access. Signed-out, unconfigured and unavailable records have separate
states. A database outage must never appear as an empty year inviting replacement.
Private server-rendered screens are bound to their verified owner: sign-out, unresolved
authentication or a different account hides them immediately and resets local drafts.
Source links are reading provenance; private evidence uploads remain separate future work.
Routine archiving is available; activity archiving remains outstanding and is not claimed
as part of this repair. The existing copy-to-CPD workflow is distinct from the planned
spreadsheet, evidence-bundle and finalisation exports.

Requirement confirmation and activity saves are transactions. An activity's qualifying
peer-review credit is contained in its reviewing allocation, and retrying the same save
does not create another activity or advance its routine twice. Closed years reject ordinary
edits. Immutable finalisation and dated amendments remain a later milestone.

The matching migration and schema projection have been replayed in a disposable local
PostgreSQL database. Synthetic transaction checks cover rollback, retries, routine
advancement, owner boundaries and closed-year rejection. This is local evidence only.
The new completeness constraint rejects the earlier application's separate entry and
allocation writes, so an owner-approved, coordinated application/schema rollout window is
required. A rollback must likewise account for that writer incompatibility. Merging the
migration into `main` applies it to production; no publication or merge is part of this
local implementation milestone.

The connected On call repair preserves the existing public/private model while fixing
stale empty reads, legacy private browser-cache persistence, optional-field clearing,
extension handling and exact-result navigation. It does not introduce service memberships
or turn existing public entries into an invitation-only handbook. Source lookup uses the
existing permission-checked document route. The public seven-day cache is not the proposed
approved offline-pack feature.

## 17. Records, evidence and connected learning, 23 September 2026

The next implementation adds activity archive and restore, selected-year spreadsheet
export and a printable annual summary. Archiving preserves the activity, allocations,
source and evidence while excluding it from active totals and exports. Closed years
reject archive, restore and new attachments. Exports fail explicitly when the complete
owner-year record cannot be retrieved; they never silently export a truncated result.
Finalisation snapshots, amendments and an evidence ZIP remain outside this addition.

Evidence is owner-private PDF, JPEG or PNG in a dedicated private storage bucket, with
bounded uploads, signature/type checks and explicit local preview and redaction
confirmation. The app does not detect anonymity, OCR, index or process these documents
with AI. A reading URL never counts as evidence. Downloads require an owner check and
use a short-lived signed URL. Unknown upload completion preserves the object for
reconciliation; compensation is limited to uploads known not to have committed metadata.
There is no automatic deletion of personal evidence or offline evidence cache.

Teaching and handbook resources offer an explicit learning link. It prefills the title
and source only. The doctor supplies duration and allocations and saves deliberately;
opening or reading a resource never implies attendance. Service membership gives no
access to this private record. New schema changes are prepared locally; publication,
owner-approved production merge and hosted acceptance remain separate actions.

## 18. Year close, 25 September 2026

Section 9's finalisation is now built in its smallest honest form. Closing is done from the
annual summary, in the last fortnight of the year or at any time afterwards, and asks first.
The database reads the year's confirmed targets, requirements and active activities under the
owner lock and freezes them as a snapshot, with the app's requirement statuses beside it; it
refuses the close if any target, requirement or active-activity evaluation input changed after
those statuses were computed. This includes category allocations, formal peer-review credit,
practice-domain buckets and task completion. Direct requirement and allocation writers take the
same year lock as closing, so the comparison and snapshot describe one coherent record.
An optional note explaining a shortfall is stored on the year and in the snapshot, and the
screen says that it does not reduce any requirement. A closed year cannot be reopened.

After closing, an activity is corrected with **Amend entry**, which takes the complete record
and a reason. The database stores the previous version, the new one and the reason, dated,
before applying the change, and refuses any other write to that year's activities,
allocations or requirements. Copying a closed activity's text remains available, but its recorded
copied status cannot change through an ordinary update. The Log's copy sheet explains this and
offers the next activity without a marking action. The snapshot never changes; the annual summary shows it, the note,
and every amendment, while its totals and the CSV export follow the amended record.

Full manual edits and amendments carry the stored content the editor read. The database
compares that content under its owner and entry locks before replacing fields or recording an
amendment, and asks the owner to reload if another writer changed it. Allocations and the
current copied/archive flags participate in that comparison; evidence and goal links do not,
because the full editor does not replace them. This is current-content equality: changes that
return to identical content are equivalent, rather than a monotonic mutation-history version.
Teaching's intentional create/restore writer remains separate and owner-locked. Versioned RPCs
make a missing migration fail closed; the migrations must precede the application release.

Not built: adding a new activity to a closed year, amending an archived activity, a separate
"as closed" export, carrying unfinished plan goals forward, and the evidence ZIP. The schema is
a new migration and so merges only with the owner's approval.
