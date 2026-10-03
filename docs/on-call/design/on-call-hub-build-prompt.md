# Build the On Call hub redesign in PsychSift

Repository: `BigSimmo/Database` (PsychSift). Branch from the latest `origin/main`.

Read `AGENTS.md` and `CLAUDE.md` first — they are binding. Read
`docs/superpowers/specs/2026-09-04-on-call-mode-design.md` (the shipped On Call design) before
writing code. The owner-reviewed content list is the mockup below; no separate brainstorm spec
is committed in this repository.

**Read the mockup before you write any code.** It is committed in this repository at

    docs/on-call/design/prototypes/on-call-screens.html

A single self-contained HTML file: eleven 390px phone artboards drawn in the app's real
tokens, each with notes explaining the decision behind it. Open it in a browser, or read the
markup directly — the CSS comments cite the components each piece of chrome was copied from.
It is the visual source of truth for everything below; where this prompt and the mockup
disagree, the mockup is a drawing and this prompt is the specification.

**How the build stays honest about it.**
[`mockup-conformance.md`](mockup-conformance.md) records every element of all eleven boards
against one of four dispositions — built, open, a deliberate departure with its reason, or
waiting on the database change — and `tests/on-call-mockup-conformance.test.ts` fails the
build when the drawing and that record drift apart. A departure from the drawing is allowed;
an unrecorded one is not. Change something here and the ledger is where it is settled.

---

## 1. What exists today

The `on-call` mode already ships with six sections — Contacts, Playbook, Referrals,
Orientation, Education, Logistics — backed by one table, `public.on_call_entries`, with a
`section` enum, per-section `details` JSONB validated by Zod, a 12-month freshness stamp, a
printable card at `/on-call/card`, local search at `/on-call/search`, and an offline cache of
contacts. Reads are public (the 2026-09-04 amendment); only `is_personal` rows stay private.
Writes require an account.

## 2. What to change

### 2.1 Navigation — adopt the Therapy `ModeNav` rail

Replace On Call's current secondary navigation with the shared priority-navigation rail.

- Use `src/components/mode-nav/mode-nav.tsx` and `nav-slot-ink.tsx` **as they ship**. Do not
  fork them, do not add an On Call variant, do not restyle the ink.
- Slots, in order: **Tonight** (the mode home), **Contacts**, **Playbook**, then **More**.
  Everything else — Referrals, Forms, Orientation, Teaching, Logistics, Pocket card — lives in
  the More sheet. Register the density profile and record its evidence, as the nav contract
  requires.
- When the active route is inside the overflow, the rule sits under **More**. That is the
  component's existing `data-active-from` behaviour; do not reimplement it.
- Never abbreviate a label — a slot shows its real word or folds into More.
- **No counts on the rail.** An earlier draft of this prompt asked for `Contacts 42`, which
  contradicts the component's own contract: `ModeNavItem.count` is documented as "state, not
  size — a fill like 3/4, never a catalogue total". Using it as this mockup draws it would mean
  forking the component the line above says to use as it ships. The counts live where they read
  as size instead: the More sheet and the home's section tiles.

> **This reverses a decision the code records, and that is deliberate.** `mode-secondary-navigation.ts`
> carried an empty registry for On Call with a note saying the bar "could never render" here,
> because every route in this mode is an information page and `PageSecondaryNavigation` returns
> null for those. The note is accurate about the SHELL and wrong about the conclusion: a page that
> owns its header navigation mounts the rail itself, which is what `differential-presentation-workflow-page.tsx`
> already does. The 2026-09-04 design spec §8.3 always intended this mode to join the adopted-nav
> set. Say so in the PR body rather than leaving a reviewer to find the contradiction.

### 2.2 Header — the universal header's shape, unaltered

Keep `MasterSearchHeader`'s three regions exactly as they are: hamburger, centred mode pill,
right-hand control. Two things change behind that shape, and both must be built so the other
sixteen modes render identically.

- **The right-hand control becomes the page menu** for this mode — the same bordered round
  button that carries "new chat" everywhere else. That region hard-codes one control for all
  seventeen modes, so it needs a real extension point: a DOM slot a page portals into, with CSS
  standing the new-chat button down while the slot is occupied. Not a `searchMode === "on-call"`
  branch in the header — that is how one row becomes sixteen variants.
- **The mode pill opens this mode's own pages first** (owner decision, 2026-09-12), drawn
  exactly like the mode switcher everywhere else — same rows, same tiles, same check disc — with
  a back control to the full mode list and an "All modes" row at the foot. Gate it on the mode
  declaring no results surface rather than on a mode id. Keep the section level outside the
  roving-tabindex machinery: it is ordinary links in ordinary tab order, and threading a second
  row kind through focus code shared by every mode buys nothing.

### 2.3 No search composer in this mode

On Call declares no search surface. Remove the composer from every On Call route and the
mode's search registration, keeping the one-composer-owner contract in
`docs/search-chrome-behaviour.md` satisfied. Filter chips inside a page do the narrowing.
Delete `/on-call/search` and its registry entry, or reduce it to a redirect — your call, but
leave no orphan route and no dead registry row.

What actually removes the composer is taking `/on-call` out of `consolidatedModeHomePaths`:
that map pointed the bare path at the shared home, and the shared home is the one place in this
mode a composer appeared. `/tools`, `/favourites` and `/medications` are already absent from it
for the same class of reason. Add `standaloneModeHomeHref` too, or the mode pill will keep
retargeting a composer with nowhere to submit.

### 2.4 No bottom toolbar

Remove it. The reclaimed space (~68px) goes to content. Update the phone-scroll route lists
and the reserve helper together, per the search-chrome guards.

### 2.5 Home becomes a modular dashboard at `/on-call`

Eight modules, in this order. Each has a monospaced uppercase label and an optional trailing
action.

Two of them — **Shift** and **Quick** — cannot be built before the database change, so they land
with it: Shift needs the site's name, hours and wards, and Quick's second action is a Forms
link. Everything else ships in the first change.

1. **Shift** — site name, hours, wards covered, and a progress bar with "started HH:MM" and
   "Xh Ym to handover". The only module tinted in the mode accent. Carries the site switcher.
2. **Call first** — two graphite (`--command`) call cards (nurse manager, registrar on call)
   each showing availability, plus a quieter switchboard row.
3. **Your wards** — a horizontally scrolling strip of tonight's wards with their extensions,
   each a one-tap dial.
4. **Pinned reminder** — an accent card carrying "You are expected to wake the consultant",
   with the condition beneath it, linking to the Playbook ladder.
5. **Recent** — the last few entries opened or dialled, newest first, with a Clear action.
   **Store this in browser storage only**, via `createBrowserStore`
   (`src/lib/client-store-factory.ts`), following `saved-registry-storage.ts`. Never send it to
   the server. Clear it on sign-out, exactly as the contacts cache does.
6. **Coming up** — the next teaching session and the next handover. Ordering needs a date:
   `education.details.nextOccurrence` is free text ("Thursday 1pm") and cannot be ranked, so add
   an optional ISO `nextOccurrenceDate` beside it. `details` is JSONB, so this costs no
   migration. An undated session stays on the Teaching page rather than appearing here.
7. **Quick** — Pocket card and Claim overtime. **Not "Wrong number"**: §2.8 forbids building the
   wrong-number report, because it needs a signed-in tier that does not exist, and the mockup
   draws it anyway.
8. **All sections** — an 8-tile grid: the seven sections plus Who's who, each with a count and
   a four-word description.

Each module is derived from a **tag the owner controls**, not a new column: `call-first`,
`switchboard` and `ward` on contacts, `pinned` on a playbook scenario. One convention rather
than four ad-hoc ones, no migration, and the owner can change what the home shows from inside
the app. Every empty state names the tag that fills it.

**Do not put a freshness warning on Home.** Overdue entries surface on Contacts, where the fix
is one tap.

### 2.6 New sections

- **Forms** — a new `on_call_entries` section. **This needs a migration**, so it ships with the
  database change rather than before it: `section` is a CHECK constraint over six literals and a
  seventh value cannot be added without SQL. `details`:
  `{ category, whoSigns?, turnaround?, medium: "online" | "paper", url?, physicalLocation? }`.
  Rows render three metadata chips (who signs / how long / online or paper) on the 40px compact
  rung. Rows that leave the app show an external-link glyph, not a chevron. The hub links to the
  official current version and never stores a copy.
- **Who's who** — reuse the `contacts` section with a new `details.kind: "role-explainer"`.
  Holds what each role does and when to call them, the on-call ladder, and WA Health acronyms.
  Give it a route and put it in the **More sheet**, not only the home's tile grid: the mockup
  shows it as a tile alone, which leaves it unreachable from every section page. Make `kind` a
  literal rather than a free string, so an unrecognised value fails validation instead of
  quietly becoming an ordinary contact and joining the dialling list.
- Rename the existing `education` section's UI label to **Teaching**. Keep the stored enum value
  `education` — do not migrate the enum for a label change.

### 2.7 Site scoping

Add a site concept so every section filters to one site.

- New nullable `site` text column on `on_call_entries`, plus a small owner-scoped `on_call_sites`
  table (id, owner_id, name, description, sort_order) following the
  `clinical_registry_records` template exactly: RLS enabled, privileges revoked from `anon` and
  `authenticated`, granted to `service_role` only, one service-role policy, ownership enforced in
  the API layer with the owner predicate on the same fluent chain so `npm run check:owner-scope`
  can prove it.
- The chosen site persists per browser and is named in the Shift module and the page menu.
- Entries with no site show at every site.

### 2.8 Privacy — non-negotiable

On Call is world-readable. `is_personal` rows are the only private ones.

- The following must default to `is_personal` and render a visible **Private · only you** lock:
  after-hours entry and door access, which wards are locked, on-call room access, and any entry
  naming an individual rather than a role.
- The editor must **refuse to save a credential** in any field, at any privacy level: reject
  Wi-Fi passwords, door keycodes, PINs and remote-access secrets with a clear inline error.
  Write the validator and its test first.
- The teaching join link and the wrong-number report both require a signed-in tier that does not
  exist yet. **Do not build either.** Render the join link as a disabled control with the reason
  beneath it, and leave the report out entirely.
- A personal entry's digits are never rendered, not even masked, on a public read.

### 2.9 Clinical boundary — non-negotiable

- No component in this mode ships hard-coded clinical instruction text.
- Playbook cards render clinical guidance only as links to the owner's own documents, each with
  the document's title and date.
- A scenario with no linked guideline renders the explicit "no local guideline linked" state
  offering a document search. It must never fall through to generated content.
- Escalation ladders are administrative fact — who to call, when, and a number. That is allowed.
- Handover and orientation entries stay process-only. Nothing in this mode may become a patient
  list or identifiable clinical handover.
- Owner exception (3 Oct 2026, PR #3220): the quick call log on Call may hold patient identifiers
  the registrar types. They stay in the private on-device patient-label store only, are wiped at
  the end of the shift and at sign-out, and are never sent to a provider, a log, analytics or a URL.
  The log is a private working note, not a patient list: only the notes still open leave the device,
  and only when the reader copies the handover. Everything else in this mode stays process-only.

---

## 3. Design rules the gates enforce

- **Tap targets are 48px** (`min-h-tap` / `--spacing-tap`). Never 44 — it reintroduces a known
  `ui-smoke` flake. The 40px compact rung is for metadata chips only.
- **Design tokens, not hex.** `eslint-rules/no-hardcoded-hex.mjs` plus the type-scale,
  icon-scale, z-index-ladder and lucide-icon-aria rules all run.
- **Radius ladder**: chips 6, controls 10, cards 12, sheets 16.
- **Status never by colour alone** — every warning, private and success state carries an icon
  and words. Never paint a number in a status colour.
- **The mode accent is not a navigation channel.** `category-identity.ts` is explicit: purple is
  a within-surface category colour, navigation stays unpainted. The rail's rule and the active
  ink use `--clinical-accent`. Purple appears only in content — the Shift module, selected sheet
  rows, escalation step badges, section tiles.
- New overlays go through `components/ui/sheet.tsx`. Do not add a z-index rung.
- Every new page is declared once in the design-system adoption manifest with its five proofs:
  dark, forced colours, 320px, print, browser.

---

## 4. Ship it in three pull requests, in this order

**Change 1 — navigation, chrome and the dashboard.** The rail, the header's page menu, the mode
pill opening this mode's pages, removing the search composer and the bottom toolbar, the home
dashboard, Who's who, Recent, the Teaching label, and the route/registry/manifest updates that
follow. No schema change, so this can merge any time.

**Change 2 — the database.** One migration: the `forms` section value, `site` on
`on_call_entries`, and the `on_call_sites` table. With it: the Forms section, site scoping, the
privacy defaults, the credential validator, and the two home modules that need site data (Shift
and Quick).

> Owner decision, 2026-09-12: two changes rather than three. Forms moved out of the first change
> because a new section value needs SQL — the original three-PR split assumed it did not.

> **Merging a migration reaches the live clinical database within seconds, with no deploy step.**
> Do not enable auto-merge on PR 3. Do not write any PR text promising a deferred deploy —
> `scripts/pr-policy.mjs` hard-blocks that phrasing. State the merge decision instead: "merge
> only inside the approved window." After it merges, the post-merge `live-drift` workflow must
> complete with both `npm run check:drift` and `npm run check:migration-history` green.

Each PR carries `RAG impact: no retrieval behaviour change — operational content mode; no change
to retrieval, ranking, the RPCs, or the eval fixtures.`

---

## 5. How to work

- **Test first.** This repo practises TDD. Write the failing test, then the code. Start with the
  credential-rejection validator, the private-by-default classification, the site filter, and the
  Recent store's clear-on-sign-out.
- **Commit as you go.** Commit each coherent unit — a module and its test, a fix and its proof.
  Never `git add -A`. If you must stop, say in your next message exactly what is uncommitted.
- **Run the smallest gate that covers the change**, then widen: `npm run test:focused --
--files <paths>` while iterating, `npm run verify:pr-local` before pushing. Use
  `npm run plan:browser` to narrow the browser suite rather than running `verify:ui` whole, and
  `npm run verify:phone-chrome` for the chrome changes in PR 1.
- **Run `npm run format` and commit the result before every push.** Formatting is in neither
  `test`, `typecheck` nor `lint`, and the changed-file CI check will fail without it.
- **Paste the decisive line of real output** when you report a gate as passing. Exit code 0 alone
  is not proof. A deferred gate is not a passed gate — say "deferred to CI".
- **Never weaken a test to get green.** Do not skip, disable or quarantine anything.
- Anything touching OpenAI, Supabase, hosted CI or production needs explicit confirmation before
  you run it. Report the command and ask.

---

## 6. Decisions taken, 2026-09-12

The two questions this prompt left open were put to the owner and delegated back:

1. **Recent** is built. Browser storage only, capped and deduped, cleared on sign-out through
   the one existing sign-out path — and it stores an entry id, a title and a time, never a
   number. The digits are read from the live entry when a row renders, so a personal number
   cannot outlive the session on a shared ward phone.
2. **Forms gets its own section**, not two Logistics categories. The mockup gives it a whole
   artboard with its own filter chips and metadata chips, which does not fit inside Logistics.

Start with change 1. Report what you changed, what you ran, and what you deferred.
