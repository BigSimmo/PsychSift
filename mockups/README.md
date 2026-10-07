# Project Mockups

This folder collects notes for mockup routes that live under `src/app/mockups/`.

## Authoritative route list

The generated route map in [`docs/site-map.md`](../docs/site-map.md) (mockups section) is the source of truth for runnable mockup URLs. Regenerate it after adding or removing mockup routes:

```bash
npm run sitemap:update
npm run sitemap:check
```

## Mockup index, by topic

A quick-scan catalogue of every route under `src/app/mockups/` and what state it's in, so
nobody has to open every folder to find out what's still useful. `docs/site-map.md` remains
the authoritative list of exact live paths (regenerate it after any change here); this
table exists to group those paths by topic and record a status for each one.

**When a mockup may be deleted, and by whom, is
[`docs/mockup-retirement-policy.md`](../docs/mockup-retirement-policy.md).** This index is the
record that policy gates on, and `npm run check:mockups` fails when the two drift apart.

**Status key** — _Prototype app_: a full working tool, not a design sketch, out of scope
for cleanup. _Chosen design_: the direction that was picked; still runnable for reference.
_Active study_: still-relevant design work with no single "winner" yet, or reference
material behind a chosen design. _Redirect_: a legacy URL kept for compatibility.
_Superseded — recommend removing_: explicitly and in writing replaced by a later version,
with no other mockup depending on it. _Parallel draft, no recorded winner_: one of several
competing drafts on the same brief where nothing in the repo says which one (if any) was
picked — kept as-is rather than guessed at.

### Full prototype apps (out of scope for cleanup)

| Route            | What it is                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `development/**` | Developer hub — reads repo status (docs index, ingestion status, task ledger, review records, route map). Linked from Settings for signed-in admins.                                                             |
| `care-plan/**`   | Fully synthetic care-planning prototype (management/patient/safety plans, presentations, review), richly cross-linked.                                                                                           |
| `work-roles`     | Preview-only work-mode role switcher (junior doctor, reviewer or supervisor, admin). Links to each role's screens on sample data, never changes real permissions. Blocked in production with every other mockup. |

### Redirects

| Route                    | Forwards to                |
| ------------------------ | -------------------------- |
| `favourites-hub`         | `/favourites`              |
| `medication-prescribing` | `/medications/acamprosate` |

### Favourites page

| Route                        | Status                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `favourites-phone-perfected` | Chosen design (2026-08-27) — see the write-up above.                                                                                        |
| `dsm-favourites`             | Active study (2026-09-07) — save a DSM diagnosis to favourites. Open decisions only; nothing wired. Blocks on a check-constraint migration. |

Six earlier studies (`favourites-command-console`, `favourites-command-desk`,
`favourites-library-view`, `favourites-review-console`, `favourites-set-board`,
`favourites-set-navigator`) were removed on 2026-08-27, along with their shared
component folder `favourites-page-mockups/` — confirmed superseded by
`favourites-phone-perfected` and confirmed (by import search) to have no other
route depending on them before removal.

### Services filter surface — three sequential rounds, keep together

| Route                     | Status                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `services-filter-refined` | Round 1. Round 2 imports its facet engine, chips and sheet shell — do not remove independently. |
| `services-filter-options` | Round 2, builds on round 1's code.                                                              |
| `filter-sheet-restyle`    | Round 3, a craft pass on the same decision.                                                     |

### Tools page

| Route                                                                                                                                                                                                                              | Status                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools-search-mode`                                                                                                                                                                                                                | Chosen design — "Perfected Tools search mode" per this README.                                                                                                                                |
| `tools-search-directions`                                                                                                                                                                                                          | Shipped — direction A landed in #1958. Issue `#162` closed 2026-08-15; the file is kept because `tests/tools-search-directions-mockups.test.ts` compares it against the live tools catalogue. |
| `tools-action-workbench`, `tools-clinical-lanes`, `tools-command-center`, `tools-split-clinical-brief`, `tools-split-compact-sheet`, `tools-split-pane`, `tools-split-safety-deck`, `tools-task-directory`, `tools-workflow-board` | Parallel drafts, no recorded winner — nine different Tools-page layout directions.                                                                                                            |

### Privacy page

| Route                           | Status                                                      |
| ------------------------------- | ----------------------------------------------------------- |
| `privacy-live-signal-perfected` | Chosen design.                                              |
| `privacy-page-directions`       | Active reference — the full study behind the chosen design. |

### Specifier record page

| Route                         | Status                                                               |
| ----------------------------- | -------------------------------------------------------------------- |
| `specifier-record-directions` | Active study (2026-09-06) — three directions, no build decision yet. |

Review study for `/specifiers/[slug]` (`SpecifierReferencePage`), opened because the live page
spends its first screen and a half restating one fact — that the definition is unverified — in
six separate places, while the only new content it carries (the ICD-11 6A20 qualifier list) sits
roughly 1,200 px down. The specimen is
`multiple-episodes-currently-in-full-remission` (Schizophrenia · Course & Status); every label,
group membership, sibling set and the ICD-11 line come from `data/specifiers-content.json`.

| Direction               | Verdict     | What it is                                                                                                                                                               |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01 Course matrix        | Recommended | Course & Status drawn as the two-by-three grid it actually is (episode pattern by current state), with `Continuous` and `Unspecified` shown as sitting outside that grid |
| 02 Clinical record card | Densest     | One hairline-ruled term/value card, no icon tiles, no sidebar, provenance behind a disclosure                                                                            |
| 03 Documentation line   | Task-led    | Leads with the assembled diagnostic wording plus live severity and catatonia controls, caveat attached to the copy control                                               |

The recommendation is 01 with 02's provenance disclosure folded in, and 03's wording band added
only once the assembled line has clinician sign-off — it is composed from catalogue labels, not
from verified DSM-5-TR text. No direction displays a generated clinical definition: the catalogue
withholds every one of them pending qualified clinician review, and that constraint is the brief
rather than a hole to fill.

### Document navigation pane — five rounds, no recorded winner

**Corrected 2026-09-02 — there is a winner, and the earlier "no recorded winner" reading was
wrong.** Commit `6230c4db` (#1311) added all five drafts _and_ the production implementation
together, which is why the dates looked undifferentiated.

| Route                              | Status                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document-navigation-perfected`    | **Shipped.** Its weighted `flexGrow: section.weight` track and `pending` spinner exist in `document-viewer/section-nav.tsx` and in no other draft; rule 22 of `docs/search-chrome-behaviour.md`, added by the same commit, names that "weighted position track".                                                                                                                                   |
| `document-navigation-contract`     | Active reference — superseded as a build, but it is the origin of rule 22 and keeps that rule's illustrated rationale.                                                                                                                                                                                                                                                                             |
| `document-navigation-final-review` | Retired 2026-09-02 — unweighted track, no pending state.                                                                                                                                                                                                                                                                                                                                           |
| `document-navigation-final`        | **Partly adopted — kept.** Its two-column grid was reversed by the review round, but production `document-viewer/section-nav.tsx:143` uses ITS heading (`flex items-baseline justify-between px-0.5 pb-2`), a string found in exactly two files repo-wide and absent from `perfected`. Production is a hybrid of the two, so this is not superseded. Restored 2026-09-02 after adversarial review. |
| `document-navigation-pane`         | Retired 2026-09-02 — `section-nav.tsx` refuses its thesis in the same commit that added it.                                                                                                                                                                                                                                                                                                        |

### Document phone chrome — four rounds, no recorded winner

**Corrected 2026-09-02.** None of the four shipped: the phone header shipped from
`document-navigation-perfected` above. `document-phone-zero-chrome` supplied the "zero new
chrome, sheet not pane" contract but not the drawn row.

`document-phone-title`, `document-phone-title-refined`, `document-phone-fused-directions` and
`document-phone-title`, `document-phone-title-refined` and `document-phone-fused-directions`
were retired 2026-09-02.

`document-phone-zero-chrome` is **kept, unresolved.** Its "zero new chrome, sheet not pane"
contract is live (rule 22, and `section-nav.tsx:227-229`), but the kept
`document-navigation-contract` carries that same thesis verbatim, and both landed in the one
squash `6230c4db` so git cannot say which authored it. It also uniquely holds the numeric
chrome-budget comparison that is the quantified case against the rejected fused row. It was
proposed for retirement on 2026-09-02 and withdrawn after adversarial review returned
UNCERTAIN — the policy's negative rule applies: an unevidenced generation is asked about, not
retired.

### Document search & viewer

| Route                                                                          | Status                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `document-search` (+ `search`, `source`, `source/evidence`, `source-overlays`) | Active reference — the master runnable document-search flow. `/issues` `#008` records that removing it "breaks the build": it is what keeps `documentReaderHref`/`documentEvidenceHref` alive. The handoff into the real document viewer is built by the master module, **not** by `source-overlays`, which contains no hrefs at all (corrected 2026-09-02). |
| `document-search-evidence-lens`                                                | Parallel draft, no recorded winner.                                                                                                                                                                                                                                                                                                                          |
| `document-search-triage-board`                                                 | Parallel draft, no recorded winner.                                                                                                                                                                                                                                                                                                                          |
| `document-top-navigation`                                                      | Active study — three nav concepts shown side by side, not competing routes.                                                                                                                                                                                                                                                                                  |
| `document-image-status`                                                        | Fixture backing a component test — keep.                                                                                                                                                                                                                                                                                                                     |
| `accessible-table-browser-fixture`                                             | Keep — the only 320 px harness for the production `AccessibleTable`, used by the manual journey recorded in `/issues` `#237`. Corrected 2026-09-02: no committed test navigates to it, so it backs a manual check, not an automated one.                                                                                                                     |

### Dictionary browse header — three rounds, keep all three

`dictionary-browse-header`, `dictionary-browse-header-compact`, `dictionary-control-row` —
see the dated write-ups below; each attacks a different part of the same header. Round two's
Version 01 is the one that actually shipped to `/dictionary/browse` (confirmed against the
shipping commit, corrected below — the write-up briefly recorded the wrong version as chosen).
None of the three routes supersedes another at the route level — round two and round three both
import code from round one's component file, so all three stay regardless.

### Search chrome & composer

`search-band-directions`, `search-heading`, `search-lens-menu`, `search-refine-adaptive`,
`mode-dropdown`, `phone-inpage-navigation`, `recent-searches-bottom`, `pinned-plus-menu`,
`universal-search-command`, `universal-search-redesign`, `sidebar-live` — parallel drafts,
no recorded winner for any of them.

### Calculators

**Corrected 2026-09-02 — this was the stalest entry in this file.** These were never
undecided: PR #1227 (`5475fcfb`, 2026-07-26) _moved_ the whole `calculator-mockups/` tree into
`src/components/calculators/` as production, and #1362 re-created the mockup copies three days
later purely so `/mockups/*` would stop importing production code. Every design here is live.

The tree is interconnected (all eight routes share `calculator-fixtures.ts` and
`calculator-ui.tsx`) and `tests/calculator-mockup-boundary.test.ts` reads two of its files from
disk, so it comes out as one unit or not at all. All eight are kept:
`calculators-bedside-sheet`, `calculators-clinical-console`, `calculators-directory-grid`,
`calculators-guided-flow`, `calculators-popup-sheet`, `calculators-search`,
`calculators-search-page`, `calculators-show-all`.

**Known divergence, tracked separately:** production `calculator-pathways.ts` was cut from 296
lines to 65 by #2491 on clinical-safety grounds; the mockup copy still carries the deterministic
prescribing, ECT, admission and referral advice that was removed. These routes 404 in
production, so this is not a patient-facing exposure, but it is a real divergence — see the
`/issues` inbox request filed 2026-09-02.

### Settings

`settings-search-clinical`, `settings-search-general`, `settings-search-privacy` — parallel
drafts, no recorded winner.

### Answer / chat

**Corrected 2026-09-02.** These were not parallel drafts, and the earlier reading of this
section was wrong. `answer-chat-perfected` and `answer-chat-perfected-v2` are sequential
halves of one design that shipped in full; the repo does say so in writing, in four commit
bodies and three production source comments, which the earlier pass did not search.

| Route                      | Status                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `answer-chat-perfected`    | Shipped — direction A refined, built by #2362. Also a **shared base**: `answer-chat-perfected-v2` and `answer-loading-redesign` import it, so it cannot be removed.                            |
| `answer-chat-perfected-v2` | Shipped — applied to the live answer surface by #2388; `answer-content.tsx` cites this route as the approved reference.                                                                        |
| `answer-loading-redesign`  | Shipped — direction B, applied 2026-08-27; `AnswerProgressStepper` is gone.                                                                                                                    |
| `answer-chat-redesign`     | Superseded as a design (direction A won) but **kept**: it is the three-way comparison the winner was chosen from, cited by the answer handover doc and by `answer-chat-perfected-mockups.tsx`. |
| `answer-evidence-popups`   | Retired 2026-09-02 — the five-tab Evidence sheet #2362 explicitly replaced.                                                                                                                    |
| `answer-home-proposal`     | Retired 2026-09-02 — its copy never shipped, and #1512 overtook it before its own PR merged.                                                                                                   |

### Factsheets

`factsheets-compact-view`, `factsheets-topics-phone` — parallel drafts, no recorded winner.

### Therapy navigation

`therapy-navigation-context`, `therapy-navigation-dock`, `therapy-navigation-rail` — three
named directions, cross-linked to each other for comparison, no recorded winner.

### Therapy Recommend scenario popup

`therapy-scenario-popup-guided`, `therapy-scenario-popup-live`, `therapy-scenario-popup-intake` —
three named directions for turning the **clinical-situation control** at the top of
`/therapy-compass/recommend` (the textarea plus the Setting / Time / Support / Cautions chip
groups) into a popup: a stepped builder, a docked live composer, and a structured intake that
composes an editable scenario sentence. All three reuse the shipped constraint keys, labels and
`inferRecommendConstraints` rules verbatim, and their live "N of 205 records in scope" counter is
computed from `catalogue-data.ts`, which is the shipped `RECOMMEND_CONSTRAINTS[i].match()`
predicates run over all 205 catalogue records. Parallel drafts, no recorded winner.

### Therapy Recommend popup

`therapy-recommend-popup-dossier`, `therapy-recommend-popup-triage`,
`therapy-recommend-popup-workbench` — three named directions for opening a ranked Recommend
**result** as a popup instead of a route change (the scenario-input side is the separate study
above): a centred record dialog, a docked triage panel
with a match stepper and a live fit check, and a two-column consult workbench with a plan and
note builder. Each draws its own desktop and phone frames and carries the real
`exposure-based-cbt-exposure-therapy` record. Parallel drafts, no recorded winner.

### On Call hub — two studies, read together (2026-09-19)

| Route                 | Status                                                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on-call-shift-cover` | Active study — four boards rebuilding surfaces that already ship: the home with a shift band and an on-cover strip, the Contacts row, the Playbook escalation ladder, and the printed pocket card. Each board names the finding it answers.                      |
| `on-call-calendars`   | Active study — four boards proposing surfaces the hub does not have: a cover/rota calendar, a teaching term with attendance, a de-identified shift log, and the referrals list asked as a "who covers this?" question. No recorded winner; owner review pending. |

Companion to [`docs/on-call/design/2026-09-19-review-and-proposals.md`](../docs/on-call/design/2026-09-19-review-and-proposals.md),
which carries the review these boards answer and the wider list of proposals that were not drawn.
`on-call-calendars` imports its frame scaffold from `on-call-shift-cover` — do not remove the
latter independently, and see the compliance study below, which imports the same scaffold.

### Doctor compliance — a personal requirements tracker (2026-09-19)

| Route               | Status                                                                                                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor-compliance` | Active study — six boards for tracking one doctor's own work requirements: today sorted by consequence rather than expiry, one requirement opened, CPD by category, the evidence pack export, the renewal year, and a supervisor roll-up that holds no documents. No recorded winner; owner review pending. |

Companion to [`docs/product/2026-09-19-doctor-compliance-and-feature-brainstorm.md`](../docs/product/2026-09-19-doctor-compliance-and-feature-brainstorm.md),
which carries the design rules, the risks, and twenty-two further feature ideas across the app.
It imports its frame scaffold from `on-call-shift-cover` — do not remove that route
independently.

### Clinical governance and corpus health (2026-09-19)

| Route                       | Status                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clinical-sign-off-actions` | Active study — four boards proposing the ACTION the shipped read-only sign-off queue does not have: one record attested, a batch/sampling rule, seven vocabularies under one action, and what signing unlocks. Companion to the live queue at `development/clinical-sign-off`. |
| `coverage-gaps`             | Active study — four boards for a corpus-coverage report over the existing redacted query-miss telemetry: topics rather than questions, the WA-first source ladder, the abstain blind spot, and closing the loop into an eval case.                                             |

Companion to [`docs/product/2026-09-19-second-recommendations.md`](../docs/product/2026-09-19-second-recommendations.md).
Both import their frame scaffold from `on-call-shift-cover` — do not remove that route
independently.

### One-off studies

| Route                        | Status                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `also-matches-accents`       | Chosen design — records the picked "also matches" accent treatment.                                                                                       |
| `also-matches-closed`        | Active study — three directions for closing the "also matches" tray on tablet and desktop; no recorded winner.                                            |
| `verification-notice-subtle` | Active study, no recorded winner.                                                                                                                         |
| `warning-consolidation`      | Active study — first pass on consolidating warning lines.                                                                                                 |
| `warning-line`               | Active study — second pass answering a narrower, different brief (words only, no icon/border/tint); not a replacement for the first pass.                 |
| `phone-mode-sheet-yes`       | Active study — design review of the shipping phone mode sheet.                                                                                            |
| `source-rail-desktop-scroll` | Chosen design — direction A (edge chevrons, mouse only) was picked and applied to the live `AnswerSourceRail`. Kept as the comparison it was chosen from. |

Static (non-route) design comps under `public/mockups/mode-page-redesign-2026-07/` are
already documented below and are not part of this route index.

## Retired mockups

The durable record of every mockup removed from this repository, required by
[`docs/mockup-retirement-policy.md`](../docs/mockup-retirement-policy.md) and enforced by
`npm run check:mockups`: a route deleted without an entry here fails the gate, and an entry
here for a route that still exists fails it too. Recover any of these from git history if the
alternatives need re-reading — that is the archive, and a second copy of design scratch is the
problem this policy exists to prevent.

| Retired    | Route                              | Superseded by                    | Evidence                                                                                                                                                                             |
| ---------- | ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-09 | `breadcrumb-header`                | Direction 02, shipped            | Removed once 02 shipped; the write-up below is the durable record.                                                                                                                   |
| 2026-08-27 | `favourites-command-console`       | `favourites-phone-perfected`     | Written successor plus a confirmed import search.                                                                                                                                    |
| 2026-08-27 | `favourites-command-desk`          | `favourites-phone-perfected`     | As above.                                                                                                                                                                            |
| 2026-08-27 | `favourites-library-view`          | `favourites-phone-perfected`     | As above.                                                                                                                                                                            |
| 2026-08-27 | `favourites-review-console`        | `favourites-phone-perfected`     | As above.                                                                                                                                                                            |
| 2026-08-27 | `favourites-set-board`             | `favourites-phone-perfected`     | As above.                                                                                                                                                                            |
| 2026-08-27 | `favourites-set-navigator`         | `favourites-phone-perfected`     | As above.                                                                                                                                                                            |
| 2026-09-02 | `document-navigation-pane`         | `document-navigation-perfected`  | `section-nav.tsx` refuses its anchored-rail thesis in `6230c4db`, the same commit that added both.                                                                                   |
| 2026-09-02 | `document-navigation-final-review` | `document-navigation-perfected`  | Immediate predecessor: unweighted track and no pending state, where production is weighted and has one.                                                                              |
| 2026-09-02 | `document-phone-title`             | `document-navigation-perfected`  | Recommends a drop pane; production uses the shared `Sheet`.                                                                                                                          |
| 2026-09-02 | `document-phone-title-refined`     | `document-navigation-perfected`  | Still a pane, and keeps `Plus` in the row where production uses `Ellipsis`.                                                                                                          |
| 2026-09-02 | `document-phone-fused-directions`  | `document-navigation-perfected`  | Commits to "a pane that pushes the document down rather than covering it" — what production refuses.                                                                                 |
| 2026-09-02 | `answer-home-proposal`             | Not applicable — nothing adopted | Its corpus-name subtitle and governance line never shipped; #1512 removed the badge independently, hours before this mockup's own PR merged.                                         |
| 2026-09-02 | `answer-evidence-popups`           | `answer-chat-perfected`          | #2362 names the five-tab Evidence sheet as one of "four mental models for one question" and replaced all four with one source rail and drawer.                                       |
| 2026-09-26 | `caring-contacts`                  | Not applicable — feature retired | Owner decision 2026-09-26: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history. |
| 2026-09-26 | `ward-flow`                        | Not applicable — feature retired | Owner decision 2026-09-26: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history. |

Their shared component folder `favourites-page-mockups/` went with them on 2026-08-27. That
retirement — a named written successor **and** a confirmed import search — is the precedent the
policy's evidence bar is drawn from.

## Retired developer-gated routes (owner decisions)

Tier B of [`docs/mockup-retirement-policy.md`](../docs/mockup-retirement-policy.md) refuses every
deletion under a developer-gated prefix, because that subtree is live in production behind
`DeveloperAreaGate` and removing a screen from it is a product decision rather than cleanup. That
refusal is unconditional and stays that way. This table is where a decision the owner **has** made
is written down, and `npm run check:mockups` clears Tier B for a route only when it appears here
with every column filled in. A route recorded here that still exists on disk fails the gate, for
the same reason the retirement table above is symmetrical: a record kept after a restore would sit
permanently pre-authorising a deletion nobody has looked at again.

| Retired    | Route                                            | Approved by      | Superseded by                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------ | ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-03 | `/mockups/ward-flow/patients/[patientId]`        | Repository owner | `/mockups/ward-flow/people/[patientId]` | The address was misnamed: it looked a **movement** up by id while calling it a patient, and its inbound links passed movement ids through a variable called `patient`. Split into `/people/[patientId]` for the person and `/movements/[movementId]` for the movement, so both names now match what they show. A redirect was considered and rejected — the ids that reached the old address were movement ids, so forwarding them into the person screen would show the wrong record. |
| 2026-09-26 | `/mockups/caring-contacts`                       | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/contacts/[contactId]`  | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/guidance`              | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/patients`              | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/patients/[patientId]`  | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/plans/[planId]`        | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/plans/new`             | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/reports`               | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/schedule`              | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/system-states`         | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/team`                  | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/templates`             | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/caring-contacts/templates/[pathwayId]` | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Caring Contacts prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                     |
| 2026-09-26 | `/mockups/ward-flow`                             | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/board/[unitId]`              | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/capacity`                    | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/community`                   | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/community/[teamId]`          | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/constellation`               | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/delays`                      | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/discharges`                  | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/ed/[edId]`                   | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/escalation`                  | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/exceptions`                  | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/governance`                  | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/handover`                    | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/morning`                     | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/movements`                   | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/movements/[movementId]`      | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/network`                     | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/out-of-area`                 | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/people/[patientId]`          | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/people/new`                  | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/queue`                       | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/referrals`                   | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/referrals/new`               | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/search`                      | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/statistics`                  | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/statistics/compare`          | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/statistics/ed/[edId]`        | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/statistics/overview`         | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/statistics/ward/[unitId]`    | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/transport`                   | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/transport/officer`           | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/ward/[unitId]`               | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/ward-flow/wards`                       | Repository owner | Not applicable — feature retired        | Owner decision 2026-09-26 to retire the whole Ward Flow prototype: "Go ahead and do this now (Josh, 2026-09-26 11:19 UTC, approving the plan to retire and delete Ward Flow and Caring Contacts)". Recover from git history.                                                                                                                                                                                                                                                           |
| 2026-09-26 | `/mockups/development/documentation`             | Repository owner | Not applicable — panel retired          | Owner decision 2026-09-26 to retire the Review state, Documentation, Routes and modes and Test health panels from the Owner panel: "Yes, delete the Review state, Documentation, Routes and modes, and Test health pages from the Owner panel." (Josh, 2026-09-26 18:15 UTC). Their data stays in `data/repo-awareness-snapshot.json`. Recover from git history.                                                                                                                       |
| 2026-09-26 | `/mockups/development/review-state`              | Repository owner | Not applicable — panel retired          | Owner decision 2026-09-26 to retire the Review state, Documentation, Routes and modes and Test health panels from the Owner panel: "Yes, delete the Review state, Documentation, Routes and modes, and Test health pages from the Owner panel." (Josh, 2026-09-26 18:15 UTC). Their data stays in `data/repo-awareness-snapshot.json`. Recover from git history.                                                                                                                       |
| 2026-09-26 | `/mockups/development/routes`                    | Repository owner | Not applicable — panel retired          | Owner decision 2026-09-26 to retire the Review state, Documentation, Routes and modes and Test health panels from the Owner panel: "Yes, delete the Review state, Documentation, Routes and modes, and Test health pages from the Owner panel." (Josh, 2026-09-26 18:15 UTC). Their data stays in `data/repo-awareness-snapshot.json`. Recover from git history.                                                                                                                       |
| 2026-09-26 | `/mockups/development/test-health`               | Repository owner | Not applicable — panel retired          | Owner decision 2026-09-26 to retire the Review state, Documentation, Routes and modes and Test health panels from the Owner panel: "Yes, delete the Review state, Documentation, Routes and modes, and Test health pages from the Owner panel." (Josh, 2026-09-26 18:15 UTC). Their data stays in `data/repo-awareness-snapshot.json`. Recover from git history.                                                                                                                       |

## Design tokens

Mockups use the Clinical White / Sky Graphite role tokens (`--command`, `--clinical-accent`, `--success`) from [`docs/redesign/02-design-direction.md`](../docs/redesign/02-design-direction.md). Older design-exploration mockups were removed in July 2026 so stale palettes do not mislead future design review.

## Global search shell

Runnable mockups under `src/app/mockups/*` inherit the shared PsychSift header and bottom search composer from `src/app/mockups/layout.tsx`.

- Put the mockup content between the global header and bottom composer; do not copy the header or composer into new pages.
- `src/app/mockups/mockups-layout-client.tsx` is the suppression registry: it carries the route-specific rules (by exact path or prefix) for which mockups hide the composer, the header, or both — Favourites and Tools mockups that provide their own primary search surface, the phone-frame studies that draw their own chrome, the Care Plan prototype, and more. Add a new mockup's rule there with a comment saying why, rather than inventing a route-local override.
- One subtree bypasses the shell entirely rather than rendering inside it with the chrome switched off: the Developer Hub (`/mockups/development/**`). Ward Flow used the same bypass until it was retired on 2026-09-26. The comment block in that file records why (duplicate `<main>` landmarks and pointer interception when nested).
- Use `?mode=answer`, `?mode=documents`, `?mode=prescribing`, `?mode=evidence`, or `?mode=favourites` to preview the active search mode.
- The bottom composer routes live searches to the dashboard with `mode`, `q`, and `run=1`; New chat routes to `/?mode=answer&focus=1`.
- If a future mockup must be standalone, add it to the bypass branch in `mockups-layout-client.tsx` (the Developer Hub pattern) or move it outside the `/mockups` route shell; do not copy the shell's header or composer into the page.

## Calculators Show all chip (2026-08-24)

Three phone homes at [`/mockups/calculators-show-all`](../src/app/mockups/calculators-show-all/page.tsx). The page is
the Tools launcher with Calculators copy. Only the **Show all** chip changes.

| Style           | Chip                                                             |
| --------------- | ---------------------------------------------------------------- |
| 01 Recommended  | Soft 14% accent tint + hairline well, 36px capsule, 48px tap     |
| 02 Soft capsule | Option 2 polished — whisper fill, no well, optical `pl-3.5 pr-4` |
| 03 Quiet well   | Option 3 polished — well only, no pill fill                      |

Shared mockup chrome is suppressed because each frame draws its own top bar and composer.

## Production behavior

- Ordinary `/mockups/*` prototype routes return 404 in production. Explicit developer-gated subtrees and the isolated
  Playwright advisory profile are the documented exceptions; neither makes the namespace public application content.
- Static design-review assets under `public/mockups/` remain publicly retrievable by URL. Responses under
  `/mockups/:path*` carry `X-Robots-Tag: noindex, nofollow`, so compliant crawlers do not index them. This header is a
  crawler policy, not access control; `robots.txt` intentionally allows crawling so per-response indexing policy can
  be observed.
- `/mockups/favourites-hub` (to `/favourites`) and `/mockups/medication-prescribing` (to `/medications/acamprosate`;
  prescribing mode also lives at `/?mode=prescribing`) are page-level `redirect()` compatibility routes that work **in
  development only**: in production `src/proxy.ts` returns 404 for every non-developer-gated `/mockups/**` path before
  either page renders, so neither forwards there. The one mockup path that still redirects in production is
  `/mockups/document-search-command` (to `/documents/search`), because it is resolved in the proxy's
  `staticRouteRedirects` ahead of that block.

## Synthetic document-search assets

The document-search mockups use generated non-patient bitmap assets in `public/mockups/document-search/`. These images are abstract UI/document textures only: they must not be treated as source screenshots, hospital-branded material, or clinical content.

Some document-search mockups include live handoff routes (for example `document-search/source-overlays`) that resolve into the real document viewer with a selected page and chunk when indexed data is available locally.

## Privacy page redesign study (2026-08)

- Selected perfected direction: [`/mockups/privacy-live-signal-perfected`](../src/app/mockups/privacy-live-signal-perfected/page.tsx)
- Full three-direction study: [`/mockups/privacy-page-directions`](../src/app/mockups/privacy-page-directions/page.tsx)
- Static comps: [`public/mockups/privacy-page-redesign-2026-08/`](../public/mockups/privacy-page-redesign-2026-08/README.md)

## Dictionary Browse header study (2026-08-18)

Runnable study at [`/mockups/dictionary-browse-header`](../src/app/mockups/dictionary-browse-header/page.tsx). The
brief was to drop the description line under **Browse terms** and the orphaned A–Z / Z–A sort pill that floats on its
own row, then rebuild the header for the phone. All three directions move sort into the Filters sheet, where the other
modes already keep it; they differ in how much letter navigation stays on screen.

| Direction                   | Phone chrome before a result | Trade-off                                                     |
| --------------------------- | ---------------------------- | ------------------------------------------------------------- |
| 01 Compact title bar        | 2 bands                      | Keeps both browse views explicit; least vertical saving       |
| 02 Fused letter rail (rec.) | 2 bands                      | Abbreviations becomes a rail chip rather than a separate view |
| 03 Index rail + jump sheet  | 1 band                       | Edge rail is a fine-motor target; jump sheet is the a11y path |

The current header is rendered side by side at the top of the page for comparison. Shared mockup chrome is suppressed
because each frame draws its own top bar, mode nav and composer.

## Dictionary Browse header, round two (2026-08-18)

Runnable study at [`/mockups/dictionary-browse-header-compact`](../src/app/mockups/dictionary-browse-header-compact/page.tsx),
a follow-up to the round-one study above. Every version replaces the 27-chip horizontal letter rail with a **letter
dropdown on phones** and moves **Abbreviations out of the header into the Filters sheet** beside sort.

| Version                        | Phone chrome | Trade-off                                                           |
| ------------------------------ | ------------ | ------------------------------------------------------------------- |
| 01 Title bar + letter dropdown | 2 rows       | Title still costs a row the mode nav already implies                |
| 02 Single fused row            | 1 row        | An active filter chip costs the row its title and count at 390 px   |
| 03 Slim toolbar, title retired | 1 slim bar   | Phone loses its visual page title; depends on the mode nav above it |

**Shipped: Version 01**, not the recommendation the study opened with — the commit that shipped this study to
`/dictionary/browse` records "Version 01 is the chosen direction" (PR #2143). `dictionary-control-row`'s later study
builds on that outcome.

Demoting a view switch into a sheet hides state, so each version surfaces an active **Abbreviations** chip beside the
letter control. Without it the header would claim 96 terms while listing 24 abbreviations.

Note for anyone extending these: the mockup stylesheet only emits Tailwind classes that some source actually uses, and
no production file uses a bare `grid-cols-6` (only `xl:grid-cols-6`). The 26-letter pickers therefore pin
`gridTemplateColumns` inline rather than depending on class generation — a bare `grid-cols-6` silently collapses them
to one column.

## Favourites, phone-first (2026-08-26, arrangement chosen 2026-08-27)

Runnable study at [`/mockups/favourites-phone-perfected`](../src/app/mockups/favourites-phone-perfected/page.tsx).
One perfected direction rather than a set of alternatives — the six earlier favourites studies
(`favourites-command-desk`, `-command-console`, `-library-view`, `-review-console`, `-set-board`,
`-set-navigator`) already covered the option space.

**The measurement it answers.** Chromium at 390 × 844 against the dev server, reading
`getBoundingClientRect()` on the live `/favourites` route: the first row of the saved list begins at
**y = 1141**, roughly 300px below the fold, behind a hint strip, an in-flow composer, a privacy
notice, a results band, a Continue card and a Recent card. Each item card is **228px**. Nothing of
the library itself is on the first screen. The three derived cards above the list measure Continue
113px, Recent 277px and Your sets 255px — 645px of that 1141px.

**The arrangement, chosen by the owner 2026-08-27.** Both derived cards are kept and drawn in full —
Continue with its own action, Recent with View all, type pills and per-row Open — rather than the
72px compressed resume strip the first pass proposed. What pays for them is a single rule:

> Continue and Recent are the **landing** surface, and nothing else. Tap a set or type in the
> composer and they hand the screen back to the list.

Narrowing means the user is hunting for something specific, and a resume affordance is not what they
asked for. Measured: **no** saved row fully above the fold on arrival (one partly), **seven** the moment you narrow. A
degraded load also falls back to the strip — with the failure notice plus both full cards, **zero**
saved rows fitted, which is the wrong screen to show nothing on.

The library groups by the user's own sets rather than by recency, because a recency-sorted list under
a Recent card is a second copy of that card. Continue, Recent and the library then answer three
different questions: what was I mid-way through, what did I just touch, what have I filed. `View all`
switches the list to recency, which is what makes that control do something.

| Decision                                        | Trade-off                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Continue and Recent as the landing surface only | One saved row above the fold on arrival                                |
| Library groups by set, not recency              | Finding the newest thing means Recent or View all                      |
| One header, not six bands                       | Sort, sets and clear-all cost a tap behind the ellipsis sheet          |
| One-line rows with a type pill                  | No description, so near-identical forms are told apart by code and set |
| Pinned rows lead, with a real toggle            | One 28px group label, which disappears when nothing is pinned          |
| The shared composer stays the only input        | The input is at the far end of the phone from the count it changes     |

A **weighted segment track** (the `DocumentSectionTrack` shape the in-page navigation template
prescribes) was tried first and dropped: eight sets across 390px leaves each segment about 48px,
under the width a set name needs, so the track degrades to unlabelled slivers.

Twelve phone frames: landing, one set selected, filtering, no matches, first run, item actions, set
management, partial load, signed out, and two kept alternatives — the compact resume strip (the
rejected first pass, kept as the record of the choice) and the type drawn as a coloured word rather
than a pill. One 1280px frame shows the desktop translation.

**Content honesty.** Only `service | form | differential | therapy` are drawn, because
`favouriteContentTypeSchema` permits nothing else. The six earlier favourites mockups draw saved
medications, documents, quotes and searches, none of which has a content type and none of which can
be persisted. `tests/favourites-phone-perfected-mockups.test.ts` pins that, the controlled set
vocabulary, and the 48px tap knob. Differentials and therapies borrow `--tone-purple` / `--tone-indigo`
because the identity group has no `--type-differential` or `--type-therapy`; promotion would add them.
The shipped Continue card tints its rule with `--success`; TOKENS.md scopes the clinical-state layer
to source state and sanctioned urgency, so the accent carries that job here instead.

Shared chrome is suppressed because every frame draws its own top bar, page header and composer.

**Class-generation trap, again.** The phone frame's geometry (`max-w-phone-frame`, `h-phone-frame`,
`rounded-phone-frame`) and both desktop `grid-cols-[...]` tracks are pinned inline. Measured on this
route while building it, `--spacing-phone-frame` resolved to the empty string and the frame rendered
2661px tall with square corners; the desktop grid collapsed to a single stacked column. Same cause as
the `grid-cols-6` note above — Tailwind only emits a theme key some scanned source uses, and whether
that holds depends on what else lands in the sheet. Pin unusual geometry inline.

## Dictionary — condensing the phone control row (2026-08-21)

Runnable study at [`/mockups/dictionary-control-row`](../src/app/mockups/dictionary-control-row/page.tsx).
Deliberately the narrowest of the Dictionary header rounds: the page keeps its kicker, title, summary line, desktop
sort/view/Filter, letter rail, result rows and the site-wide bottom composer exactly as they are. Only the **phone
control row** changes — today two viewport-sized dotted pills for Terms / Abbrev plus an A-Z dropdown, on a second
line under a summary line that is already two thirds empty.

Each version drops the decorative leading dots and folds the row up into the summary line, so the control block goes
from two rows to one. What differs is which cost each one attacks.

| Version                               | Attacks               | Trade-off                                            |
| ------------------------------------- | --------------------- | ---------------------------------------------------- |
| 01 Fold it into the line above (rec.) | The second line       | Four things on one line; small toggle segments       |
| 02 Drop the segmented control         | The unselected option | Scope costs two taps; other count is not visible     |
| 03 One control, one sheet             | Having two controls   | Everything is two taps; abbreviations undiscoverable |

Every version is rendered twice — the row alone at true 390 px width, which is how the complaint was raised, and the
row in place on the page. Shared mockup chrome is suppressed because each frame draws its own tab rail and composer.

The tab rail reads Terms · Topics · More rather than Search · Browse · More: this round assumes Search and Browse have
merged into one destination, with the site-wide composer as the mode’s only search surface.

## Phone Choose mode sheet YES comps

Runnable study at [`/mockups/phone-mode-sheet-yes`](../src/app/mockups/phone-mode-sheet-yes/page.tsx): design review of the shipping phone mode sheet plus **YES 01 perfected** (sectioned clinical list — shipping recommendation) and YES 02 (icon deck alternate). Shared mockup chrome is suppressed so only the in-frame sheet is judged.

## Mode-page redesign comps (2026-07-31)

Static desktop/phone comps for the pages that need redesign (not ModeHome mockups for Favourites) live under [`public/mockups/mode-page-redesign-2026-07/`](../public/mockups/mode-page-redesign-2026-07/README.md):

| Page                                                | Recommended direction             | Issue  |
| --------------------------------------------------- | --------------------------------- | ------ |
| Tools search                                        | A — Compact Results Instrument    | `#162` |
| Services search                                     | B — Progressive Referral Workflow | `#163` |
| Favourites (hybrid dashboard + search, no ModeHome) | B — Search-Led Workspace          | `#164` |

These are PNGs for design review only. Runnable `/mockups/*` routes are a separate implementation step.

**Perfected combined comps** (desktop + phone in one image, recommended directions only) live in [`public/mockups/mode-page-redesign-2026-07/perfected-combined/`](../public/mockups/mode-page-redesign-2026-07/perfected-combined/README.md).

## Perfected Tools search mode

`/mockups/tools-search-mode?mode=tools&q=Compare` is the interactive responsive Tools results-mode study. It uses the site's universal header and search composer, the shared results ribbon and filter conventions, compact Tools result cards, a contextual detail panel on desktop, and a bottom sheet on phones. It intentionally excludes the Tools home hero, quick actions, medication-list treatment, and cross-mode suggestion blocks.

## Breadcrumb header study (2026-08-09) — shipped, route retired

Three sticky header directions for record pages that use `InformationPageBreadcrumbs` and have **no in-page section index** — factsheets, services, forms, DSM, specifiers, formulation, medications. `InPageNavHeader` stays the default for in-page navigation per [`docs/search-chrome-behaviour.md`](../docs/search-chrome-behaviour.md); it is the wrong shape for those pages, because with no sections its disclosure opens a one-item sheet and its weighted track renders one full-width segment. Every direction kept that header's row grammar (back, title, ellipsis, one scroll owner) and dropped the section machinery:

| Direction            | Adds                                  | Fits                                    |
| -------------------- | ------------------------------------- | --------------------------------------- |
| 01 Crumb rail        | Nothing — identity and return only    | Forms, DSM, specifiers, formulation     |
| 02 Action rail       | One promoted primary action pill      | Factsheets, services, medications       |
| 03 Crumb rail + mode | Segmented view mode in the track slot | Factsheet reading level, medication age |

**Outcome: direction 02 shipped**, as the breadcrumb shape of the existing `InPageNavHeader` rather than a new component — omitting `sections` drops the disclosure and the track, and `primaryAction` / `mode` / `showBackLabel` shape the row. Adopted first on `/factsheets/<slug>`, where the reading level rides the `mode` slot. Contract: `docs/search-chrome-behaviour.md` ("The breadcrumb shape").

**The runnable `/mockups/breadcrumb-header` route was removed once 02 shipped.** It was not deleted for tidiness: at the time, `check:bundle-budget` totalled every built chunk, mockups included, and `main` sat at roughly +9.4% against a 10% tolerance, so the study's two scratch chunks (~9.8 KiB gzip) alone pushed the repo to +10.1% and failed `Build` — the same failure PR #1580 hit, at the same number. (Since PR #1779 `bundle-budget.json` keeps mockups in their own `mockups` scratch bucket with a 25% tolerance, separate from the `production` bucket, so a scratch route no longer competes with production headroom.) A design-scratch route that 404s in production is the wrong thing to spend the last of that headroom on. The table above is the durable record; recover the route from history if the alternatives need re-reading.

## Services filter surface (2026-08-11)

Runnable study at [`/mockups/services-filter-refined`](../src/app/mockups/services-filter-refined/page.tsx): three
directions for the sheet reached from the **Filter** control in the services results band, each shown at desktop and
phone, plus a reproduction of what ships today with its defects annotated.

The finding that drove the study is not cosmetic. The sheet is titled "Filter services" and nothing in it filters —
every chip calls `applyServiceQuery()`, which pushes a new route and **replaces the query**, so choosing "Crisis" while
reading "16 services · lithium level timing" discards that search and its results. It is a preset switcher wearing a
funnel icon. Secondary defects: no per-option counts, four unrelated categories in one flat chip row, a dead band below
the fold, "Done" as a low-emphasis outlined button doing the primary job, and a phone `role="radiogroup"` contradicting
the desktop rail's `aria-pressed` toggles.

| Direction                 | Shape                                                        | Blast radius                                                                |
| ------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| A — Refine in place       | Facet groups + separated "Start a new search" block          | Fits current `ResultFilterSheet` props; upgrades all 7 modes, nothing forks |
| B — Presets/filters split | Two tabs, plus a persistent active-filter row under the band | Tab contract in the shared sheet + a band row other modes inherit           |
| C — Directory-grade       | Persistent desktop rail; phone find-a-filter + collapse      | New services desktop layout + a services facet index; services-only         |

Every count in the study is real, computed live from the 219 services in `data/services-snapshot.json` via ~1KB of
base64 facet bitmasks (OR within a group, AND across groups). The tags are already populated and unused by the UI:
acuity, catchments, age groups, setting flags, substance and housing flags, plus `confidence`.

Three data caveats recorded in the study itself: a **"No cost" facet is not free** (`cost_funding` is 87 distinct
free-text values; ~69 of 219 match a free-ish pattern, so it is deliberately absent rather than faked);
`age_groups: mixed` (202/219) and `setting_flags: public` (207/219) are **omitted as facets** because an option that
never excludes anything is a row of dead pixels; and the radiogroup/`aria-pressed` disagreement must be resolved
deliberately rather than inherited.

### Round two — three options along the recommended path (2026-08-11)

Runnable study at [`/mockups/services-filter-options`](../src/app/mockups/services-filter-options/page.tsx).
Round one offered three _directions_; asked which to build, the answer was a sequence rather than a
winner, plus one bolder move flagged as a product judgement. This study draws those three threads so
they can be compared directly.

| Option                 | Verdict     | What it is                                                                                                                                                                                                              |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Stop the bleed     | Ship first  | No filtering. Renames the sheet, shows each shortcut's literal query, and puts the current search at the top as the thing you are about to lose. No new state, no new component                                         |
| 2 — The recommendation | Recommended | Direction A's facets + counts + committed `Show N services`, plus direction B's persistent active-filter pill row. Phone shows the sheet open, desktop shows it closed — the closed state is what the pill row is for   |
| 3 — Presets evicted    | Your call   | Sheet becomes purely a filter; the six presets move to the composer as `AnswerSuggestionChips`, a production component whose own prop docs name composer rows as a use. Deletes sheet code rather than adding a surface |

Three points the study makes that are easy to lose: the expensive part (services facet index,
selection state, URL round-tripping) is **identical in options 2 and 3**, so choosing between them on
build cost is a false economy; **counts and multi-select have to ship together**, because a count on
a single-select radio only reports the size of the thing you are about to jump to; and option 1 is
**purely subtractive**, so it can land while the facet work is still being scoped and nothing in it
has to be unpicked afterwards.

The facet engine, chips, band and sheet shell are imported from the round-one study rather than
copied — the ~1KB bitmask table would otherwise be duplicated against a finite `mockups` bundle
budget, and two studies quoting different numbers for the same catalogue would discredit both.

### Round three — restyle, and a job for the segment bar (2026-08-12)

Runnable study at [`/mockups/filter-sheet-restyle`](../src/app/mockups/filter-sheet-restyle/page.tsx). Rounds one and
two settled the information architecture; this one is about craft, drawn on the **formulation** sheet because that is
the specimen that stresses the layout hardest — four domain themes, twelve domains, twelve mechanisms, four presets, thirteen domain chips, and the longest title in the app.

**The segment bar carries scope, not a verb.** Round two used it for "narrow these / start a new search", which is a
mode set once and rarely changed — a poor use of the most valuable strip in the sheet. Here it is
`These results 2 | All mechanisms 12`, with live counts on both segments. That is a decision the reader makes
constantly and which nothing in the product currently answers: filtering two results by twelve domains is close to
pointless, and today the only way to reach the full set is to clear the query and lose it. It also makes the empty
state recoverable — the commit button becomes "Show N in all mechanisms" instead of a dead end.

| Style                | Shape                                                                                                       | Best for                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| A — Refined clinical | Shipped structure, craft fixed: tinted header, eyebrow/title/live-count, ghost close, uniform counted chips | Cheapest adoption, no new containers |
| B — Themed cards     | Each theme a card with icon, label and the library's own description, tinting when it holds a selection     | Many options without a word cloud    |
| C — Dense list       | Full-width rows, proportion bar, right-aligned count column, sticky group headings                          | Scanning to a known domain           |

Three defects the study documents, all verifiable in source:

1. **Biological, Social and Cultural match zero of the twelve mechanisms.** They are offered as domain chips and can
   never return anything. Counts expose this on sight; without them it is invisible.
2. **`formulationDomainGroups` already exists** in `src/lib/formulation.ts` — four themes, each with a written
   description — and the sheet ignores it, rendering one flat ragged wrap of twelve chips.
3. **`formulationSearchPresets.slice(0, 4)` of five** means "If it is not perfect" is unreachable from the filter.

One deliberate departure from the services study: the per-option count here is the **intrinsic** count (how many
mechanisms carry that domain), not "the total if I added this". Domains are a single OR group, so the union contract
reports the unchanged total for an empty domain — Cultural would read `7`, indistinguishable from a full one. The
commit button remains the thing that predicts the outcome.
