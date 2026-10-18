# First Nations Mode Implementation Plan

> **SHIPPED (2026-09-26):** Merged to main in PR #3116 (commit b77828b150). First Nations mode is live.

> **Historical Primer implementation:** The once-per-device Primer code and storage references below record the shipped September implementation. That exact policy is superseded by the [17 October persistent-notice decision](../../decisions/2026-10-17-design-audit-resolution.md); use the current design spec and source for further work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:dispatching-parallel-agents to run the four lanes below on disjoint files, then superpowers:executing-plans for the integration task. Steps use checkbox (`- [ ]`) syntax for tracking. There is no per-task review: one adversarial review runs on the final diff (Task 9).

**Goal:** Add a standalone `first-nations` mode for hospital doctors caring for Aboriginal and Torres Strait Islander patients: a Bedside home built around liaison, the situation and the words to use, eight inner pages built from titled modules, and checked, credited content whose approval is pinned to a content hash. No database change.

**Architecture:** Content lives in `src/data/first-nations/*.json`, validated by one Zod schema in `src/lib/first-nations/`. A pure view-model turns content, approvals and the service profile into what each screen shows (approval gating happens there, once). One server renderer draws every page from the view-model, using the shared mode kit (`src/components/mode-kit/`) for rows, tiles, notices, buttons, freshness lines and the tap-a-number sheet. First Nations' own client islands cover what the kit lacks: the liaison hero with its day track, the Situation module and plan, "Before you go in", "Where is home?" with its WA line map, the in-page search box, the primer and the page menu. Mode registration copies the My Work pattern (commit `c01570c4c`).

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before writing route, layout, error-boundary or `next/font` code), React 19, TypeScript 6 strict, Zod 4, Tailwind 4 tokens, Vitest (node + jsdom), Playwright in CI only.

**Spec:** `docs/superpowers/specs/2026-09-26-first-nations-mode-design.md` (approved by the owner, final design, 2026-09-26 18:48Z). Shared visual rules: `/mnt/project-files/design/mode-design-standard.md` **v13.1** (its colour section and type floors are binding; v13.3 adds the `--surface-summary*` hero tokens this plan uses). Visual reference: the final design (version 12) on the private plan page, drawn by the generators in `/mnt/project-files/first-nations-mode/design-source/v4/` (`gen5.py` phone screens, `gen_wide.py` tablet and desktop, `phone5.css` blocks "v11", "detail pass" and "richer inner pages" for final values). They are mockups, not code to port; where a mockup and the spec differ (tab names on inner pages, the offline copy), the spec wins.

**Efficiency (work and tokens, without lowering quality):**

1. **Briefs name exact files and interfaces.** Each lane's brief (under "Lanes") lists the task sections, the fixtures and the few repo files its subagent may open. A subagent reads only those, never the whole plan or the repo.
2. **Model by kind of work.** Mechanical lanes (the source register and content JSON, registry and pin edits, generated files, and code written out in full here) run on a mid-tier model. Only the interactive client islands (Task 7) and the final review (Task 9, Step 4) use the top model.
3. **One test file per unit, no duplicated fixtures.** All test data lives in the three files under "Shared test fixtures"; tests import them and never rebuild content, models, approval records or kit stand-ins.
4. **No per-task review round.** One adversarial review of the whole diff runs at the end, with CI as the browser gate.
5. **Nothing is re-read when the task text already gives it.** Code, interfaces and line numbers in this plan are used as written; a file is opened only to edit it or because its lane brief names it.

Work is cut the same way: every shared-file edit sits in Task 5 so other mode threads avoid one task; the kit's dial sheet replaces the old call card, contact-actions and situation-sheet islands; the type, colour and serif guards are one design test; there are two pushes in total, one per milestone, and no local browser run.

**Prerequisite for Lane C (the UI tasks 6–8):** the shared mode kit is on `main`. On Call is landing it from `main` as its own small PR (the coordinator has asked On Call to do this first). It lives at `src/components/mode-kit/` and adds the `--surface-summary*` tokens. Working export names, **to confirm when the kit PR lands**: `ModeGroupedList`, `ModeRow`, `ModeFactTile`, `ModeFactTiles`, `ModeNotice`, `ModeStateLabel` (with the v13 green dot and its one pulse), `ModeUpdatedLine`, `ModeActionButton`, `ModeModuleSkeleton`, `ModeHeroLink`, `ModeDialRow`, `ModeDialSheet` (props `number`, `label`, `source`, `checkedAt`), and the recipes `modeNameText` and `modeNumberText`. First Nations imports them only through `src/components/first-nations/kit.ts`, so a renamed export or path is fixed in one file. Never import from `src/components/on-call/kit/`. Lanes A, B and D start now.

## Lanes

| Lane                              | Tasks             | Model                                                            | Starts                                     | Files it owns                                                                                                                                                                                                                                                                               |
| --------------------------------- | ----------------- | ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — content                       | 0, 1, 2, 3        | Mid-tier                                                         | Now                                        | `src/data/first-nations/**`, `src/lib/first-nations/{content-schema,approval,content,view-model}.ts`, fixture F1, `tests/first-nations-{approval,content,content-guard,view-model}.test.ts`                                                                                                 |
| B — logic                         | 4                 | Mid-tier                                                         | Now                                        | `src/lib/first-nations/{hours,contact-format,search}.ts`, `tests/first-nations-{hours,contact-format,search}.test.ts`                                                                                                                                                                       |
| D — registration and shared files | 5                 | Mid-tier                                                         | Now                                        | Every shared file listed under "Shared files", the route files, `src/components/first-nations/{first-nations-nav-header,first-nations-icons,crisis,first-nations-loading}.tsx` and the two stubs Lane C replaces                                                                            |
| C — UI                            | 7, then 6, then 8 | Top model for Task 7; mid-tier for Tasks 6 and 8                 | Kit on `main`, and Lanes A and B committed | The rest of `src/components/first-nations/**`, `src/app/(search-app)/first-nations/error.tsx`, fixtures F2 and F3, `tests/first-nations-{liaison-hero,situation-module,before-you-go-in,where-is-home,search-box,number-button,page-menu,privacy,renderer,design,pocket-card}.dom.test.tsx` |
| Integration                       | 9                 | Mid-tier for merge and generated files; top model for the review | All lanes committed                        | Generated files, the PR                                                                                                                                                                                                                                                                     |

**Lane briefs.** Dispatch each lane with only the Global Constraints, its own task sections, "Shared test fixtures" (Lanes A and C) and the reads below. Types from another lane come from the task's Interfaces list, not from opening that lane's files.

- **Lane A reads:** the `sources` skill (Task 0); `src/lib/crisis-contacts.ts` for the 13YARN, MHERL and Lifeline ids; `data/forms-cultural-notes.json` for the s 81 source id.
- **Lane B reads:** the exports of `src/lib/caring-contacts/clock.ts`, `src/lib/on-call/wa-public-holidays.ts` and `onCallTelHref` in `src/lib/on-call/home-modules.ts`.
- **Lane D reads:** `git show c01570c4c` (the My Work registration, the pattern to copy); each shared file only at the lines Task 5 names; `node_modules/next/dist/docs/` on `next/font/local` and `loading.js`.
- **Lane C reads:** the kit's files on `main` (exports and props only); the signatures of `src/components/ui/sheet.tsx` and `src/lib/copy-to-clipboard.ts`; `node_modules/next/dist/docs/` on error boundaries (Task 6); On Call's card route layout (Task 8).
- **Integration reads:** the merged diff and the Review Focus list.

Lane C runs Task 7 before Task 6 because the renderer mounts the islands; the tasks keep their numbers in page order. Lanes type-check at integration; inside a lane, each task proves itself with its focused tests.

**Milestones and pushes.** Milestone 1: Lanes A, B and D merged on the branch, fast checks green, pushed once, PR opened as a draft. Milestone 2: Lane C and the review fixes, fast checks green, pushed once, PR marked ready.

## Shared files (all in Task 5, listed for other mode threads)

`src/app/globals.css` (one First Nations block after CPD's identity block), `src/lib/app-modes.ts`, `src/lib/category-identity.ts`, `src/lib/information-pages.ts`, `src/lib/mode-secondary-navigation.ts`, `src/components/mode-nav/mode-nav-icons.ts`, `src/lib/phone-mode-groups.ts`, `src/lib/search-command-surface.ts`, `src/lib/search-route-ownership.ts`, `src/lib/search-shell-props.ts`, `src/lib/site-content/site-content-registry.ts`, `src/lib/ui-copy.ts`, `src/lib/universal-search-mode-context.ts`, `src/components/clinical-dashboard/ClinicalSidebar.tsx`, `src/components/clinical-dashboard/use-sidebar-pins.ts`, `src/components/mode-nav/header-addon-slot.ts`, `src/lib/account-scoped-browser-state.ts`, `src/components/forms/form-priority-facts-section.tsx`, `src/components/services/services-navigator-page.tsx` (path confirmed by `git grep -l "function ServicesNavigatorPage"`), `src/fonts/README.md` plus two new font files, `scripts/generate-site-map.ts`, `docs/design-system/adoption-contract.json`, `docs/organisation/systems/clinical-content.json`, `docs/organisation/systems/app-experience.json`, and the test pins in `tests/app-modes.test.ts`, `tests/mode-secondary-navigation.test.ts`, `tests/ui-copy.test.ts`, `tests/ui-smoke.spec.ts`, `tests/design-system-adoption.test.ts`, `tests/phone-mode-groups.test.ts`, `tests/mode-home-loading-contract.test.ts`, `tests/site-content-registry.test.ts`, `tests/collapsed-rail-active-mode.dom.test.tsx`, `tests/mode-nav-addon-slot.dom.test.tsx`.

**Not touched:** the mode pill and `master-search-header.tsx`, the shared pages sheet, `src/proxy.ts`, anything under `src/lib/rag/**` or any retrieval or ranking surface, `supabase/**`.

## Global Constraints

**Privacy and safety (unchanged from the approved design):**

- Patient-describing state stays on the screen only. The "Where is home?" region choice, every tick in "Before you go in" and in a situation plan, the chosen situation, the phrase shown and anything typed in the in-page search box are held in component state alone: never saved (no local or session storage, no database), never put in the URL, never sent to the server or to analytics, and never entered into the main search bar, which sends text to OpenAI (design standard §13). They clear when the page is left.
- The only browser storage the mode writes is the chosen hospital id (account-scoped, cleared at sign-out) and the primer's per-device dismissal flag. Neither describes a patient.
- Every entry in the regional services list (community-controlled health services, regional mental health teams, travel support) carries a source link and a checked date, like all other content.
- Mode id `first-nations`; label "First Nations"; home `/first-nations`.
- No disease or condition content, no doses, no calculators.
- No database change, no migration, no provider calls, no files under `src/lib/rag/**` or any retrieval/ranking surface.
- No patient data anywhere; no analytics about Indigenous status; team and switchboard numbers only; no personal names; no mobile numbers.
- PsychSift never records Indigenous content as signed off. Approval is only the separate `approvals` record, pinned to `contentSha256`.
- Content files must not contain the keys or words `reviewed`, `signedOff`, `signed_off`, `"approved": true`, `verified`.
- EMHS service layer ships with `"enabled": false`. While it is off, the Bedside liaison card is the "not set up" state module and only statewide numbers show.
- The crisis strip (000 and 13YARN) is rendered on the server with the page, never lazy-loaded, and appears in every state: loaded, loading, empty, offline, error and not set up. Inner pages also end with the four-number crisis block (000, 13YARN, MHERL, Lifeline).
- The "Wants to leave" immediate-risk line is its own block. It renders only when an `approvals` record for it exists whose hash matches (the owner's typed OK in the thread, recorded with the thread message id as `reference`). Without that record it renders nowhere: not in the Situation module, the plan sheet, the side panel or search.
- Checklists that are not saved say so on screen: "Nothing is saved" on "Before you go in", and "N steps · nothing is saved" on every situation plan.

**Design (shared standard v13.1 and the final design):**

- **Olive tokens**, defined once in `globals.css` under `[data-mode-identity="first-nations"]` with the standard's token names: light `--mode-identity #4d6b2f`, `--mode-identity-soft #f2f5ee`, `--mode-identity-border #dce4d2`, `--mode-identity-contrast #ffffff`; dark `#b5c98c`, `#232b1d`, `#3a4730`, disc contrast `#172009`. On the hero summary panel the day track uses the dark value in both themes. No hex in components.
- **Olive appears only in these places:** the pill (automatic), the current tab (the rail's `modeIdentity`), module-header icon tiles (28 px), the hero's day-track open segment, and quotation marks with their 3 px side rule. Selection and "now" stay product blue; 000 is the only red; rows, chips, buttons and status stay neutral. Muted small print on a soft tint uses `--text-muted`, never `--text-soft`.
- **Type scale:** 11 px labels and sources (`text-2xs`), 13 px body, sub-lines, tabs and buttons (`text-sm-minus`), 15 px row titles and numbers (`text-base-minus`), 17 px sheet titles, quotes and crisis numbers (`text-lg-minus`), and two display figures at weight 300: 36 px for the liaison figure (`.fn-display-36`) and 44 px for the number sheet (the kit's dial sheet). **At most four sizes on one screen**, a display figure counting as one. Weights 400–600, numbers 400 with tabular figures (`nums`), nothing bold. Never a raw `text-xs`, `text-sm`, `text-base`, `text-lg` or `text-[Npx]`.
- **Serif accent:** Newsreader italic 400 via `next/font/local`, only for words to say aloud, the quoted Act and the Acknowledgement, and only through `src/components/first-nations/voice.tsx`.
- **One filled button per screen or sheet** (the hero's call disc on Bedside; Call in the number sheet; "Add to letter" in "Where is home?"; "Call liaison" in a plan sheet). Everything else is outlined.
- **Tabs never carry count badges.**
- **Live status green:** the hero's status dot is the `--success` token only for a live, fresh "Open now", given by the kit's `ModeStateLabel`; it pulses once for 600 ms when the state turns fresh after the page has loaded, never on first load and never with reduced motion. Overdue and closed are neutral or amber words.
- **Skeletons are static** outline shapes with no shimmer.
- 12 px gutters and module padding; 48 px taps (row actions draw 34 px inside 48 px); sheets rise from the bottom; tablet two columns; desktop a 360 px side panel with the chosen situation's plan and previous/next arrows; dark mode follows the phone; text reflows at 200 % and crisis numbers wrap rather than truncate.
- Times in 24-hour format (`16:30`), ranges with an en dash (`08:00–16:30`); phone numbers grouped as in the design standard (`9000 0012` inside a hospital's own list, `(08) 9000 0012` outside, `13 92 76`, `1800 000 012`).
- Tap targets `min-h-12` (48 px); design tokens only; Lucide icons with `aria-hidden`.
- Copy: sentence case, calm, no "verified/valid/safe/compliant/up to date"; say what happened and when ("Checked 26 Sep 2026"). One "Example only · wording awaiting approval" line per page while anything on it awaits approval.
- Do not touch the shared mode pill or its weight (On Call's rebuild changes it).
- Never `git add -A`. Run `npm run format` and commit the result before each push.

## Review Focus

1. **Clock edges:** at exactly the closing minute, at midnight, and on a WA public holiday the hero must show closed and the switchboard, never "open". (Task 4 tests.)
2. **Overdue recheck:** a contact checked 91 days ago must render the overdue state and move the switchboard to the large figure, even inside opening hours. (Task 4 and Task 7 tests.)
3. **Web Share missing:** on a browser without `navigator.share`, sharing must fall back to copying and say "Copied". This lives in the kit's dial sheet; confirm the kit covers it, and First Nations' own "Copy steps" and "Copy all" must say "Copying isn't available on this phone" when `copyTextToClipboard` throws. (Task 7 tests.)
4. **Formatting-only edits:** re-indenting or reordering keys in `pages.json` must not revoke an approval; changing one word of a tip must. (Task 1 tests.)
5. **Service layer off:** with `enabled: false`, no EMHS name or number may appear on any page, the pocket card, the search index or a situation plan. (Tasks 2, 3, 6 and 8 tests.)
6. **After hours at exactly 16:30:** the switchboard is the 36 px figure, the line reads "Ask who covers liaison tonight", and the call disc dials the switchboard. (Task 7 test.)
7. **No share and no clipboard at all:** nothing throws, and the number stays visible on screen. (Task 7 test.)
8. **200 % text:** crisis numbers stay whole and on the first screen; the strip wraps to one tile per row instead of truncating. (Task 6 markup: rem-based tile basis; checked in CI's phone journeys.)
9. **Risk line without approval:** it must not appear anywhere, and editing its text after approval must hide it again. (Task 3 tests.)
10. **Region leaking:** choosing a region, ticking a box, choosing a situation or typing in the search box must not change `location.href`, call `history.pushState`/`replaceState`, write storage, call `fetch` or `sendBeacon`. (Task 7 test.)
11. **Pulse on first load:** the green dot must not pulse when the page first computes "Open now", only on a later transition. (Task 7 test.)

---

## File Structure

| Path                                                                  | Responsibility                                                                                       | Task |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---- |
| `src/data/first-nations/sources.json`                                 | Source register                                                                                      | 0    |
| `src/lib/first-nations/content-schema.ts`                             | Zod schema and types: pages, sections, modules, blocks, situations, regions, approvals, profile, map | 1    |
| `src/lib/first-nations/approval.ts`                                   | Stable hashing and approval state per section, situation, risk line and Acknowledgement              | 1    |
| `tests/fixtures/first-nations-content.ts`                             | F1: minimal valid content, sources, map, enabled profile, `approvalFor`, `contentWithNoteWording`    | 1    |
| `src/data/first-nations/pages.json`                                   | Statewide pages, six situations, risk line, statewide contacts, regions                              | 2    |
| `src/data/first-nations/approvals.json`                               | Approval records (empty at first)                                                                    | 2    |
| `src/data/first-nations/profiles/emhs.json`                           | EMHS service layer, `enabled: false`                                                                 | 2    |
| `src/data/first-nations/wa-regions-map.json`                          | WA line-map paths from public boundary data, with source and date                                    | 2    |
| `src/lib/first-nations/content.ts`                                    | Loads and validates the JSON once; `loadModelInputs()`                                               | 2    |
| `src/lib/first-nations/view-model.ts`                                 | Pure view-models for Bedside, inner pages and search; all approval gating                            | 2    |
| `src/lib/first-nations/hours.ts`                                      | Perth-time opening hours, next opening, overdue, day-track geometry, hours in words                  | 4    |
| `src/lib/first-nations/contact-format.ts`                             | `tel:` href (reuses `onCallTelHref`), share text, vCard, "26 Sep 2026" dates                         | 4    |
| `src/lib/first-nations/search.ts`                                     | `SearchEntry` and local token search                                                                 | 4    |
| `src/app/(search-app)/first-nations/**`                               | Nine thin routes, the pocket-card route, `loading.tsx`, `layout.tsx` (serif font), `error.tsx`       | 5, 6 |
| `src/components/first-nations/first-nations-nav-header.tsx`           | The one nav-header claimant for the mode                                                             | 5    |
| `src/components/first-nations/first-nations-icons.ts`                 | Module icon names to Lucide icons                                                                    | 5    |
| `src/components/first-nations/crisis.tsx`                             | Server crisis strip and crisis block from `WA_CRISIS_CONTACTS`                                       | 5    |
| `src/components/first-nations/first-nations-loading.tsx`              | Static skeleton with the real crisis strip                                                           | 5    |
| `src/fonts/newsreader-latin-400-italic.woff2`, `OFL-newsreader.txt`   | Serif accent font and its licence                                                                    | 5    |
| `src/components/first-nations/kit.ts`                                 | The only import of `src/components/mode-kit/`                                                        | 7    |
| `src/components/first-nations/voice.tsx`                              | Serif spoken words, quoted law, Acknowledgement                                                      | 7    |
| `src/components/first-nations/module-header.tsx`                      | Titled module: 28 px olive icon tile, eyebrow, optional action                                       | 7    |
| `src/components/first-nations/state-module.tsx`                       | One state module: empty, offline, error, not set up                                                  | 7    |
| `src/components/first-nations/number-button.tsx`                      | A number that opens the kit's dial sheet, plus the tile variant                                      | 7    |
| `src/components/first-nations/day-track.tsx`                          | 24-hour day track SVG                                                                                | 7    |
| `src/components/first-nations/liaison-hero.tsx`                       | Client: hero card with day track and after-hours switch                                              | 7    |
| `src/components/first-nations/tick-list.tsx`                          | Controlled tick list shared by plans and "Before you go in"                                          | 7    |
| `src/components/first-nations/situation-module.tsx`                   | Client: provider, Situation module, plan sheet, desktop side panel                                   | 7    |
| `src/components/first-nations/before-you-go-in.tsx`                   | Client: tile and five-check sheet with Undo                                                          | 7    |
| `src/components/first-nations/where-is-home.tsx`                      | Client: tile, panel, WA line map, letter lines                                                       | 7    |
| `src/components/first-nations/first-nations-search.tsx`               | Client: the mode's own search box                                                                    | 7    |
| `src/components/first-nations/phrase-deck.tsx`                        | Client: phrase deck for Talking and Family                                                           | 7    |
| `src/components/first-nations/offline-state.tsx`                      | Client: offline state module                                                                         | 7    |
| `src/components/first-nations/primer.tsx`                             | Client: once-only primer                                                                             | 7    |
| `src/components/first-nations/hospital-choice.ts`                     | Client hook: chosen hospital, account-scoped                                                         | 7    |
| `src/components/first-nations/page-menu.tsx`                          | Client: ••• menu rows, including "Log as CPD"                                                        | 7    |
| `src/components/first-nations/page-renderer.tsx`                      | Server: picks Bedside or inner page                                                                  | 6    |
| `src/components/first-nations/bedside-home.tsx`                       | Server: Bedside composition, tablet and desktop layout                                               | 6    |
| `src/components/first-nations/inner-page.tsx`                         | Server: inner pages from titled modules                                                              | 6    |
| `src/components/first-nations/blocks.tsx`                             | Server: block and module-layout rendering                                                            | 6    |
| `src/components/first-nations/pocket-card.tsx`                        | Print view of public numbers                                                                         | 8    |
| `tests/fixtures/first-nations-kit-double.tsx`                         | F2: test double for the kit, so First Nations tests do not depend on kit markup                      | 7    |
| `tests/fixtures/first-nations-models.ts`                              | F3: shared Bedside model, risk-line and Acknowledgement approvals, `resetAfterEach`                  | 7    |
| `tests/first-nations-*.test.ts`, `tests/first-nations-*.dom.test.tsx` | One test file per unit, all drawing on F1–F3                                                         | all  |

---

## Shared test fixtures

Every First Nations test draws from these three files; no test file declares its own content, model, approval record or kit stand-in. F1 is written in Task 1 (Lane A); F2 and F3 in Task 7 (Lane C). A DOM test file adds only its one `vi.mock` line for the kit (Vitest hoists mocks per file, so that line cannot be shared) and calls `resetAfterEach()`.

**F1 — `tests/fixtures/first-nations-content.ts`:** minimal valid content (one module per page, six situations, the risk line, one statewide contact, one region), sources, map, `testInputs(overrides)`, an enabled EMHS profile, `approvalFor(subjectId, content)` and `contentWithNoteWording()`.

```ts
import type { z } from "zod";
import { stableHash } from "@/lib/first-nations/approval";
import {
  contentSchema,
  firstNationsPageIds,
  parseFirstNationsContent,
  SITUATION_LABELS,
  situationIds,
  type Approval,
  type ServiceProfile,
  type Source,
  type WaMap,
} from "@/lib/first-nations/content-schema";
import type { ModelInputs } from "@/lib/first-nations/view-model";

export type ContentInput = z.input<typeof contentSchema>;

const credit = { sourceId: "src-test", checkedAt: "2026-09-26" } as const;

export function contentInput(): ContentInput {
  return {
    version: 1,
    pages: firstNationsPageIds.map((pageId) => ({
      id: pageId,
      title: pageId,
      sections: [
        {
          id: `${pageId}-main`,
          tab: "Main",
          modules: [
            {
              id: pageId === "bedside" ? "before-you-go-in" : `${pageId}-module`,
              title: "Module",
              icon: "users",
              layout: "list",
              blocks: [
                { kind: "tip", id: `${pageId}-tip`, do: `Tip on ${pageId}`, why: "Because it helps.", ...credit },
              ],
            },
          ],
        },
      ],
    })),
    situations: situationIds.map((id) => ({
      id,
      label: SITUATION_LABELS[id],
      icon: "users",
      phrases: [1, 2, 3].map((n) => ({ say: `Phrase ${n} for ${id}`, why: "It opens the conversation.", ...credit })),
      firstStepRef: "bedside-tip",
      plan: ["bedside-tip", "talking-tip", "aboriginal-interpreting-wa"],
      ...(id === "wants-to-leave" ? { riskLineRef: "wants-to-leave-risk" } : {}),
    })),
    riskLines: [
      {
        kind: "note",
        id: "wants-to-leave-risk",
        heading: "Immediate risk",
        text: "Immediate risk? Follow your hospital's Mental Health Act and security process first.",
        ...credit,
      },
    ],
    statewideContacts: [
      {
        kind: "contact",
        id: "aboriginal-interpreting-wa",
        name: "Aboriginal Interpreting WA",
        detail: "Book 24 h ahead",
        number: "1800 000 012",
        layer: "statewide",
        ...credit,
      },
    ],
    interpreterContactId: "aboriginal-interpreting-wa",
    regions: [
      {
        id: "goldfields",
        label: "Goldfields",
        serviceContactIds: ["aboriginal-interpreting-wa"],
        languages: ["Wangkatha"],
        ...credit,
      },
    ],
    reportEmail: "first-nations-numbers@example.org",
  };
}

export const testSources: Record<string, Source> = {
  "src-test": {
    id: "src-test",
    title: "Test guide",
    publisher: "WA Health",
    url: "https://example.org/guide",
    aboriginalLed: true,
    checkedAt: "2026-09-26",
  },
};

export const testMap: WaMap = {
  version: 1,
  sourceId: "src-test",
  checkedAt: "2026-09-26",
  viewBox: "0 0 100 100",
  regions: [{ id: "goldfields", path: "M50 50H90V90H50Z" }],
};

export function testInputs(overrides: Partial<ModelInputs> = {}): ModelInputs {
  return {
    content: parseFirstNationsContent(contentInput()),
    approvals: [],
    profile: null,
    sources: testSources,
    map: testMap,
    ...overrides,
  };
}

export function enabledProfile(): ServiceProfile {
  return {
    id: "emhs",
    name: "East Metropolitan Health Service",
    enabled: true,
    hospitals: [
      {
        id: "rph",
        name: "Royal Perth Hospital",
        liaisonContactId: "rph-liaison",
        switchboardContactId: "rph-switchboard",
      },
    ],
    contacts: [
      {
        kind: "contact",
        id: "rph-liaison",
        name: "Aboriginal liaison team",
        number: "9000 0001",
        hours: { days: [1, 2, 3, 4, 5], open: "08:00", close: "16:30" },
        layer: "service",
        ...credit,
      },
      { kind: "contact", id: "rph-switchboard", name: "Switchboard", number: "9000 0000", layer: "service", ...credit },
    ],
    acknowledgement: "Approved acknowledgement words.",
    contentOwnerRole: "Aboriginal Health",
    reportEmail: "aboriginal-health-numbers@example.org",
  };
}

/** An approval record whose hash matches `content` (the owner's recorded OK). */
export function approvalFor(subjectId: string, content: unknown): Approval {
  return {
    subjectId,
    body: "PsychSift",
    role: "Owner",
    date: "2026-09-27",
    reference: "cmsg_owner_ok",
    contentSha256: stableHash(content),
  };
}

/** Content with one of our own note-wording blocks on the Contacts page, which must stay hidden until approved. */
export function contentWithNoteWording(): ContentInput {
  const input = contentInput();
  const contacts = input.pages.find((p) => p.id === "contacts");
  if (!contacts) throw new Error("fixture has no contacts page");
  contacts.sections[0].modules[0].blocks.push({
    kind: "noteWording",
    id: "w1",
    heading: "Note wording",
    template: "Collaborated with [blank].",
    ...credit,
  });
  return input;
}
```

**F2 — `tests/fixtures/first-nations-kit-double.tsx`:** a plain stand-in for the kit's working API (the props table in Task 7), so First Nations tests do not depend on kit markup. If the kit's props differ when it lands, change this file and `kit.ts` together.

```tsx
import type { ReactNode } from "react";

export const modeNameText = "kit-name";
export const modeNumberText = "kit-number";

export function ModeGroupedList({ children }: { children: ReactNode }) {
  return <div data-kit="grouped-list">{children}</div>;
}
export function ModeRow({ title, detail, trailing }: { title: ReactNode; detail?: ReactNode; trailing?: ReactNode }) {
  return (
    <div data-kit="row">
      <span>{title}</span>
      {detail ? <span>{detail}</span> : null}
      {trailing}
    </div>
  );
}
export function ModeFactTiles({ children }: { children: ReactNode }) {
  return <div data-kit="fact-tiles">{children}</div>;
}
export function ModeFactTile({
  label,
  value,
  detail,
  onPress,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <button type="button" onClick={onPress}>
      <span>{label}</span> <span>{value}</span> {detail}
    </button>
  );
}
export function ModeNotice({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <div role="note" data-tone={tone}>
      {children}
    </div>
  );
}
export function ModeStateLabel({ state, children }: { state: string; children: ReactNode }) {
  return <span data-state={state}>{children}</span>;
}
export function ModeUpdatedLine({ source, checkedAt }: { source: string; checkedAt: string }) {
  return <p>{`From ${source} · Checked ${checkedAt}`}</p>;
}
export function ModeActionButton({
  variant,
  href,
  onClick,
  children,
}: {
  variant: string;
  href?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return href ? (
    <a href={href} data-variant={variant}>
      {children}
    </a>
  ) : (
    <button type="button" data-variant={variant} onClick={onClick}>
      {children}
    </button>
  );
}
export function ModeModuleSkeleton() {
  return <div data-kit="skeleton" />;
}
export function ModeDialRow({
  number,
  label,
  detail,
  footer,
}: {
  number: string;
  label: string;
  detail?: string;
  footer?: ReactNode;
}) {
  return (
    <div data-kit="dial-row">
      <span>{label}</span> <span>{number}</span> {detail}
      {footer}
    </div>
  );
}
export function ModeDialSheet({
  open,
  number,
  label,
  source,
  checkedAt,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  number: string;
  label: string;
  source: string;
  checkedAt: string;
  footer?: ReactNode;
}) {
  return open ? (
    <div role="dialog" aria-label={label}>
      <span>{number}</span>
      <span data-variant="primary">Call</span>
      <p>{`From ${source} · Checked ${checkedAt}`}</p>
      {footer}
    </div>
  ) : null;
}
```

**F3 — `tests/fixtures/first-nations-models.ts`:** the Bedside model the DOM tests share, the two approval records they need, and the one reset hook.

```ts
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import type { Approval } from "@/lib/first-nations/content-schema";
import { buildBedsideModel } from "@/lib/first-nations/view-model";
import { approvalFor, enabledProfile, testInputs } from "./first-nations-content";

/** Bedside with the service layer on; nothing approved unless approvals are passed. */
export function bedsideFixture(approvals: Approval[] = []) {
  const model = buildBedsideModel(testInputs({ profile: enabledProfile(), approvals }));
  const hospital = model.hospitals[0];
  if (!hospital) throw new Error("fixture profile has no hospital");
  return { model, hospital };
}

/** The owner's OK for the Wants to leave risk line. */
export function riskLineApproval(): Approval {
  const risk = testInputs().content.riskLines[0];
  return approvalFor(risk.id, risk);
}

/** The service's approval of the fixture profile's Acknowledgement. */
export function acknowledgementApproval(): Approval {
  const profile = enabledProfile();
  return approvalFor(`acknowledgement:${profile.id}`, profile.acknowledgement);
}

/** Call once at the top level of every First Nations DOM test file. */
export function resetAfterEach(): void {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}
```

---

### Task 0: Source register (Lane A, mid-tier)

**Files:**

- Create: `src/data/first-nations/sources.json`

**Interfaces:**

- Produces: source ids referenced by every block, phrase, region and the map (`sourceId`), shape `{ id, title, publisher, url, aboriginalLed, checkedAt }`.

- [ ] **Step 1: Run the `sources` skill** for each item the pages need: Aboriginal Interpreting WA (including which languages it books by region), 13YARN (already in `src/lib/crisis-contacts.ts`), MHA 2014 s 81 (already quoted in `data/forms-cultural-notes.json`, forms 3A–3C, `sourceId: "mha-2014-communication-and-cultural-provisions"`), Lin, Green and Bessarab 2016 clinical yarning paper, the national definition of cultural safety (AHPRA / Health Practitioner Regulation National Law), the Social and Emotional Wellbeing framework (Gee, Dudgeon et al.), Close the Gap PBS co-payment (Services Australia), WA Patient Assisted Travel Scheme (WA Health), Coroner's Court of WA information for families, the Aboriginal Health Council of WA member-service list (regional ACCHOs), WA Country Health Service regional mental health services, a public boundary dataset for the WA health regions (for the line map), a cultural safety training course for the ••• menu, and the published Aboriginal-led or WA Health cultural-care guides the tips and the 18 phrases will cite. Check every URL against the official page. Record rejected sources in the skill's register.

- [ ] **Step 2: Write `sources.json`** with only checked entries, for example:

```json
{
  "version": 1,
  "sources": [
    {
      "id": "mha-2014-s81",
      "title": "Mental Health Act 2014 (WA), section 81",
      "publisher": "Parliamentary Counsel's Office, WA",
      "url": "https://www.legislation.wa.gov.au/",
      "aboriginalLed": false,
      "checkedAt": "2026-09-26"
    }
  ]
}
```

(The URL shown is the site root only; Step 1 replaces it with the exact checked page.)

- [ ] **Step 3: Commit:** `git add src/data/first-nations/sources.json && git commit -m "First Nations: add checked source register"`

---

### Task 1: Content schema and approval hashing (Lane A, mid-tier)

**Files:**

- Create: `src/lib/first-nations/content-schema.ts`, `src/lib/first-nations/approval.ts`, `tests/fixtures/first-nations-content.ts`
- Test: `tests/first-nations-approval.test.ts`

**Interfaces:**

- Produces:
  - `firstNationsPageIds`, `FirstNationsPageId`, `FIRST_NATIONS_PAGE_TITLES`, `firstNationsPageHref(id)`.
  - `situationIds` (exactly `new-admission`, `wants-to-leave`, `family-meeting`, `mental-health-act`, `sorry-business`, `going-home`, in that order), `SituationId`, `SITUATION_LABELS`.
  - `moduleIcons`, `ModuleIcon`, `moduleLayouts`, `ModuleLayout`.
  - Types `Block` (union by `kind`: `"tip" | "avoid" | "contact" | "quote" | "steps" | "linkList" | "note" | "noteWording"`), `ContactBlock`, `NoteBlock`, `Module`, `Section`, `Page`, `Situation`, `Region`, `Approval`, `ServiceProfile`, `Source`, `WaMap`, `FirstNationsContent`.
  - Schemas `contentSchema`, `approvalSchema`, `profileSchema`, `sourceSchema`, `mapSchema`; `parseFirstNationsContent(input: unknown): FirstNationsContent` (throws with joined issues).
  - `stableHash(value)`, `approvalState(subjectId, content, approvals)`, `sectionApprovalState(section, approvals)`, `situationApprovalState(situation, approvals)`, `blockApprovalState(block, approvals)`, all returning `"approved" | "awaiting"`. Subject ids: a section's id; `situation:<id>`; the risk line's block id; `acknowledgement:<profile id>`.
  - Fixture F1 helpers `contentInput()`, `testSources`, `testMap`, `testInputs(overrides)`, `enabledProfile()`, `approvalFor(subjectId, content)`, `contentWithNoteWording()`.

- [ ] **Step 1: Write fixture F1** (`tests/fixtures/first-nations-content.ts`) from "Shared test fixtures" exactly as given there.

- [ ] **Step 2: Write the failing test** `tests/first-nations-approval.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { approvalState, blockApprovalState, sectionApprovalState } from "@/lib/first-nations/approval";
import { parseFirstNationsContent, type Section } from "@/lib/first-nations/content-schema";
import { approvalFor, contentInput } from "./fixtures/first-nations-content";

const section: Section = {
  id: "ward-respect",
  tab: "Respect",
  modules: [
    {
      id: "ward-respect-module",
      title: "Respect",
      icon: "users",
      layout: "list",
      blocks: [
        {
          kind: "tip",
          id: "t1",
          do: "Offer the Aboriginal liaison officer on admission",
          why: "Early support helps people stay for care.",
          sourceId: "s1",
          checkedAt: "2026-09-26",
        },
      ],
    },
  ],
};

describe("approval", () => {
  it("is awaiting with no approval record", () => {
    expect(sectionApprovalState(section, [])).toBe("awaiting");
  });
  it("is approved when the hash matches", () => {
    expect(sectionApprovalState(section, [approvalFor(section.id, section)])).toBe("approved");
  });
  it("survives key reordering (formatting-only edit)", () => {
    const reordered = JSON.parse(
      JSON.stringify({ modules: section.modules, tab: section.tab, id: section.id }),
    ) as Section;
    expect(sectionApprovalState(reordered, [approvalFor(section.id, section)])).toBe("approved");
  });
  it("is revoked when one word changes", () => {
    const edited = structuredClone(section);
    const tip = edited.modules[0].blocks[0];
    if (tip.kind === "tip") tip.why = "Early support helps people remain for care.";
    expect(sectionApprovalState(edited, [approvalFor(section.id, section)])).toBe("awaiting");
  });
  it("ignores a record made for another subject", () => {
    expect(approvalState("other-section", section, [approvalFor(section.id, section)])).toBe("awaiting");
  });
  it("gates the risk line on its own record", () => {
    const risk = parseFirstNationsContent(contentInput()).riskLines[0];
    expect(blockApprovalState(risk, [])).toBe("awaiting");
    expect(blockApprovalState(risk, [approvalFor(risk.id, risk)])).toBe("approved");
  });
});

describe("content schema", () => {
  it("accepts the fixture", () => {
    expect(() => parseFirstNationsContent(contentInput())).not.toThrow();
  });
  it("rejects anything but six situations", () => {
    const input = contentInput();
    input.situations = input.situations.slice(0, 5);
    expect(() => parseFirstNationsContent(input)).toThrow(/situations/);
  });
  it("rejects a situation with two phrases", () => {
    const input = contentInput();
    input.situations[0].phrases = input.situations[0].phrases.slice(0, 2);
    expect(() => parseFirstNationsContent(input)).toThrow(/phrases/);
  });
  it("rejects a plan of six steps", () => {
    const input = contentInput();
    input.situations[0].plan = [
      "bedside-tip",
      "talking-tip",
      "family-tip",
      "contacts-tip",
      "mistakes-tip",
      "on-the-ward-tip",
    ];
    expect(() => parseFirstNationsContent(input)).toThrow(/plan/);
  });
  it("rejects the risk line on any situation but Wants to leave", () => {
    const input = contentInput();
    input.situations[0].riskLineRef = "wants-to-leave-risk";
    expect(() => parseFirstNationsContent(input)).toThrow(/Wants to leave/);
  });
  it("rejects a plan step that names no tip, note or contact", () => {
    const input = contentInput();
    input.situations[2].plan = ["bedside-tip", "talking-tip", "wants-to-leave-risk"];
    expect(() => parseFirstNationsContent(input)).toThrow(/must name a tip, note or contact/);
  });
  it("rejects a tiles module without exactly four contacts", () => {
    const input = contentInput();
    const contacts = input.pages.find((p) => p.id === "contacts");
    if (!contacts) throw new Error("fixture has no contacts page");
    contacts.sections[0].modules[0] = {
      id: "contacts-tiles",
      title: "Most used",
      icon: "phone",
      layout: "tiles",
      blocks: ["a", "b", "c"].map((n) => ({
        kind: "contact" as const,
        id: `tile-${n}`,
        name: `Team ${n}`,
        number: "1800 000 012",
        layer: "statewide" as const,
        sourceId: "src-test",
        checkedAt: "2026-09-26",
      })),
    };
    expect(() => parseFirstNationsContent(input)).toThrow(/four contacts/);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm run test:focused -- --files tests/first-nations-approval.test.ts`
Expected: FAIL, cannot resolve `@/lib/first-nations/approval`.

- [ ] **Step 4: Write `content-schema.ts`**

```ts
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lower-case id with hyphens.");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM.");
const credit = { sourceId: z.string().min(1), checkedAt: day };
const base = { id: slug, ...credit };

export const firstNationsPageIds = [
  "bedside",
  "contacts",
  "talking",
  "family",
  "mental-health",
  "on-the-ward",
  "mistakes",
  "going-home",
  "end-of-life",
] as const;
export type FirstNationsPageId = (typeof firstNationsPageIds)[number];

export const FIRST_NATIONS_PAGE_TITLES: Record<FirstNationsPageId, string> = {
  bedside: "Bedside",
  contacts: "Contacts",
  talking: "Talking",
  family: "Family",
  "mental-health": "Mental health",
  "on-the-ward": "On the ward",
  mistakes: "Common mistakes",
  "going-home": "Going home",
  "end-of-life": "End of life",
};

export function firstNationsPageHref(id: FirstNationsPageId): string {
  return id === "bedside" ? "/first-nations" : `/first-nations/${id}`;
}

export const situationIds = [
  "new-admission",
  "wants-to-leave",
  "family-meeting",
  "mental-health-act",
  "sorry-business",
  "going-home",
] as const;
export type SituationId = (typeof situationIds)[number];

export const SITUATION_LABELS: Record<SituationId, string> = {
  "new-admission": "New admission",
  "wants-to-leave": "Wants to leave",
  "family-meeting": "Family meeting",
  "mental-health-act": "Mental Health Act",
  "sorry-business": "Sorry Business",
  "going-home": "Going home",
};

export const moduleIcons = [
  "users",
  "phone",
  "message",
  "check",
  "clipboard",
  "brain",
  "house",
  "map-pin",
  "feather",
  "scale",
  "shield",
  "book",
  "door",
  "bed",
] as const;
export type ModuleIcon = (typeof moduleIcons)[number];

export const moduleLayouts = [
  "list",
  "tiles",
  "deck",
  "numbered",
  "steps",
  "quote",
  "service-contacts",
  "where-is-home",
] as const;
export type ModuleLayout = (typeof moduleLayouts)[number];

const hours = z.object({ days: z.array(z.number().int().min(1).max(7)).min(1), open: hhmm, close: hhmm }).strict();

const tip = z
  .object({
    ...base,
    kind: z.literal("tip"),
    do: z.string().min(1),
    why: z.string().min(1),
    say: z.string().min(1).optional(),
  })
  .strict();
const avoid = z
  .object({ ...base, kind: z.literal("avoid"), avoid: z.string().min(1), instead: z.string().min(1) })
  .strict();
const contact = z
  .object({
    ...base,
    kind: z.literal("contact"),
    name: z.string().min(1),
    detail: z.string().optional(),
    number: z.string().min(3),
    hours: hours.optional(),
    layer: z.enum(["statewide", "service"]),
  })
  .strict();
const quote = z
  .object({ ...base, kind: z.literal("quote"), heading: z.string().min(1), text: z.string().min(1) })
  .strict();
const steps = z
  .object({
    ...base,
    kind: z.literal("steps"),
    heading: z.string().min(1),
    items: z.array(z.object({ title: z.string().min(1), detail: z.string() }).strict()).min(1),
  })
  .strict();
const linkItem = z.object({ label: z.string().min(1), detail: z.string(), href: z.string().url() }).strict();
const linkList = z
  .object({ ...base, kind: z.literal("linkList"), heading: z.string().min(1), items: z.array(linkItem).min(1) })
  .strict();
const note = z
  .object({ ...base, kind: z.literal("note"), heading: z.string().min(1), text: z.string().min(1) })
  .strict();
const noteWording = z
  .object({
    ...base,
    kind: z.literal("noteWording"),
    heading: z.string().min(1),
    template: z.string().includes("[blank]"),
  })
  .strict();

export const blockSchema = z.discriminatedUnion("kind", [
  tip,
  avoid,
  contact,
  quote,
  steps,
  linkList,
  note,
  noteWording,
]);
export type Block = z.infer<typeof blockSchema>;
export type ContactBlock = z.infer<typeof contact>;
export type NoteBlock = z.infer<typeof note>;

const EMPTY_LAYOUTS: readonly ModuleLayout[] = ["service-contacts", "where-is-home"];

export const moduleSchema = z
  .object({
    id: slug,
    title: z.string().min(1),
    icon: z.enum(moduleIcons),
    layout: z.enum(moduleLayouts),
    blocks: z.array(blockSchema),
  })
  .strict()
  .superRefine((m, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message: `${m.id}: ${message}` });
    const takesNone = EMPTY_LAYOUTS.includes(m.layout);
    if (takesNone && m.blocks.length > 0) fail("this layout takes no blocks");
    if (!takesNone && m.blocks.length === 0) fail("needs at least one block");
    if (m.layout === "tiles" && (m.blocks.length !== 4 || m.blocks.some((b) => b.kind !== "contact")))
      fail("tiles hold exactly four contacts");
    if (m.layout === "deck" && m.blocks.some((b) => b.kind !== "tip" || !b.say))
      fail("a deck holds tips with words to say");
    if (m.layout === "numbered" && m.blocks.some((b) => b.kind !== "avoid")) fail("numbered cards hold avoid items");
    if (m.layout === "quote" && m.blocks.some((b) => b.kind !== "quote")) fail("a quote module holds quotes");
    if (m.layout === "steps" && m.blocks.some((b) => b.kind !== "steps" && b.kind !== "tip"))
      fail("a steps module holds steps or tips");
  });
export type Module = z.infer<typeof moduleSchema>;

export const sectionSchema = z
  .object({ id: slug, tab: z.string().min(1).max(20), modules: z.array(moduleSchema).min(1) })
  .strict();
export type Section = z.infer<typeof sectionSchema>;

export const pageSchema = z
  .object({ id: z.enum(firstNationsPageIds), title: z.string().min(1), sections: z.array(sectionSchema).min(1) })
  .strict();
export type Page = z.infer<typeof pageSchema>;

const phrase = z.object({ say: z.string().min(1), why: z.string().min(1), ...credit }).strict();

export const situationSchema = z
  .object({
    id: z.enum(situationIds),
    label: z.string().min(1),
    icon: z.enum(moduleIcons),
    phrases: z.array(phrase).length(3, "Each situation has exactly three phrases."),
    firstStepRef: slug,
    plan: z.array(slug).min(3, "A plan has 3 to 5 steps.").max(5, "A plan has 3 to 5 steps."),
    riskLineRef: slug.optional(),
  })
  .strict();
export type Situation = z.infer<typeof situationSchema>;

export const regionSchema = z
  .object({
    id: slug,
    label: z.string().min(1),
    serviceContactIds: z.array(slug).min(1),
    languages: z.array(z.string().min(1)),
    ...credit,
  })
  .strict();
export type Region = z.infer<typeof regionSchema>;

export const approvalSchema = z
  .object({
    subjectId: z.string().min(1),
    body: z.string().min(1),
    role: z.string().min(1),
    date: day,
    reference: z.string().min(1),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type Approval = z.infer<typeof approvalSchema>;

export const profileSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    enabled: z.boolean(),
    hospitals: z.array(
      z.object({ id: slug, name: z.string().min(1), liaisonContactId: slug, switchboardContactId: slug }).strict(),
    ),
    contacts: z.array(contact),
    acknowledgement: z.string().min(1).optional(),
    contentOwnerRole: z.string().min(1),
    reportEmail: z.string().email().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const ids = new Set(p.contacts.map((c) => c.id));
    for (const h of p.hospitals)
      for (const ref of [h.liaisonContactId, h.switchboardContactId])
        if (!ids.has(ref)) ctx.addIssue({ code: "custom", message: `${h.id}: unknown contact ${ref}` });
  });
export type ServiceProfile = z.infer<typeof profileSchema>;

export const sourceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    publisher: z.string().min(1),
    url: z.string().url(),
    aboriginalLed: z.boolean(),
    checkedAt: day,
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;

export const mapSchema = z
  .object({
    version: z.literal(1),
    ...credit,
    viewBox: z.string().regex(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/),
    regions: z.array(z.object({ id: slug, path: z.string().startsWith("M") }).strict()).min(1),
  })
  .strict();
export type WaMap = z.infer<typeof mapSchema>;

const STEP_KINDS = new Set<Block["kind"]>(["tip", "note", "contact"]);

export const contentSchema = z
  .object({
    version: z.literal(1),
    pages: z.array(pageSchema).length(firstNationsPageIds.length),
    situations: z.array(situationSchema).length(situationIds.length, "There are exactly six situations."),
    riskLines: z.array(note),
    statewideContacts: z.array(contact),
    interpreterContactId: slug,
    regions: z.array(regionSchema).min(1),
    reportEmail: z.string().email().optional(),
    training: linkItem
      .extend({ ...credit })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    value.situations.forEach((s, i) => {
      if (s.id !== situationIds[i]) fail(`Situation ${i + 1} must be ${situationIds[i]}`);
      if (s.label !== SITUATION_LABELS[s.id]) fail(`${s.id} must be labelled "${SITUATION_LABELS[s.id]}"`);
    });
    for (const id of firstNationsPageIds) if (!value.pages.some((p) => p.id === id)) fail(`Missing page ${id}`);

    const blocks = new Map<string, Block>();
    const add = (b: Block) => {
      if (blocks.has(b.id)) fail(`Duplicate block id ${b.id}`);
      blocks.set(b.id, b);
    };
    for (const page of value.pages)
      for (const section of page.sections) for (const mod of section.modules) mod.blocks.forEach(add);
    value.statewideContacts.forEach(add);
    const riskIds = new Set(value.riskLines.map((r) => r.id));
    value.riskLines.forEach(add);

    for (const s of value.situations) {
      for (const ref of [s.firstStepRef, ...s.plan]) {
        const b = blocks.get(ref);
        if (!b || riskIds.has(ref) || !STEP_KINDS.has(b.kind))
          fail(`${s.id}: step ${ref} must name a tip, note or contact`);
      }
      const isWantsToLeave = s.id === "wants-to-leave";
      if (isWantsToLeave !== Boolean(s.riskLineRef))
        fail(`${s.id}: only "Wants to leave" carries the immediate-risk line`);
      if (s.riskLineRef && !riskIds.has(s.riskLineRef)) fail(`${s.id}: unknown risk line ${s.riskLineRef}`);
    }

    const contactIds = new Set(value.statewideContacts.map((c) => c.id));
    if (!contactIds.has(value.interpreterContactId)) fail(`Unknown interpreter contact ${value.interpreterContactId}`);
    for (const r of value.regions)
      for (const id of r.serviceContactIds) if (!contactIds.has(id)) fail(`${r.id}: unknown contact ${id}`);
  });
export type FirstNationsContent = z.infer<typeof contentSchema>;

export function parseFirstNationsContent(input: unknown): FirstNationsContent {
  const result = contentSchema.safeParse(input);
  if (!result.success) throw new Error(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return result.data;
}
```

- [ ] **Step 5: Write `approval.ts`**

```ts
import { createHash } from "node:crypto";
import type { Approval, Block, Section, Situation } from "@/lib/first-nations/content-schema";

export type ApprovalState = "approved" | "awaiting";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function approvalState(subjectId: string, content: unknown, approvals: readonly Approval[]): ApprovalState {
  const record = approvals.find((a) => a.subjectId === subjectId);
  return record && record.contentSha256 === stableHash(content) ? "approved" : "awaiting";
}

export const sectionApprovalState = (section: Section, approvals: readonly Approval[]): ApprovalState =>
  approvalState(section.id, section, approvals);

export const situationApprovalState = (situation: Situation, approvals: readonly Approval[]): ApprovalState =>
  approvalState(`situation:${situation.id}`, situation, approvals);

export const blockApprovalState = (block: Block, approvals: readonly Approval[]): ApprovalState =>
  approvalState(block.id, block, approvals);
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npm run test:focused -- --files tests/first-nations-approval.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 7: Commit:** `git add src/lib/first-nations/content-schema.ts src/lib/first-nations/approval.ts tests/fixtures/first-nations-content.ts tests/first-nations-approval.test.ts && git commit -m "First Nations: content schema, six fixed situations and hash-pinned approval"`

---

### Task 2: Content files, loader and view-model (Lane A, mid-tier)

**Files:**

- Create: `src/data/first-nations/pages.json`, `approvals.json`, `profiles/emhs.json`, `wa-regions-map.json`, `src/lib/first-nations/content.ts`, `src/lib/first-nations/view-model.ts`
- Test: `tests/first-nations-content.test.ts`

**Interfaces:**

- Consumes: Task 1 schema and approval functions; Task 0 source ids; the `SearchEntry` type from Task 4 (`import type`, so the lanes do not block each other).
- Produces:
  - `content.ts`: `loadModelInputs(): ModelInputs`, `getServiceProfile(): ServiceProfile | null` (null when disabled), `getContacts(): ContactBlock[]` (statewide, plus service contacts only when enabled), `getSources(): Source[]`.
  - `view-model.ts`: types `ModelInputs`, `SourceView`, `ContactView`, `StepView`, `PhraseView`, `SituationView`, `HospitalView`, `RegionView`, `AvoidView`, `BlockView`, `ModuleView`, `SectionView`, `BedsideModel`, `InnerPageModel`; functions `buildBedsideModel(inputs)`, `buildInnerPageModel(inputs, pageId)`, `buildSearchIndex(inputs)`, `situationViews(inputs)`, `hospitalViews(inputs)`.

- [ ] **Step 1: Write the failing test** `tests/first-nations-content.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { getContacts, getServiceProfile, loadModelInputs } from "@/lib/first-nations/content";
import { firstNationsPageIds, situationIds } from "@/lib/first-nations/content-schema";
import { buildBedsideModel, buildInnerPageModel, buildSearchIndex } from "@/lib/first-nations/view-model";

const inputs = loadModelInputs();

describe("First Nations content", () => {
  it("has all nine pages and the six fixed situations", () => {
    expect(inputs.content.pages.map((p) => p.id).sort()).toEqual([...firstNationsPageIds].sort());
    expect(inputs.content.situations.map((s) => s.id)).toEqual([...situationIds]);
  });
  it("references only registered sources", () => {
    const known = new Set(Object.keys(inputs.sources));
    const used = [
      ...inputs.content.pages.flatMap((p) =>
        p.sections.flatMap((s) => s.modules.flatMap((m) => m.blocks.map((b) => b.sourceId))),
      ),
      ...inputs.content.situations.flatMap((s) => s.phrases.map((p) => p.sourceId)),
      ...inputs.content.statewideContacts.map((c) => c.sourceId),
      ...inputs.content.riskLines.map((r) => r.sourceId),
      ...inputs.content.regions.map((r) => r.sourceId),
      inputs.map.sourceId,
    ];
    for (const id of used) expect(known.has(id), id).toBe(true);
  });
  it("draws a map region for every content region and nothing else", () => {
    expect(inputs.map.regions.map((r) => r.id).sort()).toEqual(inputs.content.regions.map((r) => r.id).sort());
  });
  it("hides the EMHS layer everywhere while it is disabled", () => {
    expect(getServiceProfile()).toBeNull();
    expect(getContacts().every((c) => c.layer === "statewide")).toBe(true);
    const everything = JSON.stringify([
      buildBedsideModel(inputs),
      ...firstNationsPageIds.filter((id) => id !== "bedside").map((id) => buildInnerPageModel(inputs, id)),
      buildSearchIndex(inputs),
    ]);
    expect(everything).not.toMatch(/Royal Perth|East Metropolitan|EMHS/);
    expect(buildBedsideModel(inputs).hospitals).toEqual([]);
  });
  it("builds every inner page without throwing", () => {
    for (const id of firstNationsPageIds)
      if (id !== "bedside") expect(buildInnerPageModel(inputs, id).sections.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:focused -- --files tests/first-nations-content.test.ts`
Expected: FAIL, cannot resolve `@/lib/first-nations/content`.

- [ ] **Step 3: Write the data files.**

`pages.json` follows `contentSchema`, with tips, phrases and avoid items only from Task 0's register. Pages, tabs (sections) and module layouts, following spec §3:

| Page            | Sections (tabs)                          | Modules                                                                                                                                                                                                                                              |
| --------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bedside         | one section, `bedside`, tab "Bedside"    | `before-you-go-in` (`list`, exactly five tips: offer the liaison officer; ask who should be there; ask about language; ask where home is; check for Sorry Business)                                                                                  |
| Contacts        | Hospital · Community · Mental · Language | Hospital: `tiles` (the four statewide numbers used most, from Task 0) and `service-contacts`; Community: `list` of ACCHOs plus a `linkList` to Services with the Aboriginal filter; Mental: `list`; Language: `list` with Aboriginal Interpreting WA |
| Talking         | Yarning · Asking · Language · Be aware   | Yarning: `deck` then `list` "Opening"; Asking: `list` (asking about identity, text only); Language: `list`; Be aware: `list` of `note` background facts                                                                                              |
| Family          | Kinship · Consent · Visitors · Safety    | Kinship: `deck` then `list` "Who to involve"; Consent: `list`; Visitors: `list`; Safety: `list` and `linkList`                                                                                                                                       |
| Mental health   | Act · Assessment · Wellbeing · Restraint | Act: `quote` (s 81 copied verbatim from `data/forms-cultural-notes.json`, forms 3A–3C) and `steps` "Before you assess" (three items); Assessment: `list` with the `noteWording` "What to record"; Wellbeing: `linkList` (SEWB); Restraint: `list`    |
| On the ward     | Respect · Healing · Country · Bias       | `list` modules                                                                                                                                                                                                                                       |
| Common mistakes | Talking · Family · Mental · Ward         | `numbered` modules of `avoid` items                                                                                                                                                                                                                  |
| Going home      | Leaving · Medicines · Travel · Follow-up | Leaving: `steps` and `list`; Medicines: `list` (Close the Gap); Travel: `list` (PATS); Follow-up: `where-is-home` and a `linkList` of Aboriginal-produced patient materials                                                                          |
| End of life     | Family · Country · Afterwards · Coroner  | `list` modules and a `linkList` (coroner)                                                                                                                                                                                                            |

The six situations use the ids and labels fixed in Task 1, three credited phrases each (the mockup phrases, for example "Is there someone you would like with you while we talk?" for New admission and "Can you tell me what is pulling you away? We might be able to help with it." for Wants to leave, kept only if Task 0 finds a source that supports them), a `firstStepRef` and a `plan` of three to five refs to existing tips, notes or contacts. `riskLines` holds one `note` with id `wants-to-leave-risk`, heading "Immediate risk", text "Immediate risk? Follow your hospital's Mental Health Act and security process first." and the `wants-to-leave` situation sets `riskLineRef: "wants-to-leave-risk"`. `statewideContacts` holds Aboriginal Interpreting WA (id `aboriginal-interpreting-wa`, referenced by `interpreterContactId`) and every regional service. `regions` lists the WA health regions from the Task 0 boundary source, each with its services and the languages Aboriginal Interpreting WA books there. `reportEmail` is set only if the owner supplies a role address during this task; never put a personal address in the public repository.

`approvals.json` is `{ "version": 1, "approvals": [] }`. The risk line's record is added later, in its own commit, only after the owner types OK in the thread: `{ "subjectId": "wants-to-leave-risk", "body": "Clinical owner", "role": "Psychiatrist, project owner", "date": "<day>", "reference": "<cmsg_ id of the OK message>", "contentSha256": "<stableHash of the note>" }`.

`profiles/emhs.json`:

```json
{
  "id": "emhs",
  "name": "East Metropolitan Health Service",
  "enabled": false,
  "hospitals": [],
  "contacts": [],
  "contentOwnerRole": "EMHS Aboriginal Health (role to be confirmed in the agreement)"
}
```

(Real RPH team and switchboard numbers and the hospital entry are added only after Task 0 checks them, and stay invisible until `enabled` is set by a later PR carrying the agreement.)

`wa-regions-map.json`: produce it once from the Task 0 boundary dataset, downloaded to the scratchpad (`$SCRATCH`), with a pinned mapshaper that is not added to `package.json`:

```bash
npx --yes mapshaper@0.6.113 "$SCRATCH/wa-health-regions.geojson" -proj EPSG:3857 -simplify 1.5% keep-shapes -o "$SCRATCH/wa-simple.geojson" format=geojson
node "$SCRATCH/geo-to-svg.mjs" "$SCRATCH/wa-simple.geojson" src/data/first-nations/wa-regions-map.json <sourceId> <checkedAt>
```

with `$SCRATCH/geo-to-svg.mjs` (not committed; set `NAME_FIELD` and the `IDS` keys to the dataset's own region-name field and values):

```js
import { readFileSync, writeFileSync } from "node:fs";

const [input, output, sourceId, checkedAt] = process.argv.slice(2);
const NAME_FIELD = "NAME";
const IDS = {
  Kimberley: "kimberley",
  Pilbara: "pilbara",
  Midwest: "midwest",
  Goldfields: "goldfields",
  Wheatbelt: "wheatbelt",
  "Great Southern": "great-southern",
  "South West": "south-west",
  Metropolitan: "perth",
};
const geo = JSON.parse(readFileSync(input, "utf8"));
const rings = (g) => (g.type === "Polygon" ? g.coordinates : g.coordinates.flat());
let minX = Infinity,
  minY = Infinity,
  maxX = -Infinity,
  maxY = -Infinity;
for (const f of geo.features)
  for (const ring of rings(f.geometry))
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
const scale = 1000 / (maxY - minY);
const pt = ([x, y]) => `${((x - minX) * scale).toFixed(1)} ${((maxY - y) * scale).toFixed(1)}`;
const regions = geo.features.map((f) => {
  const id = IDS[f.properties[NAME_FIELD]];
  if (!id) throw new Error(`Unmapped region ${f.properties[NAME_FIELD]}`);
  return {
    id,
    path: rings(f.geometry)
      .map((r) => `M${r.map(pt).join("L")}Z`)
      .join(""),
  };
});
const width = Math.ceil((maxX - minX) * scale);
writeFileSync(
  output,
  `${JSON.stringify({ version: 1, sourceId, checkedAt, viewBox: `0 0 ${width} 1000`, regions }, null, 2)}\n`,
);
```

Coordinates are rounded to one decimal so no path can match the mobile-number guard in Task 3.

- [ ] **Step 4: Write `content.ts`**

```ts
import approvalsJson from "@/data/first-nations/approvals.json";
import pagesJson from "@/data/first-nations/pages.json";
import emhsJson from "@/data/first-nations/profiles/emhs.json";
import sourcesJson from "@/data/first-nations/sources.json";
import mapJson from "@/data/first-nations/wa-regions-map.json";
import { z } from "zod";
import {
  approvalSchema,
  mapSchema,
  parseFirstNationsContent,
  profileSchema,
  sourceSchema,
  type ContactBlock,
  type ServiceProfile,
  type Source,
} from "@/lib/first-nations/content-schema";
import type { ModelInputs } from "@/lib/first-nations/view-model";

const CONTENT = parseFirstNationsContent(pagesJson);
const APPROVALS = z
  .object({ version: z.literal(1), approvals: z.array(approvalSchema) })
  .strict()
  .parse(approvalsJson).approvals;
const PROFILE: ServiceProfile = profileSchema.parse(emhsJson);
const SOURCES: Source[] = z
  .object({ version: z.literal(1), sources: z.array(sourceSchema) })
  .strict()
  .parse(sourcesJson).sources;
const MAP = mapSchema.parse(mapJson);

export const getServiceProfile = (): ServiceProfile | null => (PROFILE.enabled ? PROFILE : null);
export const getSources = (): Source[] => SOURCES;

export function getContacts(): ContactBlock[] {
  return [...CONTENT.statewideContacts, ...(PROFILE.enabled ? PROFILE.contacts : [])];
}

export function loadModelInputs(): ModelInputs {
  return {
    content: CONTENT,
    approvals: APPROVALS,
    profile: getServiceProfile(),
    sources: Object.fromEntries(SOURCES.map((s) => [s.id, s])),
    map: MAP,
  };
}
```

- [ ] **Step 5: Write `view-model.ts`**

```ts
import {
  approvalState,
  blockApprovalState,
  sectionApprovalState,
  situationApprovalState,
} from "@/lib/first-nations/approval";
import {
  firstNationsPageHref,
  FIRST_NATIONS_PAGE_TITLES,
  type Approval,
  type Block,
  type ContactBlock,
  type FirstNationsContent,
  type FirstNationsPageId,
  type ModuleIcon,
  type ModuleLayout,
  type Page,
  type ServiceProfile,
  type SituationId,
  type Source,
  type WaMap,
} from "@/lib/first-nations/content-schema";
import type { SearchEntry } from "@/lib/first-nations/search";

export type ModelInputs = {
  content: FirstNationsContent;
  approvals: readonly Approval[];
  profile: ServiceProfile | null;
  sources: Readonly<Record<string, Source>>;
  map: WaMap;
};

export type SourceView = { title: string; url: string };
export type ContactView = {
  id: string;
  name: string;
  detail: string;
  number: string;
  hours: ContactBlock["hours"] | null;
  checkedAt: string;
  source: SourceView;
  reportHref: string | null;
};
export type StepView = {
  id: string;
  title: string;
  detail: string;
  contact: ContactView | null;
  awaiting: boolean;
  source: SourceView;
};
export type PhraseView = { say: string; why: string; checkedAt: string; source: SourceView };
export type SituationView = {
  id: SituationId;
  label: string;
  icon: ModuleIcon;
  phrases: PhraseView[];
  firstStep: StepView;
  plan: StepView[];
  riskLine: string | null;
  awaiting: boolean;
};
export type HospitalView = { id: string; name: string; liaison: ContactView; switchboard: ContactView };
export type RegionView = {
  id: string;
  label: string;
  services: ContactView[];
  languages: string[];
  checkedAt: string;
  source: SourceView;
};
export type AvoidView = { id: string; avoid: string; instead: string; checkedAt: string; source: SourceView };
export type BlockView = { block: Block; source: SourceView; contact: ContactView | null };
export type ModuleView = { id: string; title: string; icon: ModuleIcon; layout: ModuleLayout; blocks: BlockView[] };
export type SectionView = { id: string; tab: string; awaiting: boolean; modules: ModuleView[] };

export type BedsideModel = {
  showExampleLine: boolean;
  hospitals: HospitalView[];
  situations: SituationView[];
  beforeYouGoIn: StepView[];
  regions: RegionView[];
  interpreter: ContactView | null;
  map: WaMap;
  acknowledgement: string | null;
  topMistakes: AvoidView[];
  missingNumberHref: string | null;
  search: SearchEntry[];
};

export type InnerPageModel = {
  id: FirstNationsPageId;
  title: string;
  showExampleLine: boolean;
  sections: SectionView[];
  serviceContacts: ContactView[];
  regions: RegionView[];
  interpreter: ContactView | null;
  map: WaMap;
  missingNumberHref: string | null;
  search: SearchEntry[];
};

function sourceView(inputs: ModelInputs, id: string): SourceView {
  const source = inputs.sources[id];
  if (!source) throw new Error(`Unknown First Nations source ${id}`);
  return { title: source.title, url: source.url };
}

function reportEmail(inputs: ModelInputs): string | undefined {
  return inputs.profile?.enabled && inputs.profile.reportEmail
    ? inputs.profile.reportEmail
    : inputs.content.reportEmail;
}

function mailto(address: string | undefined, subject: string, body: string): string | null {
  if (!address) return null;
  const params = new URLSearchParams({ subject, body }).toString().replace(/\+/g, "%20");
  return `mailto:${address}?${params}`;
}

function contactView(c: ContactBlock, inputs: ModelInputs): ContactView {
  return {
    id: c.id,
    name: c.name,
    detail: c.detail ?? "",
    number: c.number,
    hours: c.hours ?? null,
    checkedAt: c.checkedAt,
    source: sourceView(inputs, c.sourceId),
    reportHref: mailto(
      reportEmail(inputs),
      `Wrong number: ${c.name}`,
      `The number shown for ${c.name} is ${c.number}. The right number is: `,
    ),
  };
}

type Indexed = { block: Block; awaiting: boolean };

function indexBlocks(inputs: ModelInputs): Map<string, Indexed> {
  const index = new Map<string, Indexed>();
  for (const page of inputs.content.pages)
    for (const section of page.sections) {
      const awaiting = sectionApprovalState(section, inputs.approvals) !== "approved";
      for (const mod of section.modules) for (const block of mod.blocks) index.set(block.id, { block, awaiting });
    }
  for (const c of inputs.content.statewideContacts) index.set(c.id, { block: c, awaiting: false });
  return index;
}

function stepView(ref: string, index: Map<string, Indexed>, inputs: ModelInputs): StepView {
  const hit = index.get(ref);
  if (!hit) throw new Error(`Unknown First Nations step ${ref}`);
  const { block, awaiting } = hit;
  const source = sourceView(inputs, block.sourceId);
  switch (block.kind) {
    case "tip":
      return { id: block.id, title: block.do, detail: block.why, contact: null, awaiting, source };
    case "note":
      return { id: block.id, title: block.heading, detail: block.text, contact: null, awaiting, source };
    case "contact":
      return {
        id: block.id,
        title: `Call ${block.name}`,
        detail: block.detail ?? "",
        contact: contactView(block, inputs),
        awaiting,
        source,
      };
    default:
      throw new Error(`Step ${ref} is a ${block.kind}; steps name a tip, note or contact`);
  }
}

function page(inputs: ModelInputs, id: FirstNationsPageId): Page {
  const found = inputs.content.pages.find((p) => p.id === id);
  if (!found) throw new Error(`Missing First Nations page ${id}`);
  return found;
}

export function situationViews(inputs: ModelInputs): SituationView[] {
  const index = indexBlocks(inputs);
  return inputs.content.situations.map((s) => {
    const plan = s.plan.map((ref) => stepView(ref, index, inputs));
    const firstStep = stepView(s.firstStepRef, index, inputs);
    const risk = s.riskLineRef ? inputs.content.riskLines.find((r) => r.id === s.riskLineRef) : undefined;
    const riskLine = risk && blockApprovalState(risk, inputs.approvals) === "approved" ? risk.text : null;
    return {
      id: s.id,
      label: s.label,
      icon: s.icon,
      phrases: s.phrases.map((p) => ({
        say: p.say,
        why: p.why,
        checkedAt: p.checkedAt,
        source: sourceView(inputs, p.sourceId),
      })),
      firstStep,
      plan,
      riskLine,
      awaiting:
        situationApprovalState(s, inputs.approvals) !== "approved" ||
        firstStep.awaiting ||
        plan.some((p) => p.awaiting),
    };
  });
}

export function hospitalViews(inputs: ModelInputs): HospitalView[] {
  const profile = inputs.profile;
  if (!profile?.enabled) return [];
  const byId = new Map(profile.contacts.map((c) => [c.id, c]));
  return profile.hospitals.flatMap((h) => {
    const liaison = byId.get(h.liaisonContactId);
    const switchboard = byId.get(h.switchboardContactId);
    return liaison && switchboard
      ? [
          {
            id: h.id,
            name: h.name,
            liaison: contactView(liaison, inputs),
            switchboard: contactView(switchboard, inputs),
          },
        ]
      : [];
  });
}

function statewideById(inputs: ModelInputs): Map<string, ContactBlock> {
  return new Map(inputs.content.statewideContacts.map((c) => [c.id, c]));
}

function regionViews(inputs: ModelInputs): RegionView[] {
  const byId = statewideById(inputs);
  return inputs.content.regions.map((r) => ({
    id: r.id,
    label: r.label,
    services: r.serviceContactIds.flatMap((id) => {
      const c = byId.get(id);
      return c ? [contactView(c, inputs)] : [];
    }),
    languages: r.languages,
    checkedAt: r.checkedAt,
    source: sourceView(inputs, r.sourceId),
  }));
}

function interpreterView(inputs: ModelInputs): ContactView | null {
  const c = statewideById(inputs).get(inputs.content.interpreterContactId);
  return c ? contactView(c, inputs) : null;
}

function sectionViews(p: Page, inputs: ModelInputs): SectionView[] {
  return p.sections.map((section) => {
    const awaiting = sectionApprovalState(section, inputs.approvals) !== "approved";
    return {
      id: section.id,
      tab: section.tab,
      awaiting,
      modules: section.modules.map((m) => ({
        id: m.id,
        title: m.title,
        icon: m.icon,
        layout: m.layout,
        // Our own wording never renders before approval (spec §4).
        blocks: m.blocks
          .filter((b) => !(b.kind === "noteWording" && awaiting))
          .map((b) => ({
            block: b,
            source: sourceView(inputs, b.sourceId),
            contact: b.kind === "contact" ? contactView(b, inputs) : null,
          })),
      })),
    };
  });
}

function searchText(block: Block): { title: string; detail: string } {
  switch (block.kind) {
    case "tip":
      return { title: block.do, detail: [block.why, block.say].filter(Boolean).join(" · ") };
    case "avoid":
      return { title: block.avoid, detail: block.instead };
    case "contact":
      return { title: block.name, detail: block.detail ?? "" };
    case "quote":
    case "note":
      return { title: block.heading, detail: block.text };
    case "steps":
      return { title: block.heading, detail: block.items.map((i) => i.title).join(" · ") };
    case "linkList":
      return { title: block.heading, detail: block.items.map((i) => i.label).join(" · ") };
    case "noteWording":
      return { title: block.heading, detail: block.template };
  }
}

export function buildSearchIndex(inputs: ModelInputs): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const p of inputs.content.pages)
    for (const section of sectionViews(p, inputs))
      for (const m of section.modules)
        for (const { block } of m.blocks) {
          const text = searchText(block);
          entries.push({
            id: block.id,
            ...text,
            href: `${firstNationsPageHref(p.id)}#${section.id}`,
            ...(block.kind === "contact" ? { number: block.number } : {}),
          });
        }
  for (const c of inputs.content.statewideContacts)
    entries.push({
      id: c.id,
      title: c.name,
      detail: c.detail ?? "",
      href: firstNationsPageHref("contacts"),
      number: c.number,
    });
  for (const h of hospitalViews(inputs))
    for (const c of [h.liaison, h.switchboard])
      entries.push({
        id: c.id,
        title: c.name,
        detail: h.name,
        href: firstNationsPageHref("contacts"),
        number: c.number,
      });
  for (const s of inputs.content.situations)
    entries.push({
      id: `situation-${s.id}`,
      title: s.label,
      detail: "Situation",
      href: firstNationsPageHref("bedside"),
    });
  return entries;
}

function acknowledgementFor(inputs: ModelInputs): string | null {
  const profile = inputs.profile;
  if (!profile?.enabled || !profile.acknowledgement) return null;
  return approvalState(`acknowledgement:${profile.id}`, profile.acknowledgement, inputs.approvals) === "approved"
    ? profile.acknowledgement
    : null;
}

export function buildBedsideModel(inputs: ModelInputs): BedsideModel {
  const index = indexBlocks(inputs);
  const situations = situationViews(inputs);
  const checks = page(inputs, "bedside")
    .sections.flatMap((s) => s.modules)
    .find((m) => m.id === "before-you-go-in");
  const beforeYouGoIn = (checks?.blocks ?? []).map((b) => stepView(b.id, index, inputs));
  const topMistakes = page(inputs, "mistakes")
    .sections.flatMap((s) => s.modules.flatMap((m) => m.blocks))
    .flatMap((b) => (b.kind === "avoid" ? [b] : []))
    .slice(0, 3)
    .map((b) => ({
      id: b.id,
      avoid: b.avoid,
      instead: b.instead,
      checkedAt: b.checkedAt,
      source: sourceView(inputs, b.sourceId),
    }));
  return {
    showExampleLine: situations.some((s) => s.awaiting) || beforeYouGoIn.some((s) => s.awaiting),
    hospitals: hospitalViews(inputs),
    situations,
    beforeYouGoIn,
    regions: regionViews(inputs),
    interpreter: interpreterView(inputs),
    map: inputs.map,
    acknowledgement: acknowledgementFor(inputs),
    topMistakes,
    missingNumberHref: mailto(reportEmail(inputs), "Missing number", "The number that is missing is for: "),
    search: buildSearchIndex(inputs),
  };
}

export function buildInnerPageModel(inputs: ModelInputs, id: Exclude<FirstNationsPageId, "bedside">): InnerPageModel {
  const sections = sectionViews(page(inputs, id), inputs);
  return {
    id,
    title: FIRST_NATIONS_PAGE_TITLES[id],
    showExampleLine: sections.some((s) => s.awaiting),
    sections,
    serviceContacts: inputs.profile?.enabled ? inputs.profile.contacts.map((c) => contactView(c, inputs)) : [],
    regions: regionViews(inputs),
    interpreter: interpreterView(inputs),
    map: inputs.map,
    missingNumberHref: mailto(reportEmail(inputs), "Missing number", "The number that is missing is for: "),
    search: buildSearchIndex(inputs),
  };
}
```

In `tests/first-nations-content.test.ts` the inner-page loop passes `id` narrowed with `if (id !== "bedside")`; TypeScript narrows the literal union, so no cast is needed.

- [ ] **Step 6: Run and confirm pass**

Run: `npm run test:focused -- --files tests/first-nations-content.test.ts tests/first-nations-approval.test.ts`
Expected: PASS (5 + 13 tests).

- [ ] **Step 7: Commit:** `git add src/data/first-nations/pages.json src/data/first-nations/approvals.json src/data/first-nations/profiles/emhs.json src/data/first-nations/wa-regions-map.json src/lib/first-nations/content.ts src/lib/first-nations/view-model.ts tests/first-nations-content.test.ts && git commit -m "First Nations: statewide content, WA map, EMHS profile (disabled), loader and view-model"`

---

### Task 3: Content guard and view-model contract (Lane A, mid-tier)

**Files:**

- Test: `tests/first-nations-content-guard.test.ts`, `tests/first-nations-view-model.test.ts`

**Interfaces:**

- Consumes: the raw JSON files under `src/data/first-nations/`; the Task 1 fixture; the Task 2 view-model.

- [ ] **Step 1: Write `tests/first-nations-content-guard.test.ts`**

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = "src/data/first-nations";
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
}
const all = files(ROOT).map((path) => ({ path, text: readFileSync(path, "utf8") }));
const pages = JSON.parse(readFileSync(join(ROOT, "pages.json"), "utf8")) as {
  pages: { id: string; sections: { modules: { id: string; blocks: unknown[] }[] }[] }[];
  situations: { id: string; phrases: { sourceId?: string; checkedAt?: string }[]; plan: string[] }[];
  statewideContacts: { name: string }[];
};
const approvals = JSON.parse(readFileSync(join(ROOT, "approvals.json"), "utf8")) as {
  approvals: { subjectId: string; role: string; reference: string }[];
};

function walk(value: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
  else if (value && typeof value === "object") {
    visit(value as Record<string, unknown>);
    Object.values(value).forEach((v) => walk(v, visit));
  }
}

describe("First Nations content guard", () => {
  it("contains no mobile numbers", () => {
    for (const { path, text } of all) expect(text, path).not.toMatch(/\b04\d{2}[\s-]?\d{3}[\s-]?\d{3}\b|\+614\d{8}/);
  });
  it("never claims sign-off inside content", () => {
    for (const { path, text } of all)
      if (!path.endsWith("approvals.json"))
        expect(text, path).not.toMatch(/"(reviewed|signedOff|signed_off|verified)"|"approved"\s*:\s*true/i);
  });
  it("names no individual staff (contacts are teams, services or lines)", () => {
    for (const c of pages.statewideContacts)
      expect(c.name).toMatch(/team|service|line|switchboard|liaison|interpreting|13YARN|health|council|clinic/i);
  });
  it("ships the EMHS layer disabled", () => {
    expect(JSON.parse(readFileSync(join(ROOT, "profiles/emhs.json"), "utf8")).enabled).toBe(false);
  });
  it("gives every block and phrase a source and a checked date", () => {
    walk(pages, (o) => {
      if ("kind" in o || "say" in o) {
        expect(typeof o.sourceId, JSON.stringify(o)).toBe("string");
        expect(o.checkedAt, JSON.stringify(o)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });
  it("has exactly six situations with three phrases and a 3–5 step plan", () => {
    expect(pages.situations.map((s) => s.id)).toEqual([
      "new-admission",
      "wants-to-leave",
      "family-meeting",
      "mental-health-act",
      "sorry-business",
      "going-home",
    ]);
    for (const s of pages.situations) {
      expect(s.phrases, s.id).toHaveLength(3);
      expect(s.plan.length, s.id).toBeGreaterThanOrEqual(3);
      expect(s.plan.length, s.id).toBeLessThanOrEqual(5);
    }
  });
  it("has five checks in Before you go in", () => {
    const bedside = pages.pages.find((p) => p.id === "bedside");
    const checks = bedside?.sections.flatMap((s) => s.modules).find((m) => m.id === "before-you-go-in");
    expect(checks?.blocks).toHaveLength(5);
  });
  it("records the risk line's approval only as the owner's typed OK in the thread", () => {
    for (const a of approvals.approvals.filter((r) => r.subjectId === "wants-to-leave-risk")) {
      expect(a.role).toBe("Owner");
      expect(a.reference).toMatch(/^cmsg_/);
    }
  });
});
```

- [ ] **Step 2: Write `tests/first-nations-view-model.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseFirstNationsContent } from "@/lib/first-nations/content-schema";
import { buildBedsideModel, buildInnerPageModel, buildSearchIndex } from "@/lib/first-nations/view-model";
import {
  approvalFor,
  contentInput,
  contentWithNoteWording,
  enabledProfile,
  testInputs,
} from "./fixtures/first-nations-content";

const wantsToLeave = (inputs = testInputs()) =>
  buildBedsideModel(inputs).situations.find((s) => s.id === "wants-to-leave");

describe("First Nations view-model contract", () => {
  it("keeps the immediate-risk line hidden until its approval record exists", () => {
    expect(wantsToLeave()?.riskLine).toBeNull();
    expect(JSON.stringify(buildBedsideModel(testInputs()))).not.toMatch(/Immediate risk\?/);
  });
  it("shows the risk line once the owner's OK is recorded", () => {
    const inputs = testInputs();
    const risk = inputs.content.riskLines[0];
    expect(wantsToLeave(testInputs({ approvals: [approvalFor(risk.id, risk)] }))?.riskLine).toBe(risk.text);
  });
  it("hides the risk line again when its words change after approval", () => {
    const original = testInputs().content.riskLines[0];
    const input = contentInput();
    input.riskLines[0].text = "Immediate risk? Call security.";
    const inputs = testInputs({
      content: parseFirstNationsContent(input),
      approvals: [approvalFor(original.id, original)],
    });
    expect(wantsToLeave(inputs)?.riskLine).toBeNull();
  });
  it("resolves plan steps from the blocks they reference", () => {
    const s = buildBedsideModel(testInputs()).situations[0];
    expect(s.plan.map((p) => p.title)).toEqual(["Tip on bedside", "Tip on talking", "Call Aboriginal Interpreting WA"]);
    expect(s.phrases).toHaveLength(3);
    expect(s.awaiting).toBe(true);
  });
  it("never renders or indexes our own note wording before approval", () => {
    const inputs = testInputs({ content: parseFirstNationsContent(contentWithNoteWording()) });
    expect(JSON.stringify(buildInnerPageModel(inputs, "contacts"))).not.toMatch(/Collaborated with/);
    expect(buildSearchIndex(inputs).some((e) => e.id === "w1")).toBe(false);
  });
  it("shows the hospital hero and Acknowledgement only with the layer on and approved words", () => {
    const profile = enabledProfile();
    expect(buildBedsideModel(testInputs({ profile })).hospitals[0]?.liaison.number).toBe("9000 0001");
    expect(buildBedsideModel(testInputs({ profile })).acknowledgement).toBeNull();
    const ack = approvalFor(`acknowledgement:${profile.id}`, profile.acknowledgement);
    expect(buildBedsideModel(testInputs({ profile, approvals: [ack] })).acknowledgement).toBe(profile.acknowledgement);
    expect(buildBedsideModel(testInputs({ profile: { ...profile, enabled: false } })).hospitals).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them**

Run: `npm run test:focused -- --files tests/first-nations-content-guard.test.ts tests/first-nations-view-model.test.ts`
Expected: PASS (8 + 6 tests). If a guard fails on real data, fix the data, never the test.

- [ ] **Step 4: Commit:** `git add tests/first-nations-content-guard.test.ts tests/first-nations-view-model.test.ts && git commit -m "First Nations: guard content and pin the risk-line and service-layer contract"`

---

### Task 4: Hours, number formatting and local search (Lane B, mid-tier)

**Files:**

- Create: `src/lib/first-nations/hours.ts`, `src/lib/first-nations/contact-format.ts`, `src/lib/first-nations/search.ts`
- Test: `tests/first-nations-hours.test.ts`, `tests/first-nations-contact-format.test.ts`, `tests/first-nations-search.test.ts`

**Interfaces:**

- Consumes: `toAwstParts`, `awstCalendarDay`, `awstCalendarDayOffset` from `src/lib/caring-contacts/clock.ts`; `WA_PUBLIC_HOLIDAYS`, `WA_PUBLIC_HOLIDAYS_LAST_YEAR`, `waPublicHolidaysByRule` from `src/lib/on-call/wa-public-holidays.ts` (not `isWaPublicHoliday`, which reads the device's own time zone); `onCallTelHref` from `src/lib/on-call/home-modules.ts`.
- Produces:
  - `type Hours = { days: number[]; open: string; close: string }`.
  - `type CallState = { kind: "open"; closesAt: string } | { kind: "closed"; opensAt: string | null; opensOn: string | null } | { kind: "overdue" } | { kind: "unconfirmed" }`.
  - `callState(hours, checkedAt, now)`, `isOverdue(checkedAt, now, maxDays = 90)`, `dayTrack(hours, now)`, `hoursInWords(hours)`.
  - `telHref(raw)`, `shareText(name, number)`, `vcardFor({ name, number })`, `formatDayMonthYear(isoDay)`.
  - `type SearchEntry = { id: string; title: string; detail: string; href: string; number?: string }`, `searchEntries(entries, query, limit = 8)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/first-nations-hours.test.ts
import { describe, expect, it } from "vitest";
import { callState, dayTrack, hoursInWords, isOverdue } from "@/lib/first-nations/hours";

const weekdays = { days: [1, 2, 3, 4, 5], open: "08:00", close: "16:30" };
const at = (iso: string) => new Date(iso); // Perth is UTC+8 all year
// 2026-09-22 is a Tuesday, 2026-09-25 a Friday, 2026-09-28 WA's King's Birthday (a Monday).

describe("callState", () => {
  it("is open at 14:20 on a weekday", () => {
    expect(callState(weekdays, "2026-09-01", at("2026-09-22T06:20:00Z"))).toEqual({ kind: "open", closesAt: "16:30" });
  });
  it("is still open at 16:29", () => {
    expect(callState(weekdays, "2026-09-01", at("2026-09-22T08:29:00Z")).kind).toBe("open");
  });
  it("is closed at exactly 16:30 and opens tomorrow at 08:00", () => {
    expect(callState(weekdays, "2026-09-01", at("2026-09-22T08:30:00Z"))).toEqual({
      kind: "closed",
      opensAt: "08:00",
      opensOn: "tomorrow",
    });
  });
  it("is closed at midnight", () => {
    expect(callState(weekdays, "2026-09-01", at("2026-09-22T16:00:00Z")).kind).toBe("closed");
  });
  it("opens today when it is early morning", () => {
    expect(callState(weekdays, "2026-09-01", at("2026-09-22T23:00:00Z"))).toEqual({
      kind: "closed",
      opensAt: "08:00",
      opensOn: "today",
    });
  });
  it("is closed on a WA public holiday", () => {
    expect(callState(weekdays, "2026-09-01", at("2026-09-28T02:00:00Z"))).toEqual({
      kind: "closed",
      opensAt: "08:00",
      opensOn: "tomorrow",
    });
  });
  it("skips the weekend and the holiday on a Friday evening", () => {
    expect(callState(weekdays, "2026-09-01", at("2026-09-25T09:40:00Z"))).toEqual({
      kind: "closed",
      opensAt: "08:00",
      opensOn: "Tue",
    });
  });
  it("is overdue once the 90-day recheck passes, even in hours", () => {
    expect(callState(weekdays, "2026-06-01", at("2026-09-22T06:20:00Z"))).toEqual({ kind: "overdue" });
  });
  it("is unconfirmed without hours", () => {
    expect(callState(undefined, "2026-09-01", at("2026-09-22T06:20:00Z"))).toEqual({ kind: "unconfirmed" });
  });
});

describe("isOverdue", () => {
  it("is false at 90 days and true at 91", () => {
    expect(isOverdue("2026-06-24", at("2026-09-22T02:00:00Z"))).toBe(false);
    expect(isOverdue("2026-06-23", at("2026-09-22T02:00:00Z"))).toBe(true);
  });
});

describe("dayTrack", () => {
  it("places today's open hours and now on a 24-hour line", () => {
    const track = dayTrack(weekdays, at("2026-09-22T06:20:00Z"));
    expect(track?.open?.from).toBeCloseTo(8 / 24);
    expect(track?.open?.to).toBeCloseTo(16.5 / 24);
    expect(track?.now).toBeCloseTo((14 + 20 / 60) / 24);
  });
  it("shows no open segment on a closed day and nothing without hours", () => {
    expect(dayTrack(weekdays, at("2026-09-27T02:00:00Z"))?.open).toBeNull();
    expect(dayTrack(undefined, at("2026-09-27T02:00:00Z"))).toBeNull();
  });
});

describe("hoursInWords", () => {
  it("says weekdays and every day in words", () => {
    expect(hoursInWords(weekdays)).toBe("Open 08:00–16:30, Monday to Friday");
    expect(hoursInWords({ days: [1, 2, 3, 4, 5, 6, 7], open: "08:00", close: "16:30" })).toBe(
      "Open 08:00–16:30, 7 days",
    );
    expect(hoursInWords({ days: [1, 3], open: "09:00", close: "12:00" })).toBe(
      "Open 09:00–12:00, Monday and Wednesday",
    );
  });
});
```

```ts
// tests/first-nations-contact-format.test.ts
import { describe, expect, it } from "vitest";
import { formatDayMonthYear, shareText, telHref, vcardFor } from "@/lib/first-nations/contact-format";

describe("contact format", () => {
  it("builds tel links for landlines, short hospital numbers and 13 numbers, never extensions", () => {
    expect(telHref("(08) 9000 0012")).toBe("tel:0890000012");
    expect(telHref("9000 0012")).toBe("tel:90000012");
    expect(telHref("13 92 76")).toBe("tel:139276");
    expect(telHref("ext 0002")).toBeUndefined();
  });
  it("builds a minimal vCard with the team name and number only", () => {
    const card = vcardFor({ name: "Aboriginal liaison team", number: "(08) 9000 0012" });
    expect(card).toContain("FN:Aboriginal liaison team");
    expect(card).toContain("TEL;TYPE=WORK:0890000012");
    expect(card).not.toMatch(/EMAIL|ADR|NOTE/);
  });
  it("writes share text and dates the calm way", () => {
    expect(shareText("Aboriginal liaison team", "9000 0001")).toBe("Aboriginal liaison team: 9000 0001");
    expect(formatDayMonthYear("2026-09-26")).toBe("26 Sep 2026");
  });
});
```

```ts
// tests/first-nations-search.test.ts
import { describe, expect, it } from "vitest";
import { searchEntries, type SearchEntry } from "@/lib/first-nations/search";

const entries: SearchEntry[] = [
  {
    id: "a",
    title: "Aboriginal Interpreting WA",
    detail: "Book 24 h ahead",
    href: "/first-nations/contacts",
    number: "1800 000 012",
  },
  { id: "b", title: "Allow silence", detail: "A pause can mean thinking", href: "/first-nations/talking#yarning" },
  { id: "c", title: "Book an interpreter early", detail: "Language", href: "/first-nations/talking#language" },
];

describe("searchEntries", () => {
  it("returns nothing for an empty query", () => {
    expect(searchEntries(entries, "   ")).toEqual([]);
  });
  it("needs every word to match and ranks title matches first", () => {
    expect(searchEntries(entries, "interpret").map((e) => e.id)).toEqual(["a", "c"]);
    expect(searchEntries(entries, "pause thinking").map((e) => e.id)).toEqual(["b"]);
  });
  it("finds a number by its digits", () => {
    expect(searchEntries(entries, "000 012").map((e) => e.id)).toEqual(["a"]);
  });
  it("respects the limit", () => {
    expect(searchEntries(entries, "a", 1)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:focused -- --files tests/first-nations-hours.test.ts tests/first-nations-contact-format.test.ts tests/first-nations-search.test.ts`
Expected: FAIL, missing modules.

- [ ] **Step 3: Implement `hours.ts`**

```ts
import { awstCalendarDay, awstCalendarDayOffset, toAwstParts } from "@/lib/caring-contacts/clock";
import {
  WA_PUBLIC_HOLIDAYS,
  WA_PUBLIC_HOLIDAYS_LAST_YEAR,
  waPublicHolidaysByRule,
} from "@/lib/on-call/wa-public-holidays";

export type Hours = { days: number[]; open: string; close: string };
export type CallState =
  | { kind: "open"; closesAt: string }
  | { kind: "closed"; opensAt: string | null; opensOn: string | null }
  | { kind: "overdue" }
  | { kind: "unconfirmed" };

const MS_PER_DAY = 86_400_000;
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function isoWeekdayOf(dayKey: string): number {
  const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function isHoliday(dayKey: string): boolean {
  const year = Number(dayKey.slice(0, 4));
  return year <= WA_PUBLIC_HOLIDAYS_LAST_YEAR
    ? WA_PUBLIC_HOLIDAYS.has(dayKey)
    : waPublicHolidaysByRule(year).includes(dayKey);
}

function opensOnDay(hours: Hours, dayKey: string): boolean {
  return hours.days.includes(isoWeekdayOf(dayKey)) && !isHoliday(dayKey);
}

function minuteOfDay(now: Date): number {
  const { hour, minute } = toAwstParts(now);
  return hour * 60 + minute;
}

export function isOverdue(checkedAt: string, now: Date, maxDays = 90): boolean {
  const checked = Date.parse(`${checkedAt}T00:00:00+08:00`);
  return Math.floor((now.getTime() - checked) / MS_PER_DAY) > maxDays;
}

function nextOpening(hours: Hours, now: Date): { opensAt: string; opensOn: string } | null {
  const today = awstCalendarDay(now);
  const nowMin = minuteOfDay(now);
  for (let offset = 0; offset < 8; offset += 1) {
    const key = awstCalendarDayOffset(today, offset);
    if (!opensOnDay(hours, key)) continue;
    if (offset === 0 && nowMin >= toMinutes(hours.open)) continue;
    const opensOn = offset === 0 ? "today" : offset === 1 ? "tomorrow" : WEEKDAY_SHORT[isoWeekdayOf(key) - 1];
    return { opensAt: hours.open, opensOn };
  }
  return null;
}

export function callState(hours: Hours | undefined, checkedAt: string, now: Date): CallState {
  if (isOverdue(checkedAt, now)) return { kind: "overdue" };
  if (!hours) return { kind: "unconfirmed" };
  const nowMin = minuteOfDay(now);
  if (opensOnDay(hours, awstCalendarDay(now)) && nowMin >= toMinutes(hours.open) && nowMin < toMinutes(hours.close))
    return { kind: "open", closesAt: hours.close };
  const next = nextOpening(hours, now);
  return { kind: "closed", opensAt: next?.opensAt ?? null, opensOn: next?.opensOn ?? null };
}

export function dayTrack(
  hours: Hours | undefined,
  now: Date,
): { open: { from: number; to: number } | null; now: number } | null {
  if (!hours) return null;
  const open = opensOnDay(hours, awstCalendarDay(now))
    ? { from: toMinutes(hours.open) / 1440, to: toMinutes(hours.close) / 1440 }
    : null;
  return { open, now: minuteOfDay(now) / 1440 };
}

export function hoursInWords(hours: Hours): string {
  const days = [...new Set(hours.days)].sort((a, b) => a - b);
  const range = `${hours.open}–${hours.close}`;
  if (days.length === 7) return `Open ${range}, 7 days`;
  if (days.join() === "1,2,3,4,5") return `Open ${range}, Monday to Friday`;
  const names = days.map((d) => WEEKDAY_LONG[d - 1]);
  const words = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `Open ${range}, ${words}`;
}
```

- [ ] **Step 4: Implement `contact-format.ts`**

```ts
import { onCallTelHref } from "@/lib/on-call/home-modules";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Reuses On Call's dialler rule, so extensions and pager ids are never handed to the phone. */
export function telHref(raw: string): string | undefined {
  return onCallTelHref(raw);
}

export function shareText(name: string, number: string): string {
  return `${name}: ${number}`;
}

const escapeVcard = (value: string) => value.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");

export function vcardFor({ name, number }: { name: string; number: string }): string {
  const tel = (onCallTelHref(number) ?? "").replace(/^tel:/, "");
  return ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVcard(name)}`, `TEL;TYPE=WORK:${tel}`, "END:VCARD", ""].join(
    "\r\n",
  );
}

/** "26 Sep 2026" — Intl's en-AU short month writes "Sept", which the design does not use. */
export function formatDayMonthYear(isoDay: string): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
```

- [ ] **Step 5: Implement `search.ts`**

```ts
export type SearchEntry = { id: string; title: string; detail: string; href: string; number?: string };

const normalise = (text: string) => text.toLocaleLowerCase("en-AU").normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Local only: the query never leaves this function (design standard §13). */
export function searchEntries(entries: readonly SearchEntry[], query: string, limit = 8): SearchEntry[] {
  const tokens = normalise(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const digits = query.replace(/\D/g, "");
  const first = tokens[0] ?? "";
  const hits: { entry: SearchEntry; score: number }[] = [];
  for (const entry of entries) {
    const title = normalise(entry.title);
    const haystack = `${title} ${normalise(entry.detail)}`;
    const numberHit = digits.length >= 3 && (entry.number ?? "").replace(/\D/g, "").includes(digits);
    if (!numberHit && !tokens.every((t) => haystack.includes(t))) continue;
    const score =
      (tokens.every((t) => title.includes(t)) ? 2 : 0) + (title.startsWith(first) ? 1 : 0) + (numberHit ? 1 : 0);
    hits.push({ entry, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit)
    .map((h) => h.entry);
}
```

- [ ] **Step 6: Run and confirm pass**

Run: `npm run test:focused -- --files tests/first-nations-hours.test.ts tests/first-nations-contact-format.test.ts tests/first-nations-search.test.ts`
Expected: PASS (13 + 3 + 4 tests).

- [ ] **Step 7: Commit:** `git add src/lib/first-nations/hours.ts src/lib/first-nations/contact-format.ts src/lib/first-nations/search.ts tests/first-nations-hours.test.ts tests/first-nations-contact-format.test.ts tests/first-nations-search.test.ts && git commit -m "First Nations: Perth-time hours, number formatting and local search"`

---

### Task 5: Mode registration, routes and every shared file (Lane D, mid-tier)

**Files:**

- Modify (shared, see "Shared files"): `src/lib/app-modes.ts` (`appModeIds` near `:26`, definition after My Work `:587-613`, `namespaceIsolatedModes` `:656`); `src/lib/category-identity.ts` (`APP_MODE_ICON`, `APP_MODE_ACCENT`); `src/lib/information-pages.ts` (`:27`, `:98`, `:141`); `src/lib/mode-secondary-navigation.ts` (after `:181`); `src/components/mode-nav/mode-nav-icons.ts` (`iconByItemId`); `src/lib/phone-mode-groups.ts` (after `:49-54`); `src/lib/search-command-surface.ts` (after `:249-260`); `src/lib/search-route-ownership.ts` (`:56`, `:113-114`, `:180`); `src/lib/search-shell-props.ts` (after `:116-117`); `src/lib/site-content/site-content-registry.ts` (`:19`, after `:303-310`); `src/lib/ui-copy.ts` (after `:138-142`); `src/lib/universal-search-mode-context.ts` (`:38`); `src/components/clinical-dashboard/ClinicalSidebar.tsx:115`; `src/components/clinical-dashboard/use-sidebar-pins.ts:32`; `src/components/mode-nav/header-addon-slot.ts` (`:26-80`); `src/lib/account-scoped-browser-state.ts` (`:36-63`); `src/app/globals.css` (after CPD's identity block, near `:1160`); `src/components/forms/form-priority-facts-section.tsx` (`:372`); the Services navigator page; `src/fonts/README.md`; `scripts/generate-site-map.ts` (`:182`, `:300`, `:485`, `:630-637`); `docs/design-system/adoption-contract.json` (sorted `routes` from `:120`); `docs/organisation/systems/clinical-content.json`; `docs/organisation/systems/app-experience.json`.
- Create: `src/app/(search-app)/first-nations/page.tsx`, `loading.tsx`, `layout.tsx`, `contacts|talking|family|mental-health|on-the-ward|mistakes|going-home|end-of-life/page.tsx`, `card/page.tsx`; `src/components/first-nations/first-nations-nav-header.tsx`, `first-nations-icons.ts`, `crisis.tsx`, `first-nations-loading.tsx`; stubs `page-renderer.tsx` and `pocket-card.tsx` (replaced in Tasks 6 and 8); `src/fonts/newsreader-latin-400-italic.woff2`, `src/fonts/OFL-newsreader.txt`.
- Modify tests: `tests/app-modes.test.ts:223,482`, `tests/mode-secondary-navigation.test.ts:67,90,94,120,124,126`, `tests/ui-copy.test.ts:128,140`, `tests/ui-smoke.spec.ts:4537,4538-4543,4558`, `tests/design-system-adoption.test.ts:1479`, `tests/phone-mode-groups.test.ts:39-47`, `tests/mode-home-loading-contract.test.ts:10-58`, `tests/site-content-registry.test.ts:327`, `tests/collapsed-rail-active-mode.dom.test.tsx:54`, `tests/mode-nav-addon-slot.dom.test.tsx` (`:52-111`, cover list `:134-155`, claimants `:250-335`).
- Create tests: `tests/first-nations-mode-colour.test.ts`, `tests/first-nations-crisis.dom.test.tsx`.

**Interfaces:**

- Consumes: nothing from other lanes. The two stubs take `pageId: string` so this lane does not wait for Task 1's types.
- Produces: `FirstNationsNavHeader({ title, sections, actions })` with `sections: readonly { id: string; label: string; icon: FirstNationsIconName }[]`; `FIRST_NATIONS_ICONS` and `FirstNationsIconName`; `CrisisStrip()`, `CrisisBlock()`; `FirstNationsLoading()`; `FIRST_NATIONS_HOSPITAL_STORAGE_KEY`; the `--font-fn-serif` variable on every First Nations route; the olive tokens and the `.fn-display-36`, `.fn-voice` and `.fn-on-summary` classes.

- [ ] **Step 1: Update the count pins first so they fail.** Change every `20` in the pins above to `21`, `106` to `116` (nine pages plus the pocket card), and add `"first-nations"` rows beside each `"my-work"` row with the values below. Add `"src/components/first-nations/first-nations-nav-header.tsx"` to the sorted claimant list. In `tests/mode-home-loading-contract.test.ts`, add `"first-nations"` to `MODE_HOME_LOADING_ROUTES` with the comment "First Nations' home: static skeleton plus the real crisis strip (spec §5), so it names its own loading component", and replace the second test's body with:

```ts
const LOADING_COMPONENT_EXCEPTIONS: Partial<Record<(typeof MODE_HOME_LOADING_ROUTES)[number], string>> = {
  "first-nations": "FirstNationsLoading",
};
for (const route of MODE_HOME_LOADING_ROUTES) {
  const loadingPath = join(SEARCH_APP_ROOT, route, "loading.tsx");
  expect(existsSync(loadingPath), `missing ${route}/loading.tsx`).toBe(true);
  const source = readFileSync(loadingPath, "utf8");
  expect(source).toContain(LOADING_COMPONENT_EXCEPTIONS[route] ?? "ModeHomeRouteLoading");
  expect(source).not.toMatch(/Loading services|Loading medication|Loading library/);
}
```

- [ ] **Step 2: Write the two new tests**

```ts
// tests/first-nations-mode-colour.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("First Nations olive (standard v13.1 §3)", () => {
  const light = block('[data-mode-identity="first-nations"]');
  const dark = block('.dark [data-mode-identity="first-nations"]');
  it("uses the standard's olive values", () => {
    expect([
      light.get("--mode-identity"),
      light.get("--mode-identity-soft"),
      light.get("--mode-identity-border"),
    ]).toEqual(["#4d6b2f", "#f2f5ee", "#dce4d2"]);
    expect([
      dark.get("--mode-identity"),
      dark.get("--mode-identity-soft"),
      dark.get("--mode-identity-border"),
      dark.get("--mode-identity-contrast"),
    ]).toEqual(["#b5c98c", "#232b1d", "#3a4730", "#172009"]);
  });
  it("clears 4.5:1 as a disc against its own glyph colour and as text", () => {
    expect(contrast(light.get("--mode-identity")!, light.get("--mode-identity-contrast")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.get("--mode-identity")!, dark.get("--mode-identity-contrast")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.get("--mode-identity")!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.get("--mode-identity")!, "#1c2126")).toBeGreaterThanOrEqual(4.5);
  });
  it("remaps the accent locally and flattens under forced colours", () => {
    expect(light.get("--clinical-accent")).toBe("var(--mode-identity)");
    expect(css).toMatch(/\[data-mode-identity="first-nations"\] \{\s*--mode-identity: LinkText;/);
  });
});
```

```tsx
// tests/first-nations-crisis.dom.test.tsx
/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CrisisBlock, CrisisStrip } from "@/components/first-nations/crisis";
import { FirstNationsLoading } from "@/components/first-nations/first-nations-loading";

describe("First Nations crisis numbers", () => {
  it("draws 000 and 13YARN as direct tel links, 000 the only red", () => {
    render(<CrisisStrip />);
    const emergency = screen.getByRole("link", { name: /000/ });
    const yarn = screen.getByRole("link", { name: /13 92 76/ });
    expect(emergency.getAttribute("href")).toBe("tel:000");
    expect(yarn.getAttribute("href")).toBe("tel:139276");
    expect(emergency.className).toMatch(/danger/);
    expect(yarn.className).not.toMatch(/danger/);
  });
  it("lists 000, 13YARN, MHERL and Lifeline on inner pages", () => {
    render(<CrisisBlock />);
    for (const n of ["000", "13 92 76", "1300 555 788", "13 11 14"]) expect(screen.getByText(n)).toBeTruthy();
  });
  it("keeps the real strip in the loading skeleton, with no animation", () => {
    const { container } = render(<FirstNationsLoading />);
    expect(screen.getByRole("link", { name: /13 92 76/ })).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/animate-|shimmer/);
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm run test:focused -- --files tests/app-modes.test.ts tests/mode-secondary-navigation.test.ts tests/ui-copy.test.ts tests/phone-mode-groups.test.ts tests/mode-home-loading-contract.test.ts tests/site-content-registry.test.ts tests/collapsed-rail-active-mode.dom.test.tsx tests/mode-nav-addon-slot.dom.test.tsx tests/first-nations-mode-colour.test.ts tests/first-nations-crisis.dom.test.tsx`
Expected: FAIL on the counts, the missing mode, the missing colour blocks and the missing components.

- [ ] **Step 4: Register the mode.** Key additions:

```ts
// app-modes.ts — appModeIds
"first-nations",
// app-modes.ts — definition (same shape as my-work)
{
  id: "first-nations",
  label: "First Nations",
  description: "Culturally safe care for Aboriginal and Torres Strait Islander patients",
  href: "/first-nations",
  search: { kind: "tools", placeholder: "Search First Nations", resultKind: "tools", resultsSurface: "none", nextStep: "Open a page", badgeLabel: null },
},
// category-identity.ts — APP_MODE_ICON and APP_MODE_ACCENT (the category channel, not identity)
"first-nations": "users",
"first-nations": "slate",
// mode-secondary-navigation.ts — spec §3 order; the pages sheet's group headings ("At the bedside",
// "During the stay", "Leaving hospital") wait for the shared pages sheet to support groups (On Call's rebuild)
"first-nations": [
  { id: "first-nations-bedside", label: "Bedside", href: "/first-nations" },
  { id: "first-nations-contacts", label: "Contacts", href: "/first-nations/contacts" },
  { id: "first-nations-talking", label: "Talking", href: "/first-nations/talking" },
  { id: "first-nations-family", label: "Family", href: "/first-nations/family" },
  { id: "first-nations-mental-health", label: "Mental health", href: "/first-nations/mental-health" },
  { id: "first-nations-on-the-ward", label: "On the ward", href: "/first-nations/on-the-ward" },
  { id: "first-nations-mistakes", label: "Common mistakes", href: "/first-nations/mistakes" },
  { id: "first-nations-going-home", label: "Going home", href: "/first-nations/going-home" },
  { id: "first-nations-end-of-life", label: "End of life", href: "/first-nations/end-of-life" },
],
// mode-nav-icons.ts iconByItemId (prefixed ids, so On Call's "contacts" icon is not shared)
"first-nations-bedside": LayoutGrid, "first-nations-contacts": Phone, "first-nations-talking": MessageCircle,
"first-nations-family": Users, "first-nations-mental-health": Brain, "first-nations-on-the-ward": BedDouble,
"first-nations-mistakes": Ban, "first-nations-going-home": House, "first-nations-end-of-life": Feather,
// phone-mode-groups.ts (after my-work)
{ id: "first-nations", label: "First Nations", hint: "Culturally safe care", modeIds: ["first-nations"] },
// search-route-ownership.ts
"/first-nations",                       // standaloneModeHomePaths and alwaysStandaloneShellPathPrefixes
case "first-nations": return "/first-nations";
// search-shell-props.ts
if (pathname === "/first-nations" || pathname.startsWith("/first-nations/")) return { initialMode: "first-nations", desktopSearchPlacement: "hero" };
// site-content-registry.ts
{ modeId: "first-nations", reason: "operational_chrome", permanent: true, reviewed: true, reviewOwner: "clinical_content_governance" },
// information-pages.ts — the mode owns its in-page search box, so no shared composer (standard §13)
| "first-nations"
if (pathname === "/first-nations" || pathname.startsWith("/first-nations/")) return true;
// header-addon-slot.ts
if (pathname === "/first-nations" || isSlugDetail(pathname, "/first-nations")) return true;
```

Add the `ui-copy.ts` presentation (`title: "First Nations"`, `subtitle: "Culturally safe care for Aboriginal and Torres Strait Islander patients"`, three suggestions "Call Aboriginal liaison", "Common mistakes", "Mental Health Act s 81"), the `search-command-surface.ts` entry (`remoteSearchEnabled: false`, `crossModes: ["on-call", "services", "forms"]`), `universal-search-mode-context.ts` `"first-nations": []`, the two sidebar lists, and the site-map rows for all ten routes. Let `npm run typecheck` name any other exhaustive record.

In `account-scoped-browser-state.ts`, add `export const FIRST_NATIONS_HOSPITAL_STORAGE_KEY = "first-nations:hospital-v1";` beside the other keys and `removeQuietly(() => window.localStorage, FIRST_NATIONS_HOSPITAL_STORAGE_KEY);` in `clearAccountScopedBrowserStorage()`.

- [ ] **Step 5: Add the colour, display and serif classes to `globals.css`** (one block, after CPD's identity block):

```css
/* First Nations: olive (mode design standard v13.1 §3). Light 6.1:1 on white,
   dark 9.0:1 on a dark card, disc glyph 9.4:1. Used only on the pill, the
   current tab, module icon tiles, the hero's day track and quotation accents.
   Pinned by tests/first-nations-mode-colour.test.ts. */
[data-mode-identity="first-nations"] {
  --mode-identity: #4d6b2f;
  --mode-identity-soft: #f2f5ee;
  --mode-identity-border: #dce4d2;
  --mode-identity-contrast: #ffffff;
  --clinical-accent: var(--mode-identity);
  --clinical-accent-soft: var(--mode-identity-soft);
  --clinical-accent-border: var(--mode-identity-border);
  --clinical-accent-contrast: var(--mode-identity-contrast);
}

.dark [data-mode-identity="first-nations"] {
  --mode-identity: #b5c98c;
  --mode-identity-soft: #232b1d;
  --mode-identity-border: #3a4730;
  --mode-identity-contrast: #172009;
}

/* On the hero summary panel the mode colour uses its dark value in both themes (v13.3). */
[data-mode-identity="first-nations"].fn-on-summary {
  --mode-identity: #b5c98c;
}

@media (forced-colors: active) {
  [data-mode-identity="first-nations"] {
    --mode-identity: LinkText;
    --mode-identity-soft: Canvas;
    --mode-identity-border: ButtonBorder;
    --mode-identity-contrast: ButtonText;
  }
}

/* The one display figure on the First Nations hero (standard §1: 36 px at 300). */
.fn-display-36 {
  font-size: 2.25rem;
  line-height: 1.1;
  font-weight: 300;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}

/* Serif accent: words to say aloud, quoted law, the Acknowledgement. */
.fn-voice {
  font-family: var(--font-fn-serif), ui-serif, Georgia, serif;
  font-style: italic;
  font-weight: 400;
}
```

- [ ] **Step 6: Add the serif font.** Read `node_modules/next/dist/docs/` on `next/font/local` first. Fetch the Latin italic 400 subset from the npm registry (no GitHub request) into the scratchpad and copy it in:

```bash
cd "$SCRATCH" && npm pack @fontsource/newsreader@5 && tar -xzf fontsource-newsreader-*.tgz
cp "$SCRATCH/package/files/newsreader-latin-400-italic.woff2" /home/claude/Database/src/fonts/newsreader-latin-400-italic.woff2
cp "$SCRATCH/package/LICENSE" /home/claude/Database/src/fonts/OFL-newsreader.txt
grep -q "SIL OPEN FONT LICENSE Version 1.1" /home/claude/Database/src/fonts/OFL-newsreader.txt
```

Add to `src/fonts/README.md`: "`newsreader-latin-400-italic.woff2` — the serif accent for First Nations (words to say aloud, quoted law, Acknowledgements), loaded by `src/app/(search-app)/first-nations/layout.tsx`, not preloaded. Licence: SIL Open Font License 1.1 (`OFL-newsreader.txt`), from `@fontsource/newsreader`." Then create the route layout:

```tsx
// src/app/(search-app)/first-nations/layout.tsx
import localFont from "next/font/local";
import type { ReactNode } from "react";

const newsreader = localFont({
  src: "../../../fonts/newsreader-latin-400-italic.woff2",
  weight: "400",
  style: "italic",
  display: "swap",
  preload: false,
  fallback: ["ui-serif", "Georgia", "serif"],
  variable: "--font-fn-serif",
});

export default function FirstNationsLayout({ children }: { children: ReactNode }) {
  // `contents` keeps the shell's layout chain intact; the variable still inherits.
  return <div className={`${newsreader.variable} contents`}>{children}</div>;
}
```

- [ ] **Step 7: Create the routes and the two stubs.** Home:

```tsx
// src/app/(search-app)/first-nations/page.tsx
import type { Metadata } from "next";
import { FirstNationsPageRenderer } from "@/components/first-nations/page-renderer";

export const metadata: Metadata = {
  title: "First Nations | PsychSift",
  description: "Culturally safe care for Aboriginal and Torres Strait Islander patients.",
};
export default function FirstNationsHomeRoute() {
  return <FirstNationsPageRenderer pageId="bedside" />;
}
```

```tsx
// src/app/(search-app)/first-nations/loading.tsx
import { FirstNationsLoading } from "@/components/first-nations/first-nations-loading";

export default function Loading() {
  return <FirstNationsLoading />;
}
```

Each section route is the same with its own `pageId` and title, for example `contacts/page.tsx` → `title: "Contacts | First Nations | PsychSift"`, `pageId="contacts"`. `card/page.tsx` → `title: "Pocket card | First Nations | PsychSift"`, rendering `<FirstNationsPocketCard />`. Stubs, replaced by Lane C:

```tsx
// src/components/first-nations/page-renderer.tsx (stub; Task 6 replaces it)
export function FirstNationsPageRenderer({ pageId }: { pageId: string }) {
  return <h1 className="sr-only">{pageId}</h1>;
}
```

```tsx
// src/components/first-nations/pocket-card.tsx (stub; Task 8 replaces it)
export function FirstNationsPocketCard() {
  return <h1 className="sr-only">Pocket card</h1>;
}
```

- [ ] **Step 8: Create the icons, nav header, crisis numbers and loading skeleton**

```ts
// src/components/first-nations/first-nations-icons.ts
import {
  BedDouble,
  BookOpen,
  Brain,
  ClipboardList,
  DoorOpen,
  Feather,
  House,
  ListChecks,
  MapPin,
  MessageCircle,
  Phone,
  Scale,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Module icon names used in content files. Task 6 pins these keys to `moduleIcons`. */
export const FIRST_NATIONS_ICONS = {
  users: Users,
  phone: Phone,
  message: MessageCircle,
  check: ListChecks,
  clipboard: ClipboardList,
  brain: Brain,
  house: House,
  "map-pin": MapPin,
  feather: Feather,
  scale: Scale,
  shield: Shield,
  book: BookOpen,
  door: DoorOpen,
  bed: BedDouble,
} satisfies Record<string, LucideIcon>;
export type FirstNationsIconName = keyof typeof FIRST_NATIONS_ICONS;
```

```tsx
// src/components/first-nations/first-nations-nav-header.tsx
"use client";
import type { ReactNode } from "react";
import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageSectionNav } from "@/components/in-page-nav/use-in-page-section-nav";
import { FIRST_NATIONS_ICONS, type FirstNationsIconName } from "@/components/first-nations/first-nations-icons";

export type FirstNationsTab = { id: string; label: string; icon: FirstNationsIconName };

export function FirstNationsNavHeader({
  title,
  sections,
  actions,
}: {
  title: string;
  sections: readonly FirstNationsTab[];
  actions?: ReactNode | ((close: () => void) => ReactNode);
}) {
  // Icons are resolved here, on the client, because a Lucide component cannot cross
  // the server-to-client boundary. Tabs carry no counts (design standard, final design).
  const declared: PageSection[] = sections.map((s) => ({
    id: s.id,
    label: s.label,
    icon: FIRST_NATIONS_ICONS[s.icon],
  }));
  const { sections: resolved, activeId, selectSection } = useInPageSectionNav(declared);
  if (resolved.length === 0) return null;
  return (
    <InPageNavHeader
      title={title}
      titleHidden
      sections={resolved}
      activeId={activeId}
      onSelectSection={selectSection}
      actions={actions}
      rail={{ label: "Sections of this page", density: "balanced-four", modeIdentity: "first-nations" }}
      className="max-sm:border-b-0 max-sm:bg-transparent"
      testIdPrefix="first-nations-section-header"
    />
  );
}
```

(Confirm the `InPageNavHeader` prop names against `src/components/on-call/on-call-nav-header.tsx:124-158` and copy them exactly. `declared` is rebuilt each render; if `useInPageSectionNav` needs a stable array, wrap it in `useMemo` keyed on `sections`.)

```tsx
// src/components/first-nations/crisis.tsx — server-safe, no hooks, never lazy-loaded
import { Phone } from "lucide-react";
import { cn } from "@/components/ui-primitives";
import { WA_CRISIS_CONTACTS, type PublicCrisisContact } from "@/lib/crisis-contacts";

const EMERGENCY = "SYN-CRISIS-CONTACT-001";
const YARN = "SYN-CRISIS-CONTACT-007";
const MHERL_METRO = "SYN-CRISIS-CONTACT-002";
const LIFELINE = "SYN-CRISIS-CONTACT-005";
const SHORT: Record<string, string> = {
  [EMERGENCY]: "Emergency",
  [YARN]: "13YARN, 24 h",
  [MHERL_METRO]: "Mental Health Emergency Response Line",
  [LIFELINE]: "Lifeline",
};

function pick(ids: readonly string[]): PublicCrisisContact[] {
  return ids.map((id) => {
    const found = WA_CRISIS_CONTACTS.find((c) => c.id === id);
    if (!found) throw new Error(`Missing crisis contact ${id}`);
    return found;
  });
}

/** 000 and 13YARN, one tap to dial. The rem-based basis wraps to one per row at 200 % text. */
export function CrisisStrip() {
  return (
    <nav aria-label="Crisis numbers" data-fn-part="crisis" className="flex flex-wrap gap-2">
      {pick([EMERGENCY, YARN]).map((c) => {
        const emergency = c.id === EMERGENCY;
        return (
          <a
            key={c.id}
            href={`tel:${c.telephoneUri}`}
            className={cn(
              "flex min-h-[3.25rem] min-w-[9.5rem] flex-1 items-center gap-2.5 rounded-xl border px-3",
              emergency
                ? "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]"
                : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-heading)] shadow-[var(--e1)]",
            )}
          >
            <Phone className="size-icon-md shrink-0" aria-hidden="true" />
            <span className="grid min-w-0 leading-tight">
              <span className="nums text-lg-minus font-normal">{c.telephoneDisplay}</span>
              <span className="text-2xs">{SHORT[c.id]}</span>
            </span>
          </a>
        );
      })}
    </nav>
  );
}

export function CrisisBlock() {
  return (
    <section aria-labelledby="fn-crisis" className="grid gap-2">
      <h2
        id="fn-crisis"
        className="px-1 text-2xs font-semibold uppercase tracking-label text-[color:var(--text-muted)]"
      >
        Crisis
      </h2>
      <ul className="grid rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--e1)]">
        {pick([EMERGENCY, YARN, MHERL_METRO, LIFELINE]).map((c) => (
          <li key={c.id} className="border-t border-[color:var(--border)] first:border-t-0">
            <a
              href={`tel:${c.telephoneUri}`}
              className="flex min-h-12 flex-wrap items-baseline justify-between gap-x-3 px-3 py-2"
            >
              <span className="text-base-minus font-medium text-[color:var(--text-heading)]">{SHORT[c.id]}</span>
              <span
                className={cn(
                  "nums text-base-minus font-normal",
                  c.id === EMERGENCY ? "text-[color:var(--danger-text)]" : "text-[color:var(--text)]",
                )}
              >
                {c.telephoneDisplay}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// src/components/first-nations/first-nations-loading.tsx — static shapes (standard §7), real crisis strip
import { CrisisStrip } from "@/components/first-nations/crisis";

export function FirstNationsLoading() {
  return (
    <div className="mx-auto grid w-full max-w-[40rem] gap-3 px-3 pt-3">
      <span role="status" className="sr-only">
        Loading
      </span>
      <div aria-hidden="true" className="h-44 rounded-2xl bg-[color:var(--surface-subtle)]" />
      <CrisisStrip />
      <div aria-hidden="true" className="h-12 rounded-xl bg-[color:var(--surface-subtle)]" />
      <div aria-hidden="true" className="h-72 rounded-xl bg-[color:var(--surface-subtle)]" />
    </div>
  );
}
```

- [ ] **Step 9: Add the two links in** (the Forms 3A–3C cultural note in `form-priority-facts-section.tsx`: a `Link` "Open First Nations mental health" to `/first-nations/mental-health`; the Services navigator with the Aboriginal filter on: a `Link` "Open First Nations contacts" to `/first-nations/contacts`), and the organisation-map globs: `"src/data/first-nations/**"`, `"src/lib/first-nations/**"` into `clinical-content.json`; `"src/components/first-nations/**"`, `"src/app/(search-app)/first-nations/**"`, `"tests/first-nations-*"`, `"tests/fixtures/first-nations-*"` into `app-experience.json`.

- [ ] **Step 10: Run and confirm pass**

Run: the Step 3 command again, then `npm run check:organisation -- --files src/components/first-nations/crisis.tsx src/data/first-nations/pages.json`
Expected: all listed tests PASS; organisation reports the files placed.

- [ ] **Step 11: Commit**

```bash
git add src/lib/app-modes.ts src/lib/category-identity.ts src/lib/information-pages.ts src/lib/mode-secondary-navigation.ts src/components/mode-nav/mode-nav-icons.ts src/lib/phone-mode-groups.ts src/lib/search-command-surface.ts src/lib/search-route-ownership.ts src/lib/search-shell-props.ts src/lib/site-content/site-content-registry.ts src/lib/ui-copy.ts src/lib/universal-search-mode-context.ts src/components/clinical-dashboard/ClinicalSidebar.tsx src/components/clinical-dashboard/use-sidebar-pins.ts src/components/mode-nav/header-addon-slot.ts src/lib/account-scoped-browser-state.ts src/app/globals.css src/components/forms/form-priority-facts-section.tsx src/fonts/README.md src/fonts/newsreader-latin-400-italic.woff2 src/fonts/OFL-newsreader.txt scripts/generate-site-map.ts docs/design-system/adoption-contract.json docs/organisation/systems/clinical-content.json docs/organisation/systems/app-experience.json "src/app/(search-app)/first-nations" src/components/first-nations/first-nations-nav-header.tsx src/components/first-nations/first-nations-icons.ts src/components/first-nations/crisis.tsx src/components/first-nations/first-nations-loading.tsx src/components/first-nations/page-renderer.tsx src/components/first-nations/pocket-card.tsx tests/app-modes.test.ts tests/mode-secondary-navigation.test.ts tests/ui-copy.test.ts tests/ui-smoke.spec.ts tests/design-system-adoption.test.ts tests/phone-mode-groups.test.ts tests/mode-home-loading-contract.test.ts tests/site-content-registry.test.ts tests/collapsed-rail-active-mode.dom.test.tsx tests/mode-nav-addon-slot.dom.test.tsx tests/first-nations-mode-colour.test.ts tests/first-nations-crisis.dom.test.tsx
git add "$(git grep -l 'function ServicesNavigatorPage' -- src)"
git commit -m "First Nations: register the mode, routes, olive tokens, serif font, crisis strip and links in"
```

**Milestone 1** (after Lanes A, B and D are committed on the branch): run `npm run typecheck && npm run lint`, then `npm run format` and commit any formatting as its own commit, then push once and open the PR as a draft (Task 9, Step 5 has the PR body).

---

### Task 7: Client islands (Lane C, top model, runs first in the lane)

**Prerequisite:** the mode kit is on `main` (see the top of this plan). Merge `main` into the branch before starting.

**Files:**

- Create: `src/components/first-nations/kit.ts`, `voice.tsx`, `module-header.tsx`, `state-module.tsx`, `number-button.tsx`, `day-track.tsx`, `liaison-hero.tsx`, `tick-list.tsx`, `situation-module.tsx`, `before-you-go-in.tsx`, `where-is-home.tsx`, `first-nations-search.tsx`, `phrase-deck.tsx`, `offline-state.tsx`, `primer.tsx`, `hospital-choice.ts`, `page-menu.tsx`
- Create fixtures F2 and F3 (Shared test fixtures): `tests/fixtures/first-nations-kit-double.tsx`, `tests/fixtures/first-nations-models.ts`
- Test, one file per unit: `tests/first-nations-liaison-hero.dom.test.tsx`, `tests/first-nations-situation-module.dom.test.tsx`, `tests/first-nations-before-you-go-in.dom.test.tsx`, `tests/first-nations-where-is-home.dom.test.tsx`, `tests/first-nations-search-box.dom.test.tsx`, `tests/first-nations-number-button.dom.test.tsx`, `tests/first-nations-page-menu.dom.test.tsx`, `tests/first-nations-privacy.dom.test.tsx`

**Interfaces:**

- Consumes: view types from Task 2 (`import type` only in client files, because `view-model.ts` pulls in `node:crypto`); `callState`, `dayTrack`, `hoursInWords` (Task 4); `telHref`, `vcardFor`, `shareText`, `formatDayMonthYear` (Task 4); `searchEntries`, `SearchEntry` (Task 4); `FIRST_NATIONS_ICONS` and `FIRST_NATIONS_HOSPITAL_STORAGE_KEY` (Task 5); `Sheet` from `src/components/ui/sheet.tsx`; `copyTextToClipboard` from `src/lib/copy-to-clipboard.ts`; `systemClock`, `Clock` from `src/lib/caring-contacts/clock.ts`; `UniversalHeaderTrailingPortal`; `cmeLearningFromSourceHref`; `eyebrowText`, `cn` from `@/components/ui-primitives`.
- Produces: `LiaisonHero({ hospital, clock? })`, `DayTrack({ hours, now, label })`, `NumberButton({ contact, children?, className? })`, `NumberTile({ contact, label })`, `StateModule({ kind, href?, onAction? })`, `ModuleHeader`, `FnModule`, `SpokenWords`, `QuotedLaw`, `AcknowledgementText`, `TickList`, `SituationProvider({ situations, liaison, children })`, `SituationModule()`, `SituationSidePanel()`, `BeforeYouGoIn({ steps })`, `WhereIsHomeTile(props)`, `WhereIsHomePanel({ regions, map, interpreter })`, `FirstNationsSearch({ entries })`, `PhraseDeck({ phrases })`, `OfflineState()`, `Primer()`, `useChosenHospital(hospitals)`, `FirstNationsMenuActions(props)`, `FirstNationsHomeMenu(props)`, `firstNationsCpdHref(pageTitle, href)`.

- [ ] **Step 1: Confirm the kit and write `kit.ts`.** Open each kit file on `main` (`git show origin/main:src/components/mode-kit/<file>`) and write down each export's props. Then write the one re-export file, correcting names and paths if they differ from the working names:

```ts
// src/components/first-nations/kit.ts
/**
 * The only First Nations file that imports the shared mode kit (On Call's PR from main,
 * src/components/mode-kit/). Names to confirm when the kit PR lands: if a name or path
 * differs, change it here only. Never import from src/components/on-call/kit/.
 */
export { ModeActionButton } from "@/components/mode-kit/action-button";
export { ModeDialRow, ModeDialSheet } from "@/components/mode-kit/dial-sheet";
export { ModeFactTile, ModeFactTiles } from "@/components/mode-kit/fact-tile";
export { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
export { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
export { ModeNotice } from "@/components/mode-kit/notice";
export { ModeStateLabel } from "@/components/mode-kit/state-label";
export { modeNameText, modeNumberText } from "@/components/mode-kit/type";
export { ModeUpdatedLine } from "@/components/mode-kit/updated-line";
```

First Nations relies on these props (the working API; where the kit differs, adapt the call sites in this task and the test double together):

| Export             | Props First Nations passes                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModeGroupedList`  | `children`                                                                                                                                                                                                        |
| `ModeRow`          | `title`, `detail?`, `trailing?`                                                                                                                                                                                   |
| `ModeFactTiles`    | `children`                                                                                                                                                                                                        |
| `ModeFactTile`     | `label`, `value`, `detail?`, `onPress?`                                                                                                                                                                           |
| `ModeNotice`       | `tone: "neutral" \| "warning"`, `children`                                                                                                                                                                        |
| `ModeStateLabel`   | `state: "live" \| "neutral" \| "warning"`, `children` (live draws the `--success` dot; pulses once on a later change to live, never on mount, never with reduced motion)                                          |
| `ModeUpdatedLine`  | `source`, `href?`, `checkedAt`                                                                                                                                                                                    |
| `ModeActionButton` | `variant: "primary" \| "secondary"`, `href?`, `onClick?`, `children`                                                                                                                                              |
| `ModeDialRow`      | `number`, `label`, `detail?`, `source`, `checkedAt`, `footer?` (opens `ModeDialSheet`)                                                                                                                            |
| `ModeDialSheet`    | `open`, `onClose`, `number` (44 px light digits), `label`, `source`, `checkedAt`, `footer?`; Call (the one filled button), Copy and Share, with Share falling back to copy and a plain message when neither works |

If the kit's dial sheet has no `footer` slot or no Share fallback, ask On Call through the coordinator to add it to the kit rather than forking a First Nations sheet.

- [ ] **Step 2: Write the fixtures F2 and F3** from "Shared test fixtures" exactly as given there (`tests/fixtures/first-nations-kit-double.tsx`, `tests/fixtures/first-nations-models.ts`).

- [ ] **Step 3: Write the failing tests, one file per island.** Each file imports only the island it tests, draws its data from F3 and calls `resetAfterEach()` once. No file re-declares a model, an approval or a kit mock beyond the one `vi.mock` line.

```tsx
// tests/first-nations-liaison-hero.dom.test.tsx
/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fixedClock, type Clock } from "@/lib/caring-contacts/clock";
import { LiaisonHero } from "@/components/first-nations/liaison-hero";
import { bedsideFixture, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();
const { hospital } = bedsideFixture();

describe("LiaisonHero", () => {
  it("server-renders 'Hours not confirmed' before the clock runs", () => {
    expect(renderToString(<LiaisonHero hospital={hospital} clock={fixedClock("2026-09-22T06:20:00Z")} />)).toContain(
      "Hours not confirmed",
    );
  });
  it("shows 'until 16:30' and calls liaison while open", () => {
    render(<LiaisonHero hospital={hospital} clock={fixedClock("2026-09-22T06:20:00Z")} />);
    expect(screen.getByText("Open now").getAttribute("data-state")).toBe("live");
    expect(screen.getByText("16:30")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Call Aboriginal liaison team" }).getAttribute("href")).toBe(
      "tel:90000001",
    );
  });
  it("switches to the switchboard at exactly 16:30", () => {
    render(<LiaisonHero hospital={hospital} clock={fixedClock("2026-09-22T08:30:00Z")} />);
    expect(screen.getByText("Closed · opens tomorrow 08:00")).toBeTruthy();
    expect(screen.getByTestId("fn-hero-figure").textContent).toContain("9000 0000");
    expect(screen.getByText("Ask who covers liaison tonight")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Call Switchboard" }).getAttribute("href")).toBe("tel:90000000");
  });
  it("never says open when the recheck is overdue, and keeps the liaison number visible", () => {
    render(<LiaisonHero hospital={hospital} clock={fixedClock("2027-01-05T02:00:00Z")} />);
    expect(screen.queryByText("Open now")).toBeNull();
    expect(screen.getByText("Due for a check").getAttribute("data-state")).toBe("warning");
    expect(screen.getByTestId("fn-hero-figure").textContent).toContain("9000 0000");
    expect(screen.getByText("9000 0001")).toBeTruthy();
  });
  it("hands the kit a live state only on a later change to open, so the pulse never fires on load", () => {
    vi.useFakeTimers();
    let now = new Date("2026-09-22T23:59:00Z"); // 07:59 Wednesday
    const clock: Clock = { now: () => now };
    render(<LiaisonHero hospital={hospital} clock={clock} />);
    expect(screen.queryByText("Open now")).toBeNull();
    now = new Date("2026-09-23T00:00:00Z");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Open now").getAttribute("data-state")).toBe("live");
  });
});
```

```tsx
// tests/first-nations-situation-module.dom.test.tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SituationModule, SituationProvider, SituationSidePanel } from "@/components/first-nations/situation-module";
import { bedsideFixture, resetAfterEach, riskLineApproval } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();
const { model, hospital } = bedsideFixture();
const situation = () => screen.getByRole("region", { name: "Situation" });
const renderModule = (situations = model.situations) =>
  render(
    <SituationProvider situations={situations} liaison={hospital.liaison}>
      <SituationModule />
      <SituationSidePanel />
    </SituationProvider>,
  );

describe("SituationModule", () => {
  it("opens on New admission and steps through three phrases", () => {
    renderModule();
    expect(within(situation()).getByRole("button", { name: "New admission", pressed: true })).toBeTruthy();
    expect(within(situation()).getByText("1 of 3")).toBeTruthy();
    for (const n of [2, 3, 1]) {
      fireEvent.click(within(situation()).getByRole("button", { name: "Next phrase" }));
      expect(within(situation()).getByText(`${n} of 3`)).toBeTruthy();
    }
  });
  it("shows the risk line only when it was approved", () => {
    renderModule();
    fireEvent.click(within(situation()).getByRole("button", { name: "Wants to leave" }));
    expect(screen.queryByText(/Immediate risk\?/)).toBeNull();
    cleanup();
    renderModule(bedsideFixture([riskLineApproval()]).model.situations);
    fireEvent.click(within(situation()).getByRole("button", { name: "Wants to leave" }));
    expect(screen.getAllByText(/Immediate risk\?/).length).toBeGreaterThan(0);
  });
  it("opens the plan as a sheet that says nothing is saved and opens unticked", () => {
    renderModule();
    fireEvent.click(screen.getByRole("button", { name: /Plan · 3 steps/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("3 steps · nothing is saved")).toBeTruthy();
    fireEvent.click(within(sheet).getAllByRole("checkbox")[0]);
    expect(within(sheet).getAllByRole("checkbox")[0]).toHaveProperty("checked", true);
    fireEvent.keyDown(sheet, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Plan · 3 steps/ }));
    expect(within(screen.getByRole("dialog")).getAllByRole("checkbox")[0]).toHaveProperty("checked", false);
  });
  it("moves the chosen situation with the side panel's arrows", () => {
    renderModule();
    fireEvent.click(screen.getByRole("button", { name: "Next situation" }));
    expect(within(situation()).getByRole("button", { name: "Wants to leave", pressed: true })).toBeTruthy();
    expect(screen.getByText("2 of 6")).toBeTruthy();
  });
});
```

```tsx
// tests/first-nations-before-you-go-in.dom.test.tsx
/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BeforeYouGoIn, UNDO_MS } from "@/components/first-nations/before-you-go-in";
import { bedsideFixture, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();
const { model } = bedsideFixture();
const openSheet = () => {
  render(<BeforeYouGoIn steps={model.beforeYouGoIn} />);
  fireEvent.click(screen.getByRole("button", { name: /Before you go in/ }));
  return screen.getByRole("dialog");
};

describe("BeforeYouGoIn", () => {
  it("opens unticked and says nothing is saved", () => {
    const sheet = openSheet();
    expect(within(sheet).getByText("Nothing is saved")).toBeTruthy();
    expect(
      within(sheet)
        .getAllByRole("checkbox")
        .every((c) => !(c as HTMLInputElement).checked),
    ).toBe(true);
  });
  it("clears at once with Undo for about six seconds, never 'Are you sure?'", () => {
    vi.useFakeTimers();
    const sheet = openSheet();
    fireEvent.click(within(sheet).getAllByRole("checkbox")[0]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear ticks" }));
    expect(within(sheet).getAllByRole("checkbox")[0]).toHaveProperty("checked", false);
    fireEvent.click(within(sheet).getByRole("button", { name: "Undo" }));
    expect(within(sheet).getAllByRole("checkbox")[0]).toHaveProperty("checked", true);
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear ticks" }));
    act(() => {
      vi.advanceTimersByTime(UNDO_MS);
    });
    expect(within(sheet).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByText(/are you sure/i)).toBeNull();
  });
});
```

```tsx
// tests/first-nations-where-is-home.dom.test.tsx
/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WhereIsHomePanel } from "@/components/first-nations/where-is-home";
import { bedsideFixture, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();
const { model } = bedsideFixture();
const renderPanel = () =>
  render(<WhereIsHomePanel regions={model.regions} map={model.map} interpreter={model.interpreter} />);

describe("WhereIsHomePanel", () => {
  it("lists services and languages near home, ready for the letter", () => {
    renderPanel();
    expect(screen.getByText("Never saved or sent")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Goldfields" }));
    expect(screen.getByText("Near home · Goldfields")).toBeTruthy();
    expect(screen.getByText("Wangkatha")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to letter" }));
    expect(screen.getByText("Aboriginal Interpreting WA · 1800 000 012")).toBeTruthy();
    expect(screen.getByText("Interpreter: Wangkatha")).toBeTruthy();
  });
  it("says so when copying is not possible", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Goldfields" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy all" }));
    expect(await screen.findByText("Copying isn't available on this phone")).toBeTruthy();
  });
});
```

```tsx
// tests/first-nations-search-box.dom.test.tsx
/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FirstNationsSearch } from "@/components/first-nations/first-nations-search";
import { bedsideFixture, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();
const { model } = bedsideFixture();

describe("FirstNationsSearch", () => {
  it("finds by words and by number, with no microphone", () => {
    render(<FirstNationsSearch entries={model.search} />);
    const box = screen.getByRole("searchbox", { name: "Search First Nations" });
    fireEvent.change(box, { target: { value: "interpreting" } });
    expect(screen.getByRole("link", { name: /Aboriginal Interpreting WA/ })).toBeTruthy();
    fireEvent.change(box, { target: { value: "000 012" } });
    expect(screen.getByRole("link", { name: /Aboriginal Interpreting WA/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /voice|microphone|dictat/i })).toBeNull();
  });
});
```

```tsx
// tests/first-nations-number-button.dom.test.tsx
/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NumberButton } from "@/components/first-nations/number-button";
import { bedsideFixture, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();
const { model } = bedsideFixture();

describe("NumberButton", () => {
  it("opens the kit's dial sheet with source, date and a report link", () => {
    render(<NumberButton contact={model.interpreter!} />);
    fireEvent.click(screen.getByText("1800 000 012"));
    const sheet = screen.getByRole("dialog", { name: "Aboriginal Interpreting WA" });
    expect(within(sheet).getByText("From Test guide · Checked 26 Sep 2026")).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Report a wrong number" }).getAttribute("href")).toMatch(/^mailto:/);
    expect(within(sheet).getByRole("button", { name: "Save to phone" })).toBeTruthy();
  });
});
```

```tsx
// tests/first-nations-page-menu.dom.test.tsx
/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FirstNationsMenuActions } from "@/components/first-nations/page-menu";
import { resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();

describe("FirstNationsMenuActions", () => {
  it("offers the pocket card and Log as CPD with the page only", () => {
    render(
      <FirstNationsMenuActions pageTitle="Talking" href="/first-nations/talking" reportHref={null} training={null} />,
    );
    expect(screen.getByRole("link", { name: "Pocket card" }).getAttribute("href")).toBe("/first-nations/card");
    expect(screen.getByRole("link", { name: "Log as CPD" }).getAttribute("href")).toBe(
      "/cme/new?title=First+Nations%3A+Talking&sourceUrl=%2Ffirst-nations%2Ftalking",
    );
    expect(screen.queryByRole("link", { name: "Report a wrong number" })).toBeNull();
  });
});
```

```tsx
// tests/first-nations-privacy.dom.test.tsx — the one cross-island rule (spec §6), so it is its own unit
/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BeforeYouGoIn } from "@/components/first-nations/before-you-go-in";
import { FirstNationsSearch } from "@/components/first-nations/first-nations-search";
import { SituationModule, SituationProvider } from "@/components/first-nations/situation-module";
import { WhereIsHomePanel } from "@/components/first-nations/where-is-home";
import { bedsideFixture, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();
const { model, hospital } = bedsideFixture();

describe("nothing patient-describing leaves the screen", () => {
  it("keeps situations, ticks, the region and the search text off storage, the URL and the network", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const pushState = vi.spyOn(history, "pushState");
    const replaceState = vi.spyOn(history, "replaceState");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const sendBeacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    const href = window.location.href;
    render(
      <SituationProvider situations={model.situations} liaison={hospital.liaison}>
        <SituationModule />
        <BeforeYouGoIn steps={model.beforeYouGoIn} />
        <WhereIsHomePanel regions={model.regions} map={model.map} interpreter={model.interpreter} />
        <FirstNationsSearch entries={model.search} />
      </SituationProvider>,
    );
    fireEvent.click(
      within(screen.getByRole("region", { name: "Situation" })).getByRole("button", { name: "Sorry Business" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Before you go in/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getAllByRole("checkbox")[0]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Goldfields" }));
    const box = screen.getByRole("searchbox", { name: "Search First Nations" });
    fireEvent.change(box, { target: { value: "family" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(window.location.href).toBe(href);
    for (const spy of [setItem, pushState, replaceState, fetchSpy, sendBeacon]) expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm run test:focused -- --files tests/first-nations-*.dom.test.tsx`
Expected: FAIL, missing modules (the Lane D crisis test still passes).

- [ ] **Step 5: Write the small shared pieces**

```tsx
// src/components/first-nations/voice.tsx — the only users of the serif accent
import { cn } from "@/components/ui-primitives";

const QUOTE_MARK = "text-[color:var(--mode-identity)]";

export function SpokenWords({ children, size = "lg" }: { children: string; size?: "lg" | "md" }) {
  return (
    <p
      data-mode-identity="first-nations"
      className={cn(
        "fn-voice border-l-[3px] border-[color:var(--mode-identity)] pl-3 text-[color:var(--text-heading)]",
        size === "lg" ? "text-lg-minus leading-[1.35]" : "text-base-minus leading-[1.4]",
      )}
    >
      <span aria-hidden="true" className={QUOTE_MARK}>
        “
      </span>
      {children}
      <span aria-hidden="true" className={QUOTE_MARK}>
        ”
      </span>
    </p>
  );
}

export function QuotedLaw({ children }: { children: string }) {
  return (
    <blockquote
      data-mode-identity="first-nations"
      className="fn-voice border-l-[3px] border-[color:var(--mode-identity)] pl-3 text-lg-minus leading-[1.5] text-[color:var(--text-heading)]"
    >
      {children}
    </blockquote>
  );
}

export function AcknowledgementText({ children }: { children: string }) {
  return (
    <p data-fn-part="acknowledgement" className="fn-voice px-1 text-sm-minus text-[color:var(--text-muted)]">
      {children}
    </p>
  );
}
```

```tsx
// src/components/first-nations/module-header.tsx
import type { ReactNode } from "react";
import { FIRST_NATIONS_ICONS, type FirstNationsIconName } from "@/components/first-nations/first-nations-icons";
import { cn, eyebrowText } from "@/components/ui-primitives";

export function ModuleHeader({
  id,
  icon,
  title,
  action,
}: {
  id: string;
  icon: FirstNationsIconName;
  title: string;
  action?: ReactNode;
}) {
  const Icon = FIRST_NATIONS_ICONS[icon];
  return (
    <div className="flex min-h-12 items-center gap-2 px-3 pt-3">
      <span
        data-mode-identity="first-nations"
        className="grid size-7 shrink-0 place-items-center rounded-lg border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      >
        <Icon className="size-icon-md" aria-hidden="true" />
      </span>
      <h2 id={id} className={cn(eyebrowText, "whitespace-nowrap")}>
        {title}
      </h2>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

export function FnModule({
  id,
  icon,
  title,
  action,
  children,
  className,
}: {
  id: string;
  icon: FirstNationsIconName;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "grid min-w-0 gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] pb-3 shadow-[var(--e1)]",
        className,
      )}
    >
      <ModuleHeader id={id} icon={icon} title={title} action={action} />
      {children}
    </section>
  );
}
```

```tsx
// src/components/first-nations/state-module.tsx — one module for empty, offline, error and not set up
import { Info, TriangleAlert, WifiOff } from "lucide-react";
import { ModeActionButton } from "@/components/first-nations/kit";

export type StateKind = "empty" | "offline" | "error" | "not-set-up";

const COPY = {
  empty: {
    Icon: Info,
    title: "No hospital numbers yet",
    line: "They appear here once your hospital's Aboriginal health team adds them.",
    action: "Report a missing number",
  },
  offline: {
    Icon: WifiOff,
    title: "Offline",
    line: "The numbers on this page still work. Nothing new can load.",
    action: "Try again",
  },
  error: {
    Icon: TriangleAlert,
    title: "This page didn't load",
    line: "Crisis numbers still work.",
    action: "Try again",
  },
  "not-set-up": {
    Icon: Info,
    title: "Liaison not set up here yet",
    line: "Statewide numbers still work.",
    action: "Report a missing number",
  },
} as const;

export function StateModule({ kind, href, onAction }: { kind: StateKind; href?: string; onAction?: () => void }) {
  const { Icon, title, line, action } = COPY[kind];
  return (
    <section
      role={kind === "error" ? "alert" : "status"}
      data-fn-part="state"
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 shadow-[var(--e1)]"
    >
      <span className="grid size-7 place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
        <Icon className="size-icon-md" aria-hidden="true" />
      </span>
      <div className="grid gap-0.5">
        <h2 className="text-sm-minus font-medium text-[color:var(--text-heading)]">{title}</h2>
        <p className="text-sm-minus text-[color:var(--text-muted)]">{line}</p>
      </div>
      {href || onAction ? (
        <div className="col-span-2 mt-2">
          <ModeActionButton variant="secondary" href={href} onClick={onAction}>
            {action}
          </ModeActionButton>
        </div>
      ) : null}
    </section>
  );
}
```

(The state title is 13 px at 500, not 15 px, so a Bedside screen showing the offline module under the hero still has four sizes.)

```tsx
// src/components/first-nations/number-button.tsx
"use client";
import { useState, type ReactNode } from "react";
import { cn } from "@/components/ui-primitives";
import { ModeDialSheet, ModeFactTile } from "@/components/first-nations/kit";
import { formatDayMonthYear, telHref, vcardFor } from "@/lib/first-nations/contact-format";
import type { ContactView } from "@/lib/first-nations/view-model";

function saveToPhone(contact: ContactView) {
  const url = URL.createObjectURL(new Blob([vcardFor(contact)], { type: "text/vcard" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${contact.name}.vcf`;
  link.click();
  URL.revokeObjectURL(url);
}

export function NumberSheetFooter({ contact }: { contact: ContactView }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4">
      <button
        type="button"
        className="min-h-12 text-sm-minus text-[color:var(--text-muted)]"
        onClick={() => saveToPhone(contact)}
      >
        Save to phone
      </button>
      {contact.reportHref ? (
        <a
          href={contact.reportHref}
          className="inline-flex min-h-12 items-center text-sm-minus text-[color:var(--text-muted)]"
        >
          Report a wrong number
        </a>
      ) : null}
    </div>
  );
}

function DialSheet({ contact, open, onClose }: { contact: ContactView; open: boolean; onClose: () => void }) {
  return (
    <ModeDialSheet
      open={open}
      onClose={onClose}
      number={contact.number}
      label={contact.name}
      source={contact.source.title}
      checkedAt={formatDayMonthYear(contact.checkedAt)}
      footer={<NumberSheetFooter contact={contact} />}
    />
  );
}

/** A number in running text. Without JavaScript it is a plain tel: link; once hydrated it opens the sheet. */
export function NumberButton({
  contact,
  children,
  className,
}: {
  contact: ContactView;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a
        href={telHref(contact.number)}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        className={cn("nums inline-flex min-h-12 items-center font-normal", className)}
      >
        {children ?? contact.number}
      </a>
      <DialSheet contact={contact} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function NumberTile({ contact, label }: { contact: ContactView; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ModeFactTile label={label} value={contact.number} detail={contact.detail} onPress={() => setOpen(true)} />
      <DialSheet contact={contact} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

```tsx
// src/components/first-nations/tick-list.tsx — controlled; the parent owns the ticks
import type { StepView } from "@/lib/first-nations/view-model";

export function TickList({
  steps,
  ticked,
  onToggle,
}: {
  steps: readonly StepView[];
  ticked: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ol className="grid rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)]">
      {steps.map((step, i) => (
        <li key={step.id} className="border-t border-[color:var(--border)] first:border-t-0">
          <label className="grid min-h-[3.25rem] cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-3 py-2.5">
            <input
              type="checkbox"
              checked={ticked.has(step.id)}
              onChange={() => onToggle(step.id)}
              className="mt-0.5 size-5 accent-[color:var(--clinical-accent)]"
              aria-describedby={`${step.id}-detail`}
            />
            <span className="grid gap-0.5">
              <span className="text-sm-minus font-medium text-[color:var(--text-heading)]">
                <span className="nums mr-1 text-[color:var(--text-muted)]">{i + 1}</span>
                {step.title}
              </span>
              <span id={`${step.id}-detail`} className="text-sm-minus text-[color:var(--text-muted)]">
                {step.detail}
              </span>
            </span>
          </label>
        </li>
      ))}
    </ol>
  );
}

export function toggleIn(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
```

- [ ] **Step 6: Write the hero and its day track**

```tsx
// src/components/first-nations/day-track.tsx — server-safe SVG
import { dayTrack, type Hours } from "@/lib/first-nations/hours";

const W = 280;
const TICKS = [0, 6, 12, 18, 24] as const;

export function DayTrack({ hours, now, label }: { hours: Hours | null; now: Date; label: string }) {
  const track = dayTrack(hours ?? undefined, now);
  if (!track) return <p className="text-sm-minus text-[color:var(--surface-summary-muted)]">Hours not set</p>;
  return (
    <svg viewBox={`0 0 ${W} 36`} role="img" aria-label={label} className="w-full">
      <line x1={0} y1={12} x2={W} y2={12} className="stroke-[color:var(--surface-summary-line)]" strokeWidth={1} />
      {track.open ? (
        <rect
          data-mode-identity="first-nations"
          className="fn-on-summary fill-[color:var(--mode-identity)]"
          x={track.open.from * W}
          y={9.5}
          width={(track.open.to - track.open.from) * W}
          height={5}
          rx={2.5}
        />
      ) : null}
      <line
        x1={track.now * W}
        y1={3}
        x2={track.now * W}
        y2={21}
        className="stroke-[color:var(--clinical-accent)]"
        strokeWidth={1.5}
      />
      <circle cx={track.now * W} cy={12} r={3.5} className="fill-[color:var(--clinical-accent)]" />
      {TICKS.map((h) => (
        <text
          key={h}
          x={(h / 24) * W}
          y={32}
          textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}
          className="nums fill-[color:var(--surface-summary-muted)] text-2xs"
        >
          {String(h).padStart(2, "0")}
        </text>
      ))}
    </svg>
  );
}
```

```tsx
// src/components/first-nations/liaison-hero.tsx
"use client";
import { Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DayTrack } from "@/components/first-nations/day-track";
import { ModeStateLabel } from "@/components/first-nations/kit";
import { NumberButton } from "@/components/first-nations/number-button";
import { systemClock, type Clock } from "@/lib/caring-contacts/clock";
import { telHref } from "@/lib/first-nations/contact-format";
import { callState, hoursInWords, type CallState } from "@/lib/first-nations/hours";
import type { HospitalView } from "@/lib/first-nations/view-model";

const SYSTEM_CLOCK = systemClock();

function status(state: CallState): { label: string; tone: "live" | "neutral" | "warning" } {
  switch (state.kind) {
    case "open":
      return { label: "Open now", tone: "live" };
    case "closed":
      return state.opensAt
        ? {
            label: `Closed · opens ${state.opensOn === "today" ? "" : `${state.opensOn} `}${state.opensAt}`,
            tone: "neutral",
          }
        : { label: "Closed", tone: "neutral" };
    case "overdue":
      return { label: "Due for a check", tone: "warning" };
    default:
      return { label: "Hours not confirmed", tone: "neutral" };
  }
}

export function LiaisonHero({ hospital, clock = SYSTEM_CLOCK }: { hospital: HospitalView; clock?: Clock }) {
  const [state, setState] = useState<CallState>({ kind: "unconfirmed" });
  const [now, setNow] = useState<Date | null>(null);
  // The first client computation is "first load": it may say open, but it hands the kit a
  // neutral state so the green dot's one pulse is saved for a real later change.
  const settled = useRef(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const tick = () => {
      const current = clock.now();
      const next = callState(hospital.liaison.hours ?? undefined, hospital.liaison.checkedAt, current);
      setNow(current);
      setState(next);
      setLive(next.kind === "open");
      settled.current = true;
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [clock, hospital]);

  const { label, tone } = status(state);
  const open = state.kind === "open";
  const target = open ? hospital.liaison : hospital.switchboard;

  return (
    <section
      aria-labelledby="fn-liaison-title"
      data-fn-part="hero"
      className="grid gap-2 rounded-2xl border border-[color:var(--surface-summary-line)] bg-[color:var(--surface-summary)] p-3 text-[color:var(--surface-summary-ink)]"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="fn-liaison-title"
          className="text-2xs font-semibold uppercase tracking-label text-[color:var(--surface-summary-muted)]"
        >
          Aboriginal liaison
        </h2>
        <p aria-live="polite" className="text-sm-minus">
          <ModeStateLabel state={tone === "live" && !live ? "neutral" : tone}>{label}</ModeStateLabel>
        </p>
      </div>
      <p data-testid="fn-hero-figure" className="fn-display-36">
        <span className="text-sm-minus font-normal text-[color:var(--surface-summary-muted)]">
          {open ? "until " : "switchboard "}
        </span>
        {state.kind === "open" ? <span>{state.closesAt}</span> : <span>{hospital.switchboard.number}</span>}
      </p>
      {now ? (
        <DayTrack
          hours={hospital.liaison.hours}
          now={now}
          label={`${hospital.liaison.hours ? hoursInWords(hospital.liaison.hours) : "Hours not set"}; ${label}`}
        />
      ) : null}
      <p className="text-sm-minus text-[color:var(--surface-summary-muted)]">
        {hospital.liaison.hours ? hoursInWords(hospital.liaison.hours) : "Hours not set"}
      </p>
      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--surface-summary-line)] pt-2">
        <div className="grid min-w-0 text-sm-minus text-[color:var(--surface-summary-muted)]">
          {open ? (
            <>
              <NumberButton
                contact={hospital.liaison}
                className="text-lg-minus text-[color:var(--surface-summary-ink)]"
              />
              <span>After hours, switchboard {hospital.switchboard.number}</span>
            </>
          ) : (
            <>
              <span>
                {state.kind === "overdue" ? "Liaison hours need a recheck" : "Ask who covers liaison tonight"}
              </span>
              <span>
                Liaison <NumberButton contact={hospital.liaison} className="text-[color:var(--surface-summary-ink)]" />
              </span>
            </>
          )}
        </div>
        <a
          href={telHref(target.number)}
          aria-label={`Call ${target.name}`}
          data-fn-filled
          className="grid size-12 shrink-0 place-items-center rounded-full bg-[color:var(--surface-summary-ink)] text-[color:var(--surface-summary)]"
        >
          <Phone className="size-icon-md" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
```

The `live` flag starts false and is set by the first `tick`, so the label renders neutral for the server render and the first paint, then live. The kit pulses only on a change to live after mount, which the transition test checks. If the kit's `ModeStateLabel` already suppresses the pulse on mount, delete the `live` and `settled` bookkeeping and pass `tone` directly.

- [ ] **Step 7: Write the Situation module**

```tsx
// src/components/first-nations/situation-module.tsx
"use client";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ModeActionButton, ModeNotice, ModeUpdatedLine } from "@/components/first-nations/kit";
import { ModuleHeader } from "@/components/first-nations/module-header";
import { TickList, toggleIn } from "@/components/first-nations/tick-list";
import { SpokenWords } from "@/components/first-nations/voice";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { formatDayMonthYear, telHref } from "@/lib/first-nations/contact-format";
import type { ContactView, PhraseView, SituationView } from "@/lib/first-nations/view-model";

type Ctx = {
  situations: readonly SituationView[];
  index: number;
  select: (i: number) => void;
  liaison: ContactView | null;
};
const SituationContext = createContext<Ctx | null>(null);

function useSituation(): Ctx {
  const ctx = useContext(SituationContext);
  if (!ctx) throw new Error("SituationProvider is missing");
  return ctx;
}

export function SituationProvider({
  situations,
  liaison,
  children,
}: {
  situations: readonly SituationView[];
  liaison: ContactView | null;
  children: ReactNode;
}) {
  const [index, setIndex] = useState(0); // opens on New admission (owner decision)
  const value = useMemo(
    () => ({
      situations,
      index,
      liaison,
      select: (i: number) => setIndex((i + situations.length) % situations.length),
    }),
    [situations, index, liaison],
  );
  return <SituationContext.Provider value={value}>{children}</SituationContext.Provider>;
}

const planText = (s: SituationView) =>
  [s.label, ...s.plan.map((p, i) => `${i + 1}. ${p.title}${p.detail ? ` — ${p.detail}` : ""}`)].join("\n");

function PlanActions({ situation, allowFilled }: { situation: SituationView; allowFilled: boolean }) {
  const { liaison } = useSituation();
  const [note, setNote] = useState<string | null>(null);
  const call = situation.plan.find((p) => p.contact)?.contact ?? liaison;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {call && telHref(call.number) ? (
          <ModeActionButton variant={allowFilled ? "primary" : "secondary"} href={telHref(call.number)}>
            {`Call ${call === liaison ? "liaison" : call.name}`}
          </ModeActionButton>
        ) : null}
        <ModeActionButton
          variant="secondary"
          onClick={() => {
            copyTextToClipboard(planText(situation)).then(
              () => setNote("Copied"),
              () => setNote("Copying isn't available on this phone"),
            );
          }}
        >
          Copy steps
        </ModeActionButton>
      </div>
      {note ? (
        <p role="status" className="text-sm-minus text-[color:var(--text-muted)]">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function PlanTicks({ situation }: { situation: SituationView }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  return <TickList steps={situation.plan} ticked={ticked} onToggle={(id) => setTicked((t) => toggleIn(t, id))} />;
}

function PhraseStepper({ phrases }: { phrases: readonly PhraseView[] }) {
  const [i, setI] = useState(0);
  const phrase = phrases[i];
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className={eyebrowText}>Try saying</span>
        <span className="flex items-center gap-1 text-2xs text-[color:var(--text-muted)]">
          <span className="nums">{`${i + 1} of ${phrases.length}`}</span>
          <button
            type="button"
            aria-label="Next phrase"
            onClick={() => setI((n) => (n + 1) % phrases.length)}
            className="grid size-12 place-items-center rounded-lg text-[color:var(--text)]"
          >
            <ArrowRight className="size-icon-sm" aria-hidden="true" />
          </button>
        </span>
      </div>
      <SpokenWords>{phrase.say}</SpokenWords>
      <ModeUpdatedLine
        source={phrase.source.title}
        href={phrase.source.url}
        checkedAt={formatDayMonthYear(phrase.checkedAt)}
      />
    </div>
  );
}

export function SituationModule() {
  const { situations, index, select } = useSituation();
  const situation = situations[index];
  const [planOpen, setPlanOpen] = useState(false);
  return (
    <section
      aria-labelledby="fn-situation-title"
      data-fn-part="situation"
      className="grid min-w-0 gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] pb-3 shadow-[var(--e1)]"
    >
      <ModuleHeader
        id="fn-situation-title"
        icon="message"
        title="Situation"
        action={
          <button
            type="button"
            onClick={() => setPlanOpen(true)}
            className="relative inline-flex h-[2.125rem] items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] pl-3 pr-2.5 text-sm-minus text-[color:var(--text-heading)] after:absolute after:-inset-x-1 after:-inset-y-[0.4375rem] lg:hidden"
          >
            {`Plan · ${situation.plan.length} steps`}
            <ChevronRight className="size-icon-xs" aria-hidden="true" />
          </button>
        }
      />
      <div className="flex flex-wrap gap-2 px-3">
        {situations.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={i === index}
            onClick={() => select(i)}
            className={cn(
              "relative h-9 rounded-full border px-3 text-sm-minus after:absolute after:inset-x-0 after:-inset-y-1.5",
              i === index
                ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--text-heading)]"
                : "border-[color:var(--border)] bg-[color:var(--background)] text-[color:var(--text)]",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {situation.riskLine ? (
        <div className="px-3">
          <ModeNotice tone="warning">{situation.riskLine}</ModeNotice>
        </div>
      ) : null}
      <div className="grid gap-2 px-3">
        <PhraseStepper key={situation.id} phrases={situation.phrases} />
        <div className="grid gap-0.5 border-t border-[color:var(--border)] pt-2 lg:hidden">
          <span className={eyebrowText}>First step</span>
          <span className="text-sm-minus font-medium text-[color:var(--text-heading)]">
            {situation.firstStep.title}
          </span>
        </div>
      </div>
      <Sheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title={situation.label}
        description={`${situation.plan.length} steps · nothing is saved`}
      >
        <div className="grid gap-3">
          {situation.riskLine ? <ModeNotice tone="warning">{situation.riskLine}</ModeNotice> : null}
          <PlanTicks situation={situation} />
          <PlanActions situation={situation} allowFilled />
        </div>
      </Sheet>
    </section>
  );
}

/** Desktop only: the chosen situation's plan in a 360 px side panel, with previous and next. */
export function SituationSidePanel() {
  const { situations, index, select } = useSituation();
  const situation = situations[index];
  return (
    <aside
      aria-label="Situation plan"
      data-fn-part="plan-panel"
      className="hidden content-start gap-3 border-l border-[color:var(--border)] bg-[color:var(--background)] p-4 lg:grid"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <span className={eyebrowText}>Situation plan</span>
          <h2 className="text-lg-minus font-semibold text-[color:var(--text-heading)]">{situation.label}</h2>
          <p className="text-sm-minus text-[color:var(--text-muted)]">{`${situation.plan.length} steps · nothing is saved`}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous situation"
            onClick={() => select(index - 1)}
            className="grid size-12 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--e1)]"
          >
            <ArrowLeft className="size-icon-md" aria-hidden="true" />
          </button>
          <span className="nums min-w-11 text-center text-sm-minus text-[color:var(--text-muted)]">{`${index + 1} of ${situations.length}`}</span>
          <button
            type="button"
            aria-label="Next situation"
            onClick={() => select(index + 1)}
            className="grid size-12 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--e1)]"
          >
            <ArrowRight className="size-icon-md" aria-hidden="true" />
          </button>
        </div>
      </div>
      {situation.riskLine ? <ModeNotice tone="warning">{situation.riskLine}</ModeNotice> : null}
      <PlanTicks key={situation.id} situation={situation} />
      <PlanActions situation={situation} allowFilled={false} />
    </aside>
  );
}
```

(The Sheet renders nothing when closed, so the plan's ticks unmount and it opens unticked every time. Confirm `Sheet` closes on Escape as its docblock says; the test relies on it.)

- [ ] **Step 8: Write "Before you go in" and "Where is home?"**

```tsx
// src/components/first-nations/before-you-go-in.tsx
"use client";
import { useEffect, useState } from "react";
import { ModeActionButton } from "@/components/first-nations/kit";
import { ModuleHeader } from "@/components/first-nations/module-header";
import { TickList, toggleIn } from "@/components/first-nations/tick-list";
import { Sheet } from "@/components/ui/sheet";
import type { StepView } from "@/lib/first-nations/view-model";

export const UNDO_MS = 6_000;

function Checks({ steps }: { steps: readonly StepView[] }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [undo, setUndo] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);
  return (
    <div className="grid gap-3">
      <TickList steps={steps} ticked={ticked} onToggle={(id) => setTicked((t) => toggleIn(t, id))} />
      {ticked.size > 0 ? (
        <ModeActionButton
          variant="secondary"
          onClick={() => {
            setUndo(ticked);
            setTicked(new Set());
          }}
        >
          Clear ticks
        </ModeActionButton>
      ) : null}
      {undo ? (
        <div
          role="status"
          className="flex min-h-12 items-center justify-between rounded-xl bg-[color:var(--command)] pl-3.5 pr-1 text-sm-minus text-[color:var(--command-contrast)]"
        >
          <span>Ticks cleared</span>
          <button
            type="button"
            className="min-h-12 px-2.5 font-medium"
            onClick={() => {
              setTicked(undo);
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function BeforeYouGoIn({ steps }: { steps: readonly StepView[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid min-h-[5.5rem] content-start gap-0.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] pb-3 text-left shadow-[var(--e1)]"
      >
        <ModuleHeader id="fn-byg-title" icon="check" title="Checks" />
        <span className="px-3 text-sm-minus font-medium text-[color:var(--text-heading)]">Before you go in</span>
        <span className="px-3 text-sm-minus text-[color:var(--text-muted)]">{`${steps.length} checks · 1 minute`}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Before you go in" description="Nothing is saved">
        <Checks steps={steps} />
      </Sheet>
    </>
  );
}
```

(The tiles use the module header so the one olive element per tile is the 28 px icon tile. The tile's accessible name is "Checks Before you go in 5 checks · 1 minute", which the test matches with `/Before you go in/`.)

```tsx
// src/components/first-nations/where-is-home.tsx
"use client";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ModeActionButton, ModeDialRow, ModeGroupedList, ModeUpdatedLine } from "@/components/first-nations/kit";
import { FnModule, ModuleHeader } from "@/components/first-nations/module-header";
import { NumberSheetFooter } from "@/components/first-nations/number-button";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { formatDayMonthYear } from "@/lib/first-nations/contact-format";
import type { WaMap } from "@/lib/first-nations/content-schema";
import type { ContactView, RegionView } from "@/lib/first-nations/view-model";

type Props = { regions: readonly RegionView[]; map: WaMap; interpreter: ContactView | null };

function DialRow({ contact }: { contact: ContactView }) {
  return (
    <ModeDialRow
      number={contact.number}
      label={contact.name}
      detail={contact.detail}
      source={contact.source.title}
      checkedAt={formatDayMonthYear(contact.checkedAt)}
      footer={<NumberSheetFooter contact={contact} />}
    />
  );
}

function WaLineMap({ map, selectedId }: { map: WaMap; selectedId: string | null }) {
  return (
    <svg viewBox={map.viewBox} aria-hidden="true" className="mx-auto h-48 w-full">
      {map.regions.map((r) => (
        <path
          key={r.id}
          d={r.path}
          vectorEffect="non-scaling-stroke"
          strokeWidth={1}
          className={cn(
            r.id === selectedId
              ? "fill-[color:var(--clinical-accent-soft)] stroke-[color:var(--clinical-accent)]"
              : "fill-[color:var(--surface-subtle)] stroke-[color:var(--border-strong)]",
          )}
        />
      ))}
    </svg>
  );
}

function regionLines(region: RegionView): string[] {
  return [
    ...region.services.map((c) => `${c.name} · ${c.number}`),
    ...(region.languages.length ? [`Interpreter: ${region.languages.join(" or ")}`] : []),
  ];
}

/** The region lives in this component's state only: never stored, never in a URL, never sent, never in the main search. */
export function WhereIsHomePanel({ regions, map, interpreter }: Props) {
  const [regionId, setRegionId] = useState<string | null>(null);
  const [letter, setLetter] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const region = regions.find((r) => r.id === regionId) ?? null;
  const copy = (text: string) =>
    copyTextToClipboard(text).then(
      () => setNote("Copied"),
      () => setNote("Copying isn't available on this phone"),
    );
  return (
    <div className="grid gap-3">
      <section
        aria-labelledby="fn-home-region"
        className="grid gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 shadow-[var(--e1)]"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 id="fn-home-region" className={eyebrowText}>
            Home region
          </h3>
          <p className="inline-flex items-center gap-1 text-2xs text-[color:var(--text-muted)]">
            <ShieldCheck className="size-icon-xs" aria-hidden="true" />
            Never saved or sent
          </p>
        </div>
        <WaLineMap map={map} selectedId={regionId} />
        <div role="group" aria-label="Home region" className="grid grid-cols-2 gap-x-2 gap-y-3">
          {regions.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === regionId}
              onClick={() => {
                setRegionId(r.id);
                setNote(null);
              }}
              className={cn(
                "relative h-9 rounded-lg border px-3 text-sm-minus after:absolute after:inset-x-0 after:-inset-y-1.5",
                r.id === regionId
                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--text-heading)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <ModeUpdatedLine
          source="WA health region boundaries"
          href={undefined}
          checkedAt={formatDayMonthYear(map.checkedAt)}
        />
      </section>
      {region ? (
        <>
          <FnModule id="fn-near-home" icon="map-pin" title={`Near home · ${region.label}`}>
            <ModeGroupedList>
              {region.services.map((c) => (
                <DialRow key={c.id} contact={c} />
              ))}
            </ModeGroupedList>
          </FnModule>
          <FnModule id="fn-languages" icon="message" title="Languages">
            <ul className="flex flex-wrap gap-1.5 px-3">
              {region.languages.map((l) => (
                <li
                  key={l}
                  className="inline-flex h-8 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-2.5 text-sm-minus text-[color:var(--text)]"
                >
                  {l}
                </li>
              ))}
            </ul>
            {interpreter ? (
              <ModeGroupedList>
                <DialRow contact={interpreter} />
              </ModeGroupedList>
            ) : null}
          </FnModule>
          <ModeUpdatedLine
            source={region.source.title}
            href={region.source.url}
            checkedAt={formatDayMonthYear(region.checkedAt)}
          />
          <div className="flex flex-wrap gap-2">
            <ModeActionButton variant="primary" onClick={() => setLetter(regionLines(region))}>
              Add to letter
            </ModeActionButton>
            <ModeActionButton variant="secondary" onClick={() => void copy(regionLines(region).join("\n"))}>
              Copy all
            </ModeActionButton>
          </div>
        </>
      ) : null}
      {letter.length > 0 ? (
        <FnModule
          id="fn-letter"
          icon="clipboard"
          title="For the letter"
          action={
            <button
              type="button"
              className="min-h-12 px-2 text-sm-minus text-[color:var(--text-heading)]"
              onClick={() => void copy(letter.join("\n"))}
            >
              Copy
            </button>
          }
        >
          <p className="nums mx-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2.5 text-sm-minus leading-[1.55] text-[color:var(--text)]">
            {letter.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
        </FnModule>
      ) : null}
      {note ? (
        <p role="status" className="text-sm-minus text-[color:var(--text-muted)]">
          {note}
        </p>
      ) : null}
    </div>
  );
}

export function WhereIsHomeTile(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid min-h-[5.5rem] content-start gap-0.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] pb-3 text-left shadow-[var(--e1)]"
      >
        <ModuleHeader id="fn-home-tile" icon="map-pin" title="Home" />
        <span className="px-3 text-sm-minus font-medium text-[color:var(--text-heading)]">Where is home?</span>
        <span className="px-3 text-sm-minus text-[color:var(--text-muted)]">Care near home</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Where is home?">
        <WhereIsHomePanel {...props} />
      </Sheet>
    </>
  );
}
```

The map is a picture; the region chips are the control, so keyboard and screen-reader users choose the same way. The map's own source line uses the Task 0 boundary source title; replace the literal "WA health region boundaries" with that title from `map.sourceId` by passing `mapSource: SourceView` into the props from the view-model (add `mapSource` to `BedsideModel` and `InnerPageModel` in Task 2 if the Task 0 title differs).

- [ ] **Step 9: Write the search box, phrase deck, offline state, primer, hospital choice and page menu**

```tsx
// src/components/first-nations/first-nations-search.tsx — the mode's own box: no microphone,
// nothing handed to the main search bar or OpenAI (design standard §13)
"use client";
import { Search } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { searchEntries, type SearchEntry } from "@/lib/first-nations/search";

export function FirstNationsSearch({ entries }: { entries: readonly SearchEntry[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchEntries(entries, query), [entries, query]);
  const inputId = useId();
  const listId = useId();
  return (
    <div role="search" data-fn-part="search" className="grid gap-2">
      <div className="flex min-h-12 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 focus-within:outline focus-within:outline-2 focus-within:outline-[color:var(--focus)]">
        <Search className="size-icon-md text-[color:var(--text-muted)]" aria-hidden="true" />
        <label htmlFor={inputId} className="sr-only">
          Search First Nations
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          placeholder="Search First Nations"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-controls={listId}
          className="min-h-12 min-w-0 flex-1 bg-transparent text-sm-minus text-[color:var(--text-heading)] outline-none"
        />
      </div>
      {query.trim() ? (
        results.length ? (
          <ul
            id={listId}
            className="grid rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)]"
          >
            {results.map((r) => (
              <li key={r.id} className="border-t border-[color:var(--border)] first:border-t-0">
                <Link href={r.href} className="grid min-h-12 content-center gap-0.5 px-3 py-2">
                  <span className="text-sm-minus font-medium text-[color:var(--text-heading)]">{r.title}</span>
                  <span className="text-sm-minus text-[color:var(--text-muted)]">{r.number ?? r.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p id={listId} role="status" className="px-1 text-sm-minus text-[color:var(--text-muted)]">
            Nothing found for that.
          </p>
        )
      ) : null}
    </div>
  );
}
```

```tsx
// src/components/first-nations/phrase-deck.tsx
"use client";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { ModeUpdatedLine } from "@/components/first-nations/kit";
import { FnModule } from "@/components/first-nations/module-header";
import { SpokenWords } from "@/components/first-nations/voice";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { formatDayMonthYear } from "@/lib/first-nations/contact-format";
import type { PhraseView } from "@/lib/first-nations/view-model";

export function PhraseDeck({ id, phrases }: { id: string; phrases: readonly PhraseView[] }) {
  const [i, setI] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const phrase = phrases[i];
  return (
    <FnModule
      id={id}
      icon="message"
      title="Phrases"
      action={
        <span className="flex items-center gap-1 text-2xs text-[color:var(--text-muted)]">
          <span className="nums">{`${i + 1} of ${phrases.length}`}</span>
          <button
            type="button"
            aria-label="Next phrase"
            onClick={() => setI((n) => (n + 1) % phrases.length)}
            className="grid size-12 place-items-center"
          >
            <ArrowRight className="size-icon-sm" aria-hidden="true" />
          </button>
        </span>
      }
    >
      <div className="grid gap-2 px-3">
        <SpokenWords>{phrase.say}</SpokenWords>
        <div className="flex items-center justify-end">
          <button
            type="button"
            className="min-h-12 px-2 text-sm-minus text-[color:var(--text-heading)]"
            onClick={() => {
              copyTextToClipboard(phrase.say).then(
                () => setNote("Copied"),
                () => setNote("Copying isn't available on this phone"),
              );
            }}
          >
            Copy
          </button>
        </div>
        {note ? (
          <p role="status" className="text-sm-minus text-[color:var(--text-muted)]">
            {note}
          </p>
        ) : null}
        <ModeUpdatedLine
          source={phrase.source.title}
          href={phrase.source.url}
          checkedAt={formatDayMonthYear(phrase.checkedAt)}
        />
      </div>
    </FnModule>
  );
}
```

```tsx
// src/components/first-nations/offline-state.tsx
"use client";
import { useEffect, useState } from "react";
import { StateModule } from "@/components/first-nations/state-module";

export function OfflineState() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return offline ? <StateModule kind="offline" onAction={() => window.location.reload()} /> : null;
}
```

```tsx
// src/components/first-nations/primer.tsx — shown once per device; the flag holds no personal data
"use client";
import { useEffect, useState } from "react";
import { ModeActionButton } from "@/components/first-nations/kit";
import { Sheet } from "@/components/ui/sheet";

const KEY = "first-nations-primer-dismissed";
export const PRIMER_EVENT = "first-nations:open-primer";

export function Primer() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) !== "1") setOpen(true);
    } catch {
      setOpen(true);
    }
    const reopen = () => setOpen(true);
    window.addEventListener(PRIMER_EVENT, reopen);
    return () => window.removeEventListener(PRIMER_EVENT, reopen);
  }, []);
  const close = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // Private windows may refuse storage; the primer simply shows again next time.
    }
    setOpen(false);
  };
  return (
    <Sheet open={open} onClose={close} title="About First Nations">
      <ul className="grid gap-2 text-sm-minus text-[color:var(--text)]">
        <li>A reference and contacts tool, not clinical decision support.</li>
        <li>Cultural content shows its source and awaits your service's Aboriginal health team.</li>
        <li>Nothing about any patient is saved or sent.</li>
      </ul>
      <div className="mt-3">
        <ModeActionButton variant="primary" onClick={close}>
          Got it
        </ModeActionButton>
      </div>
    </Sheet>
  );
}
```

```ts
// src/components/first-nations/hospital-choice.ts
"use client";
import { useEffect, useState } from "react";
import { FIRST_NATIONS_HOSPITAL_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import type { HospitalView } from "@/lib/first-nations/view-model";

/** The chosen hospital id only; account-scoped, so it clears at sign-out. The page works before a choice. */
export function useChosenHospital(hospitals: readonly HospitalView[]): [HospitalView | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setId(window.localStorage.getItem(FIRST_NATIONS_HOSPITAL_STORAGE_KEY));
    } catch {
      setId(null);
    }
  }, []);
  const choose = (next: string) => {
    setId(next);
    try {
      window.localStorage.setItem(FIRST_NATIONS_HOSPITAL_STORAGE_KEY, next);
    } catch {
      // Storage refused: the choice lasts for this page only.
    }
  };
  return [hospitals.find((h) => h.id === id) ?? hospitals[0] ?? null, choose];
}
```

```tsx
// src/components/first-nations/page-menu.tsx
"use client";
import Link from "next/link";
import { UniversalHeaderTrailingPortal } from "@/components/clinical-dashboard/universal-header-trailing-portal";
import { PRIMER_EVENT } from "@/components/first-nations/primer";
import { inPageActionRowClass } from "@/components/in-page-nav/in-page-nav-classes";
import { cmeLearningFromSourceHref } from "@/lib/cme/learning-source";

type MenuProps = {
  pageTitle: string;
  href: string;
  reportHref: string | null;
  training: { label: string; href: string } | null;
};

export function firstNationsCpdHref(pageTitle: string, href: string): string | null {
  return cmeLearningFromSourceHref({ title: `First Nations: ${pageTitle}`, href });
}

/** Carries the page, never anything about a patient; opening the CPD form logs nothing until the doctor saves. */
export function FirstNationsMenuActions({ pageTitle, href, reportHref, training }: MenuProps) {
  const cpd = firstNationsCpdHref(pageTitle, href);
  return (
    <div className="grid">
      <Link href="/first-nations/card" className={inPageActionRowClass}>
        Pocket card
      </Link>
      {reportHref ? (
        <a href={reportHref} className={inPageActionRowClass}>
          Report a wrong number
        </a>
      ) : null}
      {training ? (
        <a href={training.href} className={inPageActionRowClass} rel="noreferrer" target="_blank">
          {training.label}
        </a>
      ) : null}
      <button
        type="button"
        className={inPageActionRowClass}
        onClick={() => window.dispatchEvent(new Event(PRIMER_EVENT))}
      >
        About this mode
      </button>
      {cpd ? (
        <Link href={cpd} className={inPageActionRowClass}>
          Log as CPD
        </Link>
      ) : null}
    </div>
  );
}

/** Bedside has no in-page header, so its ••• portals into the universal header, as On Call's home does. */
export function FirstNationsHomeMenu(props: MenuProps) {
  return (
    <UniversalHeaderTrailingPortal>
      <details className="relative">
        <summary
          aria-label="Page actions"
          className="grid size-12 cursor-pointer list-none place-items-center rounded-full"
        >
          •••
        </summary>
        <div className="absolute right-0 z-[var(--z-raised)] mt-1 w-64 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-1 shadow-[var(--e4)]">
          <FirstNationsMenuActions {...props} />
        </div>
      </details>
    </UniversalHeaderTrailingPortal>
  );
}
```

(Copy the exact trigger and sheet pattern of `OnCallPageMenu` in `src/components/on-call/on-call-page-menu.tsx` in place of the `<details>` shown here if its z-index and icon rules differ; the rows stay as written. Confirm `inPageActionRowClass` is exported from `in-page-nav-classes`. "Change hospital" joins these rows only when `useChosenHospital` has more than one hospital, which cannot happen while the EMHS layer is off; "Sources" lists each item's own source line, so no separate sources sheet is built.)

- [ ] **Step 10: Run and confirm pass**

Run: `npm run test:focused -- --files tests/first-nations-*.dom.test.tsx`
Expected: PASS (17 island tests: 5 + 4 + 2 + 2 + 1 + 1 + 1 + 1, plus the crisis test).

- [ ] **Step 11: Commit:** `git add src/components/first-nations/kit.ts src/components/first-nations/voice.tsx src/components/first-nations/module-header.tsx src/components/first-nations/state-module.tsx src/components/first-nations/number-button.tsx src/components/first-nations/day-track.tsx src/components/first-nations/liaison-hero.tsx src/components/first-nations/tick-list.tsx src/components/first-nations/situation-module.tsx src/components/first-nations/before-you-go-in.tsx src/components/first-nations/where-is-home.tsx src/components/first-nations/first-nations-search.tsx src/components/first-nations/phrase-deck.tsx src/components/first-nations/offline-state.tsx src/components/first-nations/primer.tsx src/components/first-nations/hospital-choice.ts src/components/first-nations/page-menu.tsx tests/fixtures/first-nations-kit-double.tsx tests/fixtures/first-nations-models.ts tests/first-nations-liaison-hero.dom.test.tsx tests/first-nations-situation-module.dom.test.tsx tests/first-nations-before-you-go-in.dom.test.tsx tests/first-nations-where-is-home.dom.test.tsx tests/first-nations-search-box.dom.test.tsx tests/first-nations-number-button.dom.test.tsx tests/first-nations-page-menu.dom.test.tsx tests/first-nations-privacy.dom.test.tsx && git commit -m "First Nations: hero, situation, number sheet, checks, home region, search and menu islands"`

---

### Task 6: Server renderer (Lane C, mid-tier, after Task 7)

**Files:**

- Create: `src/components/first-nations/bedside-home.tsx`, `inner-page.tsx`, `blocks.tsx`, `src/app/(search-app)/first-nations/error.tsx`
- Replace: `src/components/first-nations/page-renderer.tsx` (the Task 5 stub)
- Test: `tests/first-nations-renderer.dom.test.tsx`

**Interfaces:**

- Consumes: `loadModelInputs` (Task 2); `buildBedsideModel`, `buildInnerPageModel` and view types (Task 2); every Task 7 island; `CrisisStrip`, `CrisisBlock`, `FirstNationsNavHeader`, `FIRST_NATIONS_ICONS` (Task 5); `moduleIcons`, `firstNationsPageHref` (Task 1).
- Produces: `FirstNationsPageRenderer({ pageId: FirstNationsPageId })`, `BedsideHomeView({ model })`, `InnerPageView({ model })`, `toTabs(model)`, `ModuleBody({ module, model })`.

- [ ] **Step 1: Write the failing test** `tests/first-nations-renderer.dom.test.tsx`

```tsx
/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { moduleIcons, parseFirstNationsContent } from "@/lib/first-nations/content-schema";
import { buildBedsideModel, buildInnerPageModel } from "@/lib/first-nations/view-model";
import FirstNationsError from "@/app/(search-app)/first-nations/error";
import { BedsideHomeView } from "@/components/first-nations/bedside-home";
import { FIRST_NATIONS_ICONS } from "@/components/first-nations/first-nations-icons";
import { InnerPageView, toTabs } from "@/components/first-nations/inner-page";
import { contentInput, contentWithNoteWording, enabledProfile, testInputs } from "./fixtures/first-nations-content";
import { acknowledgementApproval, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
vi.mock("@/components/first-nations/first-nations-nav-header", () => ({ FirstNationsNavHeader: () => null }));
vi.mock("@/components/first-nations/page-menu", () => ({
  FirstNationsHomeMenu: () => null,
  FirstNationsMenuActions: () => null,
}));
vi.mock("@/components/first-nations/primer", () => ({ Primer: () => null, PRIMER_EVENT: "x" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/first-nations" }));

resetAfterEach();

const profile = enabledProfile();
const ack = acknowledgementApproval();
const parts = () => [...document.querySelectorAll("[data-fn-part]")].map((el) => el.getAttribute("data-fn-part"));

describe("Bedside", () => {
  it("composes example line, hero, crisis strip, search, Situation, tools and Acknowledgement in that order", () => {
    render(<BedsideHomeView model={buildBedsideModel(testInputs({ profile, approvals: [ack] }))} />);
    expect(parts().filter((p) => p !== "plan-panel")).toEqual([
      "example",
      "hero",
      "crisis",
      "search",
      "situation",
      "tools",
      "acknowledgement",
    ]);
  });
  it("shows the not-set-up state module, statewide numbers and no Acknowledgement while the layer is off", () => {
    render(<BedsideHomeView model={buildBedsideModel(testInputs())} />);
    expect(screen.getByText("Liaison not set up here yet")).toBeTruthy();
    expect(screen.getByText("Statewide numbers still work.")).toBeTruthy();
    expect(parts()).not.toContain("hero");
    expect(parts()).toContain("crisis");
    expect(parts()).not.toContain("acknowledgement");
  });
  it("hides the Acknowledgement until approved words exist", () => {
    render(<BedsideHomeView model={buildBedsideModel(testInputs({ profile }))} />);
    expect(parts()).not.toContain("acknowledgement");
  });
  it("keeps the crisis strip when the phone goes offline", () => {
    render(<BedsideHomeView model={buildBedsideModel(testInputs())} />);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(parts()).toContain("crisis");
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });
});

describe("Inner pages", () => {
  it("shows credited content with the example line and never our own unapproved wording", () => {
    const content = parseFirstNationsContent(contentWithNoteWording());
    render(<InnerPageView model={buildInnerPageModel(testInputs({ content }), "contacts")} />);
    expect(screen.getByText("Tip on contacts")).toBeTruthy();
    expect(screen.getByText("Example only · wording awaiting approval")).toBeTruthy();
    expect(screen.queryByText(/Collaborated with/)).toBeNull();
    expect(screen.getByText("13 11 14")).toBeTruthy();
  });
  it("shows the empty state for hospital numbers while the layer is off, keeping the crisis strip", () => {
    const input = contentInput();
    const contacts = input.pages.find((p) => p.id === "contacts");
    if (!contacts) throw new Error("fixture has no contacts page");
    contacts.sections[0].modules.push({
      id: "hospital-numbers",
      title: "Hospital",
      icon: "phone",
      layout: "service-contacts",
      blocks: [],
    });
    render(
      <InnerPageView
        model={buildInnerPageModel(testInputs({ content: parseFirstNationsContent(input) }), "contacts")}
      />,
    );
    expect(screen.getByText("No hospital numbers yet")).toBeTruthy();
    expect(parts()).toContain("crisis");
  });
  it("gives tabs plain labels with no counts", () => {
    const tabs = toTabs(buildInnerPageModel(testInputs(), "talking"));
    expect(tabs.map((t) => t.label)).toEqual(["Main"]);
    expect(tabs.every((t) => !/\d/.test(t.label))).toBe(true);
  });
  it("keeps content icon names and the icon map in step", () => {
    expect(Object.keys(FIRST_NATIONS_ICONS).sort()).toEqual([...moduleIcons].sort());
  });
});

describe("Error boundary", () => {
  it("uses the shared state module and keeps the crisis strip", () => {
    render(<FirstNationsError error={new Error("x")} reset={() => {}} />);
    expect(screen.getByText("This page didn't load")).toBeTruthy();
    expect(screen.getByRole("link", { name: /000/ })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:focused -- --files tests/first-nations-renderer.dom.test.tsx`
Expected: FAIL, missing modules.

- [ ] **Step 3: Write `blocks.tsx`** (server component; no `"use client"`)

```tsx
import { ArrowUpRight, Ban, Check } from "lucide-react";
import { ModeDialRow, ModeFactTiles, ModeGroupedList, ModeRow, ModeUpdatedLine } from "@/components/first-nations/kit";
import { FnModule } from "@/components/first-nations/module-header";
import { NumberSheetFooter, NumberTile } from "@/components/first-nations/number-button";
import { PhraseDeck } from "@/components/first-nations/phrase-deck";
import { StateModule } from "@/components/first-nations/state-module";
import { QuotedLaw, SpokenWords } from "@/components/first-nations/voice";
import { WhereIsHomePanel } from "@/components/first-nations/where-is-home";
import { CopyNoteWording } from "@/components/first-nations/copy-note-wording";
import { formatDayMonthYear } from "@/lib/first-nations/contact-format";
import type { BlockView, ContactView, InnerPageModel, ModuleView } from "@/lib/first-nations/view-model";

const title = "text-base-minus font-medium text-[color:var(--text-heading)]";
const body = "text-sm-minus text-[color:var(--text-muted)]";

function Source({ view }: { view: BlockView }) {
  return (
    <ModeUpdatedLine
      source={view.source.title}
      href={view.source.url}
      checkedAt={formatDayMonthYear(view.block.checkedAt)}
    />
  );
}

function DialRow({ contact }: { contact: ContactView }) {
  return (
    <ModeDialRow
      number={contact.number}
      label={contact.name}
      detail={contact.detail}
      source={contact.source.title}
      checkedAt={formatDayMonthYear(contact.checkedAt)}
      footer={<NumberSheetFooter contact={contact} />}
    />
  );
}

function BlockItem({ view }: { view: BlockView }) {
  const { block } = view;
  switch (block.kind) {
    case "tip":
      return (
        <div className="grid gap-1 px-3 py-2.5">
          <p className={title}>{block.do}</p>
          <p className={body}>{block.why}</p>
          {block.say ? <SpokenWords size="md">{block.say}</SpokenWords> : null}
          <Source view={view} />
        </div>
      );
    case "avoid":
      return (
        <div className="grid gap-1.5 px-3 py-2.5">
          <p className="flex items-baseline gap-1.5 text-sm-minus text-[color:var(--text-muted)]">
            <Ban className="size-icon-xs shrink-0" aria-hidden="true" />
            <span>
              <span className="sr-only">Avoid: </span>
              {block.avoid}
            </span>
          </p>
          <p className="flex items-baseline gap-1.5 text-base-minus text-[color:var(--text-heading)]">
            <Check className="size-icon-xs shrink-0" aria-hidden="true" />
            <span>
              <span className="sr-only">Instead: </span>
              {block.instead}
            </span>
          </p>
          <Source view={view} />
        </div>
      );
    case "contact":
      return view.contact ? <DialRow contact={view.contact} /> : null;
    case "quote":
      return (
        <figure className="grid gap-2 px-3 py-2.5">
          <QuotedLaw>{block.text}</QuotedLaw>
          <figcaption className="text-2xs text-[color:var(--text-muted)]">{block.heading}</figcaption>
        </figure>
      );
    case "steps":
      return (
        <div className="grid gap-1 px-3 py-2.5">
          <p className={title}>{block.heading}</p>
          <ol className="grid gap-2">
            {block.items.map((item, i) => (
              <li key={item.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
                <span className="nums text-sm-minus text-[color:var(--text-muted)]">{i + 1}</span>
                <span className="grid">
                  <span className="text-sm-minus font-medium text-[color:var(--text-heading)]">{item.title}</span>
                  <span className={body}>{item.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <Source view={view} />
        </div>
      );
    case "linkList":
      return (
        <div className="grid">
          {block.items.map((item) => (
            <a key={item.href} href={item.href} className="block">
              <ModeRow
                title={item.label}
                detail={item.detail}
                trailing={<ArrowUpRight className="size-icon-sm" aria-hidden="true" />}
              />
            </a>
          ))}
          <div className="px-3">
            <Source view={view} />
          </div>
        </div>
      );
    case "note":
      return (
        <div className="grid gap-1 px-3 py-2.5">
          <p className={title}>{block.heading}</p>
          <p className={body}>{block.text}</p>
          <Source view={view} />
        </div>
      );
    case "noteWording":
      // Only reaches here once approved: the view-model drops it before that (spec §4).
      return (
        <div className="grid gap-1 px-3 py-2.5">
          <p className={title}>{block.heading}</p>
          <CopyNoteWording template={block.template} />
          <Source view={view} />
        </div>
      );
  }
}

export function ModuleBody({ module, model }: { module: ModuleView; model: InnerPageModel }) {
  const moduleId = `fn-module-${module.id}`;
  switch (module.layout) {
    case "tiles":
      return (
        <ModeFactTiles>
          {module.blocks.flatMap((b) =>
            b.contact ? [<NumberTile key={b.block.id} contact={b.contact} label={b.contact.name} />] : [],
          )}
        </ModeFactTiles>
      );
    case "deck":
      return (
        <PhraseDeck
          id={moduleId}
          phrases={module.blocks.flatMap((b) =>
            b.block.kind === "tip" && b.block.say
              ? [{ say: b.block.say, why: b.block.why, checkedAt: b.block.checkedAt, source: b.source }]
              : [],
          )}
        />
      );
    case "numbered":
      return (
        <div className="grid gap-2">
          {module.blocks.map((b, i) => (
            <div
              key={b.block.id}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)] rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] py-1 pl-2.5 shadow-[var(--e1)]"
            >
              <span className="nums pt-3 text-2xs text-[color:var(--text-muted)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <BlockItem view={b} />
            </div>
          ))}
        </div>
      );
    case "service-contacts":
      return model.serviceContacts.length ? (
        <FnModule id={moduleId} icon={module.icon} title={module.title}>
          <ModeGroupedList>
            {model.serviceContacts.map((c) => (
              <DialRow key={c.id} contact={c} />
            ))}
          </ModeGroupedList>
        </FnModule>
      ) : (
        <StateModule kind="empty" href={model.missingNumberHref ?? undefined} />
      );
    case "where-is-home":
      return <WhereIsHomePanel regions={model.regions} map={model.map} interpreter={model.interpreter} />;
    default:
      return (
        <FnModule id={moduleId} icon={module.icon} title={module.title}>
          <ModeGroupedList>
            {module.blocks.map((b) => (
              <BlockItem key={b.block.id} view={b} />
            ))}
          </ModeGroupedList>
        </FnModule>
      );
  }
}
```

Add the small client `CopyNoteWording` beside it (it copies the approved template and keeps nothing):

```tsx
// src/components/first-nations/copy-note-wording.tsx
"use client";
import { useState } from "react";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

export function CopyNoteWording({ template }: { template: string }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="grid gap-1">
      <p className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 text-sm-minus text-[color:var(--text)]">
        {template}
      </p>
      <button
        type="button"
        className="min-h-12 justify-self-start text-sm-minus text-[color:var(--text-heading)]"
        onClick={() => {
          copyTextToClipboard(template).then(
            () => setNote("Copied. Fill in the blanks yourself."),
            () => setNote("Copying isn't available on this phone"),
          );
        }}
      >
        Copy wording
      </button>
      {note ? (
        <p role="status" className="text-sm-minus text-[color:var(--text-muted)]">
          {note}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Write `bedside-home.tsx` and `inner-page.tsx`**

```tsx
// src/components/first-nations/bedside-home.tsx
import { BeforeYouGoIn } from "@/components/first-nations/before-you-go-in";
import { CrisisStrip } from "@/components/first-nations/crisis";
import { FirstNationsSearch } from "@/components/first-nations/first-nations-search";
import { LiaisonHero } from "@/components/first-nations/liaison-hero";
import { FnModule } from "@/components/first-nations/module-header";
import { OfflineState } from "@/components/first-nations/offline-state";
import { FirstNationsHomeMenu } from "@/components/first-nations/page-menu";
import { Primer } from "@/components/first-nations/primer";
import { SituationModule, SituationProvider, SituationSidePanel } from "@/components/first-nations/situation-module";
import { StateModule } from "@/components/first-nations/state-module";
import { AcknowledgementText } from "@/components/first-nations/voice";
import { WhereIsHomeTile } from "@/components/first-nations/where-is-home";
import type { BedsideModel } from "@/lib/first-nations/view-model";

export const EXAMPLE_LINE = "Example only · wording awaiting approval";

/**
 * DOM order is the phone order from spec §3 on every width, so reading and focus order
 * never jump: tablet places the Situation module in a second column beside the rest,
 * desktop adds the 360 px plan panel on the right.
 */
export function BedsideHomeView({ model }: { model: BedsideModel }) {
  const hospital = model.hospitals[0] ?? null;
  return (
    <SituationProvider situations={model.situations} liaison={hospital?.liaison ?? null}>
      <FirstNationsHomeMenu
        pageTitle="Bedside"
        href="/first-nations"
        reportHref={model.missingNumberHref}
        training={null}
      />
      <Primer />
      <div className="mx-auto grid w-full max-w-[80rem] lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="grid min-w-0 content-start gap-3 px-3 pb-6 pt-3 lg:px-5">
          {model.showExampleLine ? (
            <p data-fn-part="example" className="px-1 text-2xs text-[color:var(--text-muted)] [text-wrap:balance]">
              {EXAMPLE_LINE}
            </p>
          ) : null}
          <OfflineState />
          <div className="grid gap-3 md:grid-cols-[1.1fr_1fr] md:items-start">
            <div className="grid min-w-0 gap-3 md:col-start-1 md:row-start-1">
              {hospital ? (
                <LiaisonHero hospital={hospital} />
              ) : (
                <StateModule kind="not-set-up" href={model.missingNumberHref ?? undefined} />
              )}
              <CrisisStrip />
              <FirstNationsSearch entries={model.search} />
            </div>
            <div className="min-w-0 md:col-start-2 md:row-span-2 md:row-start-1">
              <SituationModule />
            </div>
            <div data-fn-part="tools" className="grid grid-cols-2 gap-2 md:col-start-1 md:row-start-2">
              <BeforeYouGoIn steps={model.beforeYouGoIn} />
              <WhereIsHomeTile regions={model.regions} map={model.map} interpreter={model.interpreter} />
            </div>
          </div>
          {model.topMistakes.length ? (
            <FnModule id="fn-top-mistakes" icon="shield" title="Common mistakes" className="hidden lg:grid">
              <ul className="grid">
                {model.topMistakes.map((m) => (
                  <li
                    key={m.id}
                    className="grid grid-cols-2 gap-3 border-t border-[color:var(--border)] px-3 py-2.5 first:border-t-0"
                  >
                    <span className="text-sm-minus text-[color:var(--text-muted)]">{m.avoid}</span>
                    <span className="text-sm-minus text-[color:var(--text-heading)]">{m.instead}</span>
                  </li>
                ))}
              </ul>
            </FnModule>
          ) : null}
          {model.acknowledgement ? <AcknowledgementText>{model.acknowledgement}</AcknowledgementText> : null}
        </div>
        <SituationSidePanel />
      </div>
    </SituationProvider>
  );
}
```

```tsx
// src/components/first-nations/inner-page.tsx
import { ModuleBody } from "@/components/first-nations/blocks";
import { CrisisBlock, CrisisStrip } from "@/components/first-nations/crisis";
import { EXAMPLE_LINE } from "@/components/first-nations/bedside-home";
import { FirstNationsNavHeader, type FirstNationsTab } from "@/components/first-nations/first-nations-nav-header";
import { OfflineState } from "@/components/first-nations/offline-state";
import { FirstNationsMenuActions } from "@/components/first-nations/page-menu";
import { firstNationsPageHref } from "@/lib/first-nations/content-schema";
import type { InnerPageModel } from "@/lib/first-nations/view-model";

export function toTabs(model: InnerPageModel): FirstNationsTab[] {
  return model.sections.map((s) => ({ id: s.id, label: s.tab, icon: s.modules[0]?.icon ?? "book" }));
}

export function InnerPageView({ model }: { model: InnerPageModel }) {
  return (
    <>
      <FirstNationsNavHeader
        title={model.title}
        sections={toTabs(model)}
        actions={
          <FirstNationsMenuActions
            pageTitle={model.title}
            href={firstNationsPageHref(model.id)}
            reportHref={model.missingNumberHref}
            training={null}
          />
        }
      />
      <div className="mx-auto grid w-full max-w-[48rem] content-start gap-3 px-3 pb-6 pt-3">
        {model.showExampleLine ? <p className="px-1 text-2xs text-[color:var(--text-muted)]">{EXAMPLE_LINE}</p> : null}
        <OfflineState />
        <CrisisStrip />
        {model.sections.map((section) => (
          <section key={section.id} id={section.id} aria-label={section.tab} className="grid scroll-mt-28 gap-3">
            {section.modules.map((m) => (
              <ModuleBody key={m.id} module={m} model={model} />
            ))}
          </section>
        ))}
        <CrisisBlock />
      </div>
    </>
  );
}
```

(Pass `training` from `inputs.content.training` through the view-models if Task 0 found a course; `null` hides the row.)

- [ ] **Step 5: Replace the renderer stub and add the error boundary**

```tsx
// src/components/first-nations/page-renderer.tsx
import { BedsideHomeView } from "@/components/first-nations/bedside-home";
import { InnerPageView } from "@/components/first-nations/inner-page";
import { loadModelInputs } from "@/lib/first-nations/content";
import type { FirstNationsPageId } from "@/lib/first-nations/content-schema";
import { buildBedsideModel, buildInnerPageModel } from "@/lib/first-nations/view-model";

export function FirstNationsPageRenderer({ pageId }: { pageId: FirstNationsPageId }) {
  const inputs = loadModelInputs();
  return pageId === "bedside" ? (
    <BedsideHomeView model={buildBedsideModel(inputs)} />
  ) : (
    <InnerPageView model={buildInnerPageModel(inputs, pageId)} />
  );
}
```

```tsx
// src/app/(search-app)/first-nations/error.tsx — read the error-boundary guide in node_modules/next/dist/docs first
"use client";
import { CrisisStrip } from "@/components/first-nations/crisis";
import { StateModule } from "@/components/first-nations/state-module";

export default function FirstNationsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto grid w-full max-w-[40rem] content-start gap-3 px-3 pt-3">
      <StateModule kind="error" onAction={reset} />
      <CrisisStrip />
    </div>
  );
}
```

(The shell's universal header stays above the boundary. An error boundary replaces the page, including its tabs; the crisis strip is what must stay, and it does.)

- [ ] **Step 6: Run and confirm pass**

Run: `npm run test:focused -- --files tests/first-nations-renderer.dom.test.tsx`
Expected: PASS (9 tests). The island tests are not re-run: Task 6 does not change an island.

- [ ] **Step 7: Commit:** `git add src/components/first-nations/page-renderer.tsx src/components/first-nations/bedside-home.tsx src/components/first-nations/inner-page.tsx src/components/first-nations/blocks.tsx src/components/first-nations/copy-note-wording.tsx "src/app/(search-app)/first-nations/error.tsx" tests/first-nations-renderer.dom.test.tsx && git commit -m "First Nations: Bedside composition, inner pages from titled modules, one state module"`

---

### Task 8: Pocket card and the design guard (Lane C, mid-tier, after Task 6)

**Files:**

- Replace: `src/components/first-nations/pocket-card.tsx` (the Task 5 stub)
- Test: `tests/first-nations-pocket-card.dom.test.tsx`, `tests/first-nations-design.dom.test.tsx`

**Interfaces:**

- Consumes: `loadModelInputs`, `hospitalViews` (Task 2); `formatDayMonthYear` (Task 4); `CrisisStrip` data via `WA_CRISIS_CONTACTS`; `BedsideHomeView` (Task 6).
- Produces: `FirstNationsPocketCard()`, `PocketCardView({ hospitals, printedOn })`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/first-nations-pocket-card.dom.test.tsx
/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PocketCardView } from "@/components/first-nations/pocket-card";
import { hospitalViews } from "@/lib/first-nations/view-model";
import { enabledProfile, testInputs } from "./fixtures/first-nations-content";

describe("PocketCard", () => {
  it("prints crisis numbers and no service numbers while the service layer is off", () => {
    render(<PocketCardView hospitals={hospitalViews(testInputs())} printedOn="2026-09-26" />);
    expect(screen.getByText("13 92 76")).toBeTruthy();
    expect(screen.queryByText(/Royal Perth/)).toBeNull();
    expect(screen.getByText("Printed 26 Sep 2026 · recheck by 25 Dec 2026")).toBeTruthy();
  });
  it("prints liaison and switchboard once the layer is on", () => {
    render(
      <PocketCardView hospitals={hospitalViews(testInputs({ profile: enabledProfile() }))} printedOn="2026-09-26" />,
    );
    expect(screen.getByText("9000 0001")).toBeTruthy();
    expect(screen.getByText("9000 0000")).toBeTruthy();
  });
});
```

```tsx
// tests/first-nations-design.dom.test.tsx
/** @vitest-environment jsdom */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BedsideHomeView } from "@/components/first-nations/bedside-home";
import { bedsideFixture, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
vi.mock("@/components/first-nations/page-menu", () => ({ FirstNationsHomeMenu: () => null }));
vi.mock("@/components/first-nations/primer", () => ({ Primer: () => null, PRIMER_EVENT: "x" }));
resetAfterEach();

const DIR = "src/components/first-nations";
const files = readdirSync(DIR).map((f) => ({ f, text: readFileSync(join(DIR, f), "utf8") }));
const SIZE_CLASSES = ["text-2xs", "text-sm-minus", "text-base-minus", "text-lg-minus", "fn-display-36"];

describe("First Nations design guard (standard v13.1)", () => {
  it("uses nothing heavier than semibold", () => {
    for (const { f, text } of files)
      expect(text, f).not.toMatch(/\bfont-(bold|extrabold|black)\b|font-weight:\s*[7-9]00/);
  });
  it("uses only the scale's size steps", () => {
    for (const { f, text } of files)
      expect(text, f).not.toMatch(/\btext-(3xs|xs|sm|base|lg|xl|[2-9]xl)\b(?!-)|\btext-\[\d/);
  });
  it("keeps the serif accent inside voice.tsx", () => {
    for (const { f, text } of files) if (f !== "voice.tsx") expect(text, f).not.toMatch(/fn-voice/);
  });
  it("uses the mode colour only in the allowed places", () => {
    const allowed = new Set(["module-header.tsx", "day-track.tsx", "voice.tsx", "first-nations-nav-header.tsx"]);
    for (const { f, text } of files) if (!allowed.has(f)) expect(text, f).not.toMatch(/mode-identity|modeIdentity/);
  });
  it("shows at most four type sizes and one filled button on Bedside", () => {
    const { container } = render(<BedsideHomeView model={bedsideFixture().model} />);
    const main = container.querySelector("[data-fn-part='hero']")?.closest(".grid") ?? container;
    const used = new Set(SIZE_CLASSES.filter((c) => main.querySelector(`.${c}`)));
    expect([...used].length, [...used].join(", ")).toBeLessThanOrEqual(4);
    expect(container.querySelectorAll("[data-fn-filled], [data-variant='primary']").length).toBeLessThanOrEqual(1);
  });
});
```

(The size count scopes to the Bedside body, excluding the desktop-only side panel, which is its own column with its own sheet-sized title. Bedside uses 11, 13, 17 and the 36 px figure; nothing on Bedside is set at 15.)

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:focused -- --files tests/first-nations-pocket-card.dom.test.tsx tests/first-nations-design.dom.test.tsx`
Expected: FAIL on the pocket card (the static guards may already pass; if a size or weight guard fails, fix the component, not the test).

- [ ] **Step 3: Implement the pocket card** (badge size, public numbers only, from enabled layers only, reusing the layout of On Call's pocket card route `src/app/(search-app)/on-call/card`):

```tsx
// src/components/first-nations/pocket-card.tsx
import { awstCalendarDay, awstCalendarDayOffset } from "@/lib/caring-contacts/clock";
import { WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";
import { loadModelInputs } from "@/lib/first-nations/content";
import { formatDayMonthYear } from "@/lib/first-nations/contact-format";
import { hospitalViews, type HospitalView } from "@/lib/first-nations/view-model";

const CRISIS = [
  { id: "SYN-CRISIS-CONTACT-007", label: "13YARN" },
  { id: "SYN-CRISIS-CONTACT-001", label: "Emergency" },
] as const;

export function PocketCardView({ hospitals, printedOn }: { hospitals: readonly HospitalView[]; printedOn: string }) {
  const rows = [
    ...hospitals.flatMap((h) => [
      { label: "Aboriginal liaison", number: h.liaison.number },
      { label: "After hours, switchboard", number: h.switchboard.number },
    ]),
    ...CRISIS.flatMap(({ id, label }) => {
      const c = WA_CRISIS_CONTACTS.find((x) => x.id === id);
      return c ? [{ label, number: c.telephoneDisplay }] : [];
    }),
  ];
  return (
    <article className="mx-auto my-6 grid w-[86mm] gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 print:my-0 print:shadow-none">
      <header className="flex items-baseline justify-between gap-2 border-b border-[color:var(--border)] pb-1.5">
        <h1 className="text-sm-minus font-semibold text-[color:var(--text-heading)]">First Nations</h1>
        <span className="text-2xs text-[color:var(--text-muted)]">{hospitals[0]?.name ?? "WA statewide"}</span>
      </header>
      <dl className="grid">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 py-1">
            <dt className="text-sm-minus text-[color:var(--text)]">{r.label}</dt>
            <dd className="nums text-sm-minus font-normal text-[color:var(--text-heading)]">{r.number}</dd>
          </div>
        ))}
      </dl>
      <footer className="text-2xs text-[color:var(--text-muted)]">
        {`Printed ${formatDayMonthYear(printedOn)} · recheck by ${formatDayMonthYear(awstCalendarDayOffset(printedOn, 90))}`}
      </footer>
    </article>
  );
}

export function FirstNationsPocketCard() {
  return <PocketCardView hospitals={hospitalViews(loadModelInputs())} printedOn={awstCalendarDay(new Date())} />;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm run test:focused -- --files tests/first-nations-pocket-card.dom.test.tsx tests/first-nations-design.dom.test.tsx`
Expected: PASS (2 + 5 tests).

- [ ] **Step 5: Commit:** `git add src/components/first-nations/pocket-card.tsx tests/first-nations-pocket-card.dom.test.tsx tests/first-nations-design.dom.test.tsx && git commit -m "First Nations: pocket card and design guard"`

---

### Task 9: Integration, one review, milestone 2 (all lanes committed)

**Files:**

- Regenerate: `docs/site-map.md`, `docs/design-system/ADOPTION.md`, `docs/design-system/adoption-manifest.json`, `data/repo-awareness-snapshot.json`

- [ ] **Step 1: Merge latest main** (sibling new-mode threads change the same pins): `git fetch origin main && git merge origin/main`, then re-derive every count pin from Task 5 against the merged tree.

- [ ] **Step 2: Regenerate**

Run: `npm run sitemap:update && npm run design-system:adoption:update && npm run snapshot:repo-awareness`

- [ ] **Step 3: Fast local proof only**

Run: `npm run typecheck && npm run lint && npm run test:focused -- --files tests/first-nations-*.test.ts tests/first-nations-*.dom.test.tsx tests/app-modes.test.ts tests/mode-secondary-navigation.test.ts tests/ui-copy.test.ts tests/phone-mode-groups.test.ts tests/mode-home-loading-contract.test.ts tests/site-content-registry.test.ts tests/collapsed-rail-active-mode.dom.test.tsx tests/mode-nav-addon-slot.dom.test.tsx tests/design-system-adoption.test.ts`
Expected: all green. Paste the decisive summary lines into the PR body. The browser suite, `ui-smoke.spec.ts`, coverage and the heavy static gates run in CI and are named in the PR body as left to CI.

- [ ] **Step 4: One adversarial review of the final diff (top model).** Use superpowers:requesting-code-review once, on `git diff origin/main...HEAD`, briefed with this plan's Review Focus list and the Global Constraints. Fix what it finds in one commit, re-run only the tests for the files that changed.

- [ ] **Step 5: Format, commit, push once and mark ready**

```bash
npm run format
git add docs/site-map.md docs/design-system/ADOPTION.md docs/design-system/adoption-manifest.json data/repo-awareness-snapshot.json
git diff --name-only | grep -E 'first-nations|^docs/site-map|^docs/design-system|repo-awareness' | xargs -r git add
git commit -m "First Nations: regenerate site map, adoption manifest and repo snapshot"
git push -u origin claude/project-thread-ac8rlk
```

The PR (opened as a draft at milestone 1 with the GitHub MCP tools and the repository's PR template) is marked ready now. Body includes: `RAG impact: no retrieval behaviour change — no retrieval, ranking or ingestion files touched`; "No database change"; "Clinical content: every item credited and marked awaiting service approval; our own wording does not render; the immediate-risk line stays hidden until the owner's recorded OK"; the "Shared files" list from this plan; "Depends on the mode kit PR (already on main)"; the local proof lines; the states the CI phone journeys cover (loaded, loading, empty, offline, error, not set up; signed out equals loaded); "Browser suite and heavy gates left to CI". Send the PR to the merge lineup thread through the coordinator.

---

## Self-review

- **Spec coverage.** §1–2 scope and decisions: Global Constraints; the seven final-design decisions map to Task 5 (olive tokens), Task 7 (switchboard as the large figure after hours; opens on New admission), Task 1 (three phrases, the same six situations statewide), Task 6 (not-set-up state with statewide numbers) and Tasks 1–3 (risk line only after the owner's typed OK). §3 pages and navigation: Task 5 (routes, nav entries in spec order), Task 6 (Bedside order, inner pages from titled modules: Contacts tiles, phrase decks, s 81 with its steps, numbered mistakes, Going home's letter lines), Task 7 (situation chips, phrase stepper, plan sheet). §4 content model and approval: Tasks 1–3. §5 behaviours: hero and day track (Tasks 4, 7), crisis strip in every state (Tasks 5, 6), tap a number (Task 7 via the kit), Before you go in (Task 7), Where is home (Tasks 2, 7), search box (Tasks 4, 7), one state module (Tasks 6, 7), ticks (Task 7), note wording (Task 6), five contact actions (kit sheet plus Task 7 footer), hospital choice (Tasks 5, 7), primer (Task 7), pocket card (Task 8), links in (Task 5). §6 privacy: Task 3 guard, Task 7 privacy test, minimal vCard. §7 design: Global Constraints, Task 5 tokens and font, Task 8 guard. §8 files: File Structure. §9 tests: Tasks 1, 3, 4, 5, 6, 7, 8 and the pins in Task 5. §10 build route: Lanes and Task 9. §11 go-live items are outside this PR (the EMHS layer stays disabled). §12 out of scope: Global Constraints.
- **Mapped differently from the spec's words, on purpose.** The `statusCall` block type is not in the schema: the hero is fixed Bedside composition fed by the service profile's hospital entries, so a content block adds nothing. The per-tip "Awaiting service approval" chip (§4) is the one page-level "Example only · wording awaiting approval" line the final mockups and standard v13 use. The pages sheet's group headings wait for the shared pages sheet to support groups (On Call's rebuild; no other mode edits it). Crisis numbers dial in one tap rather than opening the number sheet, so 000 is never a tap further away. The offline line says the page's numbers still work, not that pages were saved, because offline caching is out of scope. Inner-page tabs follow spec §3, not the mockups' earlier names.
- **Placeholders.** Content text comes from Task 0's checked register rather than being invented here, by design: the owner rule forbids unverified cultural or clinical text. Kit export names are the coordinator's working names, isolated in `kit.ts` and marked to confirm when the kit PR lands. Dataset field names in the one-off map script are the Task 0 dataset's own.
- **Token efficiency.** Each lane brief names its reads; the model tier is on every task heading; the three fixtures are written once under "Shared test fixtures" and every test imports them; the island tests are one file per island plus one privacy file; commit steps are one line each.
- **Types.** `Section`, `Module`, `Block`, `ContactBlock`, `NoteBlock`, `Situation`, `Approval` (`subjectId`), `ServiceProfile`, `Source`, `WaMap`, `FirstNationsPageId`, `ModelInputs`, `ContactView`, `StepView`, `SituationView`, `HospitalView`, `RegionView`, `BedsideModel`, `InnerPageModel`, `CallState`, `Hours`, `SearchEntry` and `FirstNationsTab` are each defined once and reused with the same names. `moduleIcons` and `FIRST_NATIONS_ICONS` are pinned equal by a Task 6 test. Client files import view types with `import type` only.
