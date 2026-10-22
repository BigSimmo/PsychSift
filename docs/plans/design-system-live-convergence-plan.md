# Design-system live convergence programme

**Status:** historical programme plan, superseded as an execution queue.

_Updated 2026-10-21 — separated original plan from current debt and acceptance; Documentation owns._

> Use the [current design-system front door](../design-system/README.md) and
> [task lifecycle](../task-receipts.md) to scope new work. The
> [committed baseline](../../scripts/design-system-contract-baseline.json) records current
> debt; it differs from the starting counts below and still contains nonzero metrics.
> [GATES](../design-system/GATES.md) and [ADOPTION](../design-system/ADOPTION.md) govern
> enforcement and visual-proof disposition. Human-approved visual baselines, hosted
> provenance and local/device acceptance require their own evidence; this plan does not
> establish those outcomes. Its original six-PR sequence and counts are retained as history,
> not instructions to restart those tranches or a claim that every acceptance item is complete.

**Prepared:** 22 August 2026

**Starting point:** `work` at `4c06617a4bac40dbafb9c07dc7468ea62adb559c`

**Objective:** bring the production interface into measurable agreement with the Clinical KB design system without weakening clinical-state semantics, accessibility, privacy, source provenance, or conservative failure behaviour.

## 1. Outcome and non-goals

The programme is complete only when the executable design-system baseline is reduced deliberately, the corresponding browser behaviour is proved, and every accepted visual baseline has honest human provenance.

This is **not** a visual rewrite. It must not:

- change clinical meaning, search/retrieval, answer generation, permissions, tenancy, storage, or provider configuration;
- add decorative clinical-state colours;
- hide publisher, review, extraction, validation, or source-status information;
- trade phone accessibility for desktop density;
- self-approve screenshots produced by the implementing agent;
- combine all debt into one unreviewable pull request;
- call Supabase, OpenAI, Railway, Figma, hosted CI, or production services without a separate explicit authorization.

## 2. Sources of truth and enabled workflows

Apply sources in this order:

1. `AGENTS.md` and repository safety rules.
2. `src/app/ckb-v2-tokens.css`, `src/app/globals.css`, and committed contract tests.
3. `docs/design-system/SPEC.md`, `TOKENS.md`, `COMPONENTS.md`, `GATES.md`, and `ADOPTION.md`.
4. `scripts/design-system-contract-baseline.json` for the current measured debt.

Use the smallest applicable skills rather than treating “all skills” as permission to run unrelated workflows:

| Skill         | When it applies                                                                    | Required output                                                              |
| ------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `plan`        | Before every tranche                                                               | Path-scoped flightplan, risk class, verification ladder, approval boundary   |
| `ui`          | Every production UI change                                                         | Verified local URL, responsive/keyboard/focus/motion/forced-colour evidence  |
| `clinical`    | Status, answer, source, dose, trust, missing-value, or degraded-state changes      | Conservative-failure and clinical-governance evidence                        |
| `test`        | Every behavioural tranche                                                          | Smallest deterministic regression first, broader gate only for distinct risk |
| `review`      | Before handoff of each tranche                                                     | Severity-ranked final-diff review and immutable review record                |
| `privacy`     | Only when privacy copy, logging, auth state, or user data exposure changes         | Data-flow and client-exposure proof                                          |
| `sources`     | Only when provenance/status/source rendering changes                               | Source-label and governance proof                                            |
| `performance` | When density, motion, shared chrome, or bundle-owning components change materially | Layout/bundle/interaction evidence scoped to the change                      |
| `handover`    | At the end of every tranche                                                        | Clean-state, checks, risks, rollback, and exact next-action record           |

Do not invoke database, migration, ingestion, RAG, dependency, deploy, recovery, or provider workflows unless a tranche actually crosses that boundary.

## 3. Current measured gap

Treat `scripts/design-system-contract-baseline.json` as executable truth and re-read it at the start of every tranche. The starting debt is:

- 3 colour-only status indicators and 1 status-coloured numeral;
- 33 sub-floor interactive minimum-height declarations;
- 18 border/ring edge conflicts and 2 one-pixel shadow spreads;
- 41 hardcoded CSS motion durations and 11 layout-transition exceptions;
- 89 legacy shadow aliases;
- 52 padding, 20 radius, 25 gap, 74 margin, and 3 line-height literals;
- 8 raw CSS z-index declarations;
- 6 canonical visual baselines, with human-provenance ambiguity still requiring disposition.

Before editing, save the exact baseline counts in the tranche evidence. After editing, require both the global count and the intended per-path count to fall. A count moving to another file is not progress.

## 4. Delivery architecture

Use six bounded pull requests. Each PR must be independently safe to merge and independently revertible.

### PR 1 — clinical status semantics and baseline provenance

**Execution status (22 Aug 2026):** the production status-semantics work is implemented and the
two contract metrics are pinned at zero. Canonical screenshot provenance remains open: the current
schema requires a genuinely human-approved disposition, which an automated Cloud session cannot
truthfully supply. Do not weaken that gate; complete it through the documented human baseline-review
workflow.

**Goal:** remove all colour-only clinical/status meaning and correct screenshot approval truth.

**Primary files**

- `src/components/calculators/calculator-ui.tsx`
- `src/components/ui-primitives.tsx`
- `src/components/clinical-dashboard/visual-evidence.tsx`
- the smallest directly affected DOM/browser tests
- `tests/__screenshots__/linux/provenance.json` only after a real reviewer disposition
- `scripts/design-system-contract-baseline.json` via the repository’s normal contract update path

**Implementation rules**

1. Classify each flagged use as clinical state, category identity, decoration, or false positive.
2. For real state, add persistent text plus a non-colour channel such as icon shape, border style, or pattern.
3. Do not use `aria-label` as the only repair when sighted users would still see colour alone.
4. Do not recolour numerals with warning/success roles; put status beside the value.
5. If baseline provenance is not genuinely human-approved, mark it pending. If reviewed, record the actual human reviewer and review time.

**Adversarial proof**

- default, dark, forced-colours, monochrome screenshot, print, and screen-reader name;
- state remains distinguishable after all authored colours are removed;
- no false “safe/current” impression when data is missing or stale.

**Exit criteria**

- `colourOnlyStatusIndicators = 0`;
- `statusColouredNumerals = 0`;
- provenance makes no contradictory human/automated claim;
- no clinical-state wording or source governance is weakened.

### PR 2 — interaction geometry

**Goal:** retire the 33 existing sub-floor interactive declarations without bloating static content.

**Order**

1. Document management: `DocumentManagerPanel.tsx`, `document-admin.tsx`, `DocumentTagCloud.tsx`.
2. Calculators: bedside sheet, calculator UI, clinical console, directory grid.
3. Settings, favourites, forms, answer content, then Chip.

**Implementation rules**

- Prefer a 48px hit area around compact visible content where density matters.
- Preserve table/row alignment and prevent hit-area overlap.
- Static badges and pills must not inherit interactive tap sizing.
- Do not lower the canonical tap token or add per-component replacement knobs.
- Treat keyboard focus area and pointer hit area as the same owned control.

**Adversarial proof**

- 320, 390, 639, 768, 1440, and 1920px;
- coarse pointer and fine pointer;
- keyboard-only focus order;
- 200% and 400% zoom;
- long labels, disabled, busy, error, and empty states;
- no horizontal overflow or overlapping adjacent controls.

**Exit criteria**

- `interactiveTapFloorDeclarations = 0`;
- deterministic rendered audit reports every applicable target at or above the token floor;
- no phone or desktop density regression accepted without explicit product review.

### PR 3 — edge ownership and elevation

**Goal:** make each surface own exactly one edge treatment and converge elevation.

**Primary order**

1. `master-search-header.tsx`
2. `DocumentTagCloud.tsx`
3. formulation/specifier builders and compare pages
4. shared navigation and primitives
5. the two spread shadows in `globals.css`

**Implementation rules**

- Separation: border **or** elevation.
- Keyboard focus: outline, not a permanent companion ring.
- No shadow may carry a 1px spread that recreates a border.
- A child must not look more elevated than the overlay or card that contains it.
- Migrate shadow aliases only after identifying their semantic role: inset, card, floating control, overlay, or modal.

**Exit criteria**

- `edgeOwnershipConflicts = 0`;
- `onePixelShadowSpreads = 0`;
- a documented reduction target for `legacyShadowAliases`, ideally zero for all files touched by this tranche;
- normal and forced-colour focus remains visible.

### PR 4 — motion, spacing, and z ownership

**Goal:** remove systemic literal drift without manufacturing unnecessary tokens.

**Implementation rules**

- Cluster repeated values before creating a token. Require a semantic role and at least two genuine consumers.
- Convert repeated durations/easings to existing motion tokens first.
- Keep only layout transitions that communicate a necessary state change; use transform/opacity for decorative motion.
- Preserve reduced-motion behaviour and eliminate animation that blocks interaction.
- Replace raw z-index declarations with named layer rungs, beginning with dialogs, sheets, sidebars, toast, and phone composer layers.

**Exit criteria**

- hardcoded duration and raw z-index counts decrease to zero or to an explicitly justified, per-path exception set;
- layout-transition exceptions contain only reviewed functional transitions;
- touched spacing/radius paths reach zero literal debt;
- no cumulative layout shift, scroll-ownership, or overlay-order regression.

### PR 5 — deterministic adversarial design fixtures

**Goal:** prove dangerous states, not only polished defaults.

Add deterministic fixture coverage for:

- grounded answer;
- stale evidence;
- partial retrieval;
- ungrounded/source-only answer;
- missing numeric value and unverified numeric value;
- loading, slow loading, empty, error, retry, disabled, and pending states;
- longest realistic page, dialog, medicine, source, and review-warning labels;
- source publisher/version/review/extraction/approver block;
- print and 400% zoom.

The fixture must use offline deterministic data. It must not call OpenAI, Supabase, or live APIs. Add focused browser assertions for semantic state, then screenshots only where pixels are the actual contract.

**Exit criteria**

- every clinically dangerous state has text and structural differentiation from the confident state;
- default, dark, forced-colours, reduced-motion, print, phone, and desktop coverage is explicit;
- failures identify a named owner rather than producing an undiagnosable full-page pixel diff.

### PR 6 — live density and workflow polish

**Goal:** improve scan efficiency only after safety and system debt are controlled.

Candidate changes requiring product judgment:

- compact desktop Services results while preserving 48px actions and status wording;
- one restrained shared-home resume region (recent work, recent sources, or source-health summary);
- explicit loading language alongside skeletons;
- consistent permanent source-provenance blocks.

Prototype or measure alternatives before production edits. Do not fill whitespace for its own sake. This PR may be split if Services, shared home, and provenance cross different owners.

## 5. Verification ladder per tranche

Run commands sequentially; do not stack broad gates when a focused check already proves the same failure class.

### Before editing

```bash
git status --short --branch
git worktree list
npm run workflow:flightplan -- --write-evidence --files <comma-separated-paths>
npm run workflow:design-sweep -- --write-evidence
npm run ensure
```

Use the printed URL and require `/api/local-project-id` to identify Clinical KB before browser work.

### During iteration

```bash
npm run check:design-system-contract
npm test -- --run <focused-test-files>
node scripts/run-playwright.mjs <focused-spec> --project=chromium --grep <focused-case>
```

Add `npm run workflow:clinical-proof -- --write-evidence --files <paths>` for PR 1, PR 5, and any source/trust/degraded-output change.

### Handoff gate

```bash
npm run format
npm run verify:pr-local -- --dry-run --files <comma-separated-paths>
npm run verify:pr-local
npm run workflow:lifecycle -- --phase handoff --write-evidence
```

Use `npm run verify:ui` only when shared UI foundations changed or the PR-local selector requires it. Use `npm run verify:phone-chrome` first for phone-chrome owners. Do not run release/provider gates without explicit approval.

## 6. Cloud/local boundary

### Safe in offline Cloud

- source, CSS, test, fixture, and documentation edits;
- deterministic demo-mode browser checks;
- design-system, adoption, design-sync, lint, type, unit, and local production-build checks;
- screenshot candidate generation;
- feature-branch commits only; branch or pull-request publication requires separate explicit user authorization.

### Local operator or human required

- explicit human visual-baseline approval;
- physical Safari and installed-PWA acceptance;
- production-connected health or authenticated tests;
- any Figma, Supabase, OpenAI, Railway, Sentry, or hosted-CI action not separately authorized;
- final product choice between density/resume-region alternatives.

Never copy provider credentials into Cloud. A `make_pr` metadata response is not proof of publication; verify the remote branch and PR URL through native controls.

## 7. Rollback and change isolation

- One coherent commit or small commit stack per PR; never mix tranches.
- Do not update baseline counts until the associated code and proof are in the same commit.
- Revert a tranche as a unit if clinical meaning, source status, focus, or responsive geometry regresses.
- Screenshot refreshes must be separate from behavioural fixes unless the pixel change is the intended, reviewed output.
- Never weaken a ratchet to make a regression pass. If a current count is wrong, repair the analyzer or evidence before changing the ceiling.

## 8. Local handoff packet

At the end of each Cloud tranche, leave the local operator this exact packet:

### Identity

- repository path and project ID;
- branch name, upstream, base ref, full HEAD SHA, and commit list;
- clean/dirty status and every untracked artifact;
- PR URL if genuinely published, otherwise state “not published”.

### Change inventory

- objective and non-goals;
- files changed grouped by product owner;
- before/after executable debt counts, globally and per path;
- clinical/state semantics changed or explicitly unchanged;
- screenshots added/changed, with provenance and whether human approval is pending.

### Verification evidence

- exact command, exit code, decisive output line, and evidence path;
- routes, viewports, states, keyboard interactions, motion preference, forced colours, zoom, and print covered;
- checks deliberately not run and the failure class left open;
- provider-backed checks skipped and the authorization needed.

### Local acceptance sequence

```bash
git status --short --branch
git show --stat --oneline HEAD
npm run check:installed-lock-parity
npm run check:design-system-contract
npm run ensure
```

Then, against the printed verified URL:

1. confirm `/api/local-project-id`;
2. inspect the changed route at 320, 390, 639, 768, 1440, and 1920px;
3. check keyboard order and visible focus;
4. check reduced motion and forced colours;
5. inspect loading, empty, error, success, disabled, and pending states relevant to the tranche;
6. inspect 200%/400% zoom and print where clinical content is involved;
7. perform physical Safari/PWA checks when phone chrome, safe areas, keyboard, or installation behaviour changed;
8. human-review screenshot candidates and update provenance honestly;
9. record pass/fail and the exact follow-up owner.

### Stop conditions

Stop and return the tranche rather than approving it if:

- a clinical state becomes colour-only or less explicit;
- a dose, unit, source status, warning, or missing value truncates or changes meaning;
- an interactive target overlaps another control or falls below the tap floor;
- keyboard focus is lost, trapped, or invisible;
- a phone or zoom viewport gains horizontal overflow;
- a degraded/partial state looks equivalent to a confident state;
- screenshot provenance claims human approval that did not occur;
- a baseline count falls only because the violation moved or the analyzer weakened.

## 9. Completion definition

The programme is complete when:

- colour-only indicators, status-coloured numerals, sub-floor targets, edge conflicts, and shadow spreads are zero;
- motion, z-index, shadow-alias, and spacing debt are zero or documented as narrow functional exceptions with deterministic proofs;
- dangerous answer/source states have offline semantic and visual fixtures;
- shared focus, contrast, forced-colour, reduced-motion, zoom, and print contracts are deterministic;
- baseline provenance is honestly human-approved;
- Cloud evidence and the local/device acceptance packet are both complete;
- every tranche is independently reviewed, committed, published, and revertible;
- no provider, production, privacy, source-governance, or clinical-safety boundary was weakened.

## 10. First action

Start PR 1 only. Re-read the four flagged status sites, classify their meaning, and produce a path-scoped flightplan before editing. Do not begin tap-target or visual-density work in the same branch.
