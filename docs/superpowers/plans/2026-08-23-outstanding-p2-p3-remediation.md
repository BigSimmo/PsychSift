# Outstanding P2/P3 Remediation Implementation Plan

> **For Codex:** Execute this plan with subagent-driven development. Use one implementer at a time, record BASE before dispatch, require a commit and report, generate an exact review package, and run a separate task-scoped adversarial acceptance pass. Do not perform an opportunistic whole-branch review.

**Goal:** Resolve all 55 supplied P2/P3 ledger rows through permanent repository fixes, evidence-backed closures, or accurate external-gate updates.

**Architecture:** A serialized controller owns the isolated worktree and ledger inbox. Independent tasks are grouped by shared owner and risk, while database and protected RAG changes remain individually reviewable. Evidence is gathered at the narrowest layer that can disprove the fix; hosted/provider/device evidence is never inferred from local checks.

**Tech stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright repository wrappers, Node 24/npm 11, Supabase/Postgres migrations, GitHub Actions, repository ledger-inbox tooling.

**Design:** `docs/superpowers/specs/2026-08-23-outstanding-p2-p3-remediation-design.md`

## Global Constraints

- Work only in the isolated `codex/task-ledger-remediation` worktree unless a task explicitly requires a separate migration/RAG branch.
- Before editing a collision-prone owner, refresh main and open pull-request filenames. Do not duplicate or mutate active pull-request work.
- Never edit `docs/outstanding-issues.md`; use immutable inbox requests and leave reconciliation to a dedicated branch.
- Do not create clinician, provider, production, physical-device, or time-observation evidence.
- Preserve RAG no-read/tenant boundaries, clinical safety checks, fixed thresholds, and divergence pins until the normative test passes.
- Tests must be focused and repository-wrapped. Do not run `npx playwright`, broad baseline suites, or equivalent duplicate gates.
- Every implementation task ends with a clean task commit and an adversarial verdict; any Important finding returns to the same implementer before proceeding.

### Task 1: Close rows already satisfied by current main

**Files:**

- Create: `docs/outstanding-issues-inbox/<uuid>.json` for `#47M1XD`, `#778Q0H`, `#GBBYTA`, `#0YK2S3`, `#XPY409`, `#NPQJKP`, and `#1PN5BM`
- Verify only: `tests/rsc-boundary.test.ts`
- Verify only: `tests/document-search-scope-zero-results.dom.test.tsx`
- Verify only: `tests/caring-contact-product-redesign.dom.test.tsx`
- Verify only: `docs/testing.md`
- Verify only: `tests/rag-guidance-wrapper-quality-gate.test.ts`
- Verify only: `tests/rag-score.test.ts`

**Step 1: Re-read the seven canonical rows and pending inbox requests**

Reject duplicate/conflicting requests, especially the existing `#NPQJKP` update. Record the exact current-main evidence for each outcome.

**Step 2: Run only missing local discriminators**

Run the focused RSC, document-search, Caring Contacts, and RAG tests only where the existing merged receipt is not sufficient. Do not re-run live or hosted checks.

**Step 3: Queue closures**

Use `npm run issues:done -- <id> --outcome "<evidence-rich outcome>"`. For `#NPQJKP`, either retain the already-correct pending request or supersede/cancel it without creating a conflicting mutation.

**Step 4: Validate and commit**

Run `node scripts/ledger-inbox.mjs check` and `npm run check:outstanding-issues`. Commit the immutable requests.

### Task 2: Make Settings and PWA geometry contracts non-vacuous (`#243HCC`, `#2TAQDC`)

**Files:**

- Modify: `src/components/clinical-dashboard/settings-dialog.tsx`
- Modify: `tests/settings-dialog-actions.dom.test.tsx`
- Modify: `tests/pwa-lifecycle.dom.test.tsx`
- Modify: `docs/search-chrome-behaviour.md`
- Create: ledger inbox closure requests after focused proof

**Step 1: Write failing assertions**

Require every desktop settings rail item to expose its real `data-settings-nav-target` and remove the conditional assertion guard. Add a negative static fixture proving a new unguarded `:has(#main-content...)` consumer fails.

**Step 2: Implement the smallest contract**

Emit the rail attribute from `item.id`. Document the streaming-hydration gap and restrict `:has(#main-content...)` to the guarded `.pwa-notice-stack` geometry.

**Step 3: Verify and commit**

Run `npm run test -- tests/settings-dialog-actions.dom.test.tsx tests/pwa-lifecycle.dom.test.tsx`. Queue both closures, validate the inbox, and commit.

### Task 3: Document the process-spawn starvation diagnostic (`#VV83VA`)

**Files:**

- Modify: the existing Windows/workstation diagnostic owner located by the row and codebase index
- Modify: its focused docs/static test if present
- Create: ledger inbox closure request

Add `Measure-Command { node --version }` (and its plain equivalent where the document uses cmd) as a diagnostic only. Explicitly prohibit changing Windows security settings as part of the check. Run the focused docs selector, queue closure, and commit.

### Task 4: Enforce crawler policy for public mockups (`#4XBMMR`)

**Files:**

- Modify: `next.config.ts`
- Modify: `public/mockups/README.md`
- Create or modify: focused Next configuration contract under `tests/`
- Create: ledger inbox closure request

**Step 1: Add a failing configuration contract**

Prove `/mockups/:path*` receives `X-Robots-Tag: noindex, nofollow`, unrelated public assets do not inherit it, and the production app-route 404 policy is unchanged.

**Step 2: Add the header and correct the README**

Extend `headers()` using the installed Next 16 contract. State that assets remain publicly retrievable but are excluded from indexing; do not claim `robots.txt` provides the protection.

**Step 3: Verify and commit**

Run the focused contract and typecheck only if the config import/type surface requires it. Queue closure and commit.

### Task 5: Make reachability scans plan- and history-aware (`#800E5M`)

**Files:**

- Modify: `scripts/check-dead-code-candidate.mjs` and/or its actual reachability owner
- Modify: focused tests for the cleanup candidate tool
- Create: ledger inbox closure request

Add explicit classifications for symbols/files referenced by unfinished executable plans and for repositories whose history is too shallow to establish deletion safety. Return `uncertain`, not `dead`, for either condition. Pin complete-plan, unfinished-plan, full-history, and shallow-history fixtures. Run only the focused tool tests, queue closure, and commit.

### Task 6: Make hosted migration-role failures self-diagnosing (`#BJ80DB`)

**Files:**

- Modify: the hosted migration-role guard and its focused test located from the workflow/script owner
- Create: ledger inbox closure request or evidence update

On failure, print the exact commit SHA, base/head relationship, OS/runtime, migration range, and whether history is shallow. Preserve the guard verdict. Reproduce with synthetic failing fixtures, run its focused test, queue the correct closure/update, and commit.

### Task 7: Expose bundle-baseline age and drift (`#QSHHGK`)

**Files:**

- Modify: bundle-budget baseline/check script and baseline metadata owner
- Modify: focused bundle-budget tests
- Modify: owning workflow only if an existing scheduled workflow can call the read-only check without adding a second build
- Create: ledger inbox closure request

Record baseline generation time/source, warn before the repository's chosen age limit, and fail only on the existing bundle drift contract. Prefer a baseline-age signal over a redundant scheduled build. Test fresh, warning-age, missing-metadata, and drift cases; commit after the focused check.

### Task 8: Fail closed before worktree cleanup (`#XCAX01`, `#6GW95D`)

**Files:**

- Modify: `scripts/clean-worktree.mjs`
- Modify: `tests/clean-worktree.test.ts`
- Add or modify: report-only multi-root inventory owner under `scripts/`
- Create: ledger inbox closure/update requests

Default to report-only. Before removal, prove the exact path is under an allowed root, not a reparse/symlink escape, registered, not current/main, clean, pushed/merged, unlocked, and has no known live process. Unknown liveness is a refusal. Multi-root inventory must never remove. Verify with synthetic directories only; do not exercise real cleanup. Commit the tooling and evidence-rich ledger mutations.

### Task 9: Reproduce the Forms disclosure journey (`#5DYBQQ`)

**Files:**

- Verify/modify: `tests/ui-forms-section-nav.spec.ts`
- Modify only if reproduced: `src/components/forms/form-detail-page.tsx`
- Create: ledger inbox closure/update request

Run `npm run ensure`, confirm project identity, then the one repository-wrapped Chromium journey. If it passes twice on unchanged current main, classify the old isolated failure with exact evidence; if it reproduces, add a focused regression before changing disclosure rendering. Do not quarantine the test.

### Task 10: Add genuine mobile-WebKit and standalone-emulation projects (`#71NT23`)

**Files:**

- Modify: `playwright.config.ts`
- Modify: `tests/playwright-project-isolation.test.ts`
- Modify: phone/PWA selector owner only as required
- Create: ledger inbox implementation update

First wait for or adopt any open pull request touching `playwright.config.ts`. Add a mobile WebKit device project and a dedicated standalone emulation project using the existing PWA fixture strategy. Run the config contract and `npm run verify:phone-chrome -- --dry-run`; run only selected focused journeys. Record that physical iPhone acceptance remains open under `#S4K1GA`.

### Task 11: Close or fix measured layout rows (`#308`, `#K9XD5N`, `#JVYQEM`)

**Files:**

- Verify/modify: `src/components/mode-home-template.tsx`
- Verify/modify: `src/components/master-search-header.tsx`
- Modify: `src/components/ClinicalDashboard.tsx`
- Modify: `src/components/clinical-dashboard/dashboard-notices.tsx`
- Modify: owning CSS and focused DOM/route tests
- Create: ledger inbox requests

Remeasure the canonical desktop document-search scenario before editing `#308`. For `#K9XD5N`, keep a stable outer frame or exact reserve through online/offline swaps. For `#JVYQEM`, preserve the proven phone reserve and replace the wide magic constant with measured/published owner geometry. Use focused DOM tests and the exact attribution journey; never raise the CLS budget.

### Task 12: Resolve the three residual control groups (`#321`)

**Files:**

- Modify: differential comparison control owner
- Modify: `src/components/DocumentViewer.tsx`
- Modify: `src/components/search-pins-menu.tsx`
- Modify: one focused DOM test per group
- Create: ledger inbox closure request

Implement three separately committed substeps: rewrite-owned differential controls, persistent-reason versus transient-loading classification in DocumentViewer, and stated-reason behavior at the pin limit. Preserve the already-fixed image filmstrip. Run only each owner's DOM test before its subcommit.

### Task 13: Adopt the authoritative Linux DocumentViewer baseline (`#61TZJA`)

**Files:**

- Modify: `tests/__screenshots__/linux/document-viewer.png`
- Modify: provenance file produced by `scripts/adopt-visual-baselines.mjs`
- Create: ledger inbox closure/update request

Download the authoritative post-fix Linux artifact from the exact successful GitHub run, use `npm run design-system:baselines:adopt -- <artifact args>`, and run `npm run test -- tests/adopt-visual-baselines.test.ts`. Never generate or adopt the image from Windows.

### Task 14: Unify mode-home copy, headings, and Favourites structure (`#97VQK5`, `#V0EDR4`)

**Files:**

- Modify: `src/lib/ui-copy.ts`
- Modify: relevant mode-home call sites and heading ownership tests
- Modify: `src/components/favourites-hub.tsx`
- Modify: `src/components/favourites-command-library-page.tsx`
- Modify: focused Favourites and route-ownership tests
- Create: ledger inbox closure requests

Inventory current conventions, choose the dominant punctuation rule, and keep exactly one route-level `h1`. Use the shared ModeHome treatment for both Favourites entry doors unless route semantics prove the command-library treatment is the true shared owner. Verify the two routes together and update only authoritative visual evidence.

### Task 15: Add clinician-owned Therapy sign-off tooling (`#SBKXZ7`)

**Files:**

- Modify: `src/components/therapy-compass/data/types.ts`
- Modify: `scripts/build-therapies-index.mjs`
- Add: central Therapy review validation module
- Add: clinician-input CLI and focused unit tests
- Create: ledger inbox implementation update

Add reviewer identity/time fields. A `reviewed` record must have all seven explicit checks plus valid attribution; `needs-review` must remain valid without invented completion. The CLI records supplied decisions and never auto-ticks clinical fields. Test valid, incomplete, missing-attribution, and needs-review cases, then run `npm run check:therapy-data-index`. Keep the row open only for actual clinician attestations.

### Task 16: Move test pins to reachable Therapy/answer paths (`#2DQXD8`)

**Files:**

- Modify: `tests/rendered-text-formatting.test.ts`
- Modify: `tests/therapy-review-regressions.test.ts`
- Modify: `src/components/clinical-dashboard/evidence-panels.tsx`
- Modify: `src/components/therapy-compass/therapy-card.tsx`
- Create: ledger inbox closure request

First pin formatting and review-status behavior through reachable renderers. Then delete `RenderModelSourceList`, `VerificationWorkspace`, and `TherapyListItem` only after exact caller scans prove they are dead. Run the two focused tests and `npm run check:dead-code-candidate -- --files <changed owners>`.

### Task 17: Consolidate the remaining Therapy UI kit (`#NEBJAM`, `#VTEW3W`)

**Files:**

- Modify: `src/components/therapy-compass/ui.tsx`
- Modify: `src/components/therapy-compass/controls.ts`
- Modify: Therapy card/screen call sites and focused tests
- Create: ledger inbox closure requests

Move review status into a suitable shared badge while preserving explicit clinical wording/iconography. Replace forwarding wrappers with shared `Chip`, `LoadingPanel`, `EmptyState`, and semantic controls. Introduce a shared row-button recipe only for list-row semantics; do not force all 13 controls into one Button variant. Prove zero obsolete consumers and run affected Therapy DOM/navigation tests.

### Task 18: Remove the unused Therapy home asset (`#V15EAS`)

**Files:**

- Modify: `scripts/build-therapies-index.mjs`
- Modify: generated asset manifest/bindings and `src/components/therapy-compass/data/use-therapy-data.ts`
- Modify: `next.config.ts`
- Modify: `tests/therapy-compass-mode-wiring.test.ts`
- Regenerate: Therapy generated assets
- Create: ledger inbox closure request

Remove the `home` asset kind, alias, loader union, and byte-identical generated payload. Preserve one-generation retention for full/index. Run `npm run check:therapy-data-index` and the focused wiring test; inspect generated diffs before committing.

### Task 19: Add harder Docling table fixtures without extractor changes (`#BSBE9B`)

**Files:**

- Add: unruled, merged-cell, and rotated-header source fixtures in the existing Docling lab fixture owner
- Regenerate: Docling lab lock/manifest
- Modify: focused fixture contract tests only
- Create: ledger inbox closure request

Generate the fixtures deterministically, run `npm run generate:docling-lab-lock`, then `node scripts/run-vitest.mjs run tests/docling-lab-contract.test.ts` (replacing the historical `check:docling-lab` script alias). Assert the extractor implementation has no diff. Commit fixture, manifest, tests, and closure.

### Task 20: Split client-specific repository instructions safely (`#8A00R7`)

**Files:**

- Modify: root `AGENTS.md`
- Add: narrower applicable `AGENTS.md` files or referenced policy docs
- Modify: all repository tests that pin instruction ownership
- Create: ledger inbox closure request

Inventory every assertion tied to the current block before moving text. Relocate client-specific context to the narrowest owner while preserving identical binding coverage for Cloud, Windows, hooks, and process-hardening gates. Update the three known contract assertions atomically and run their focused tests. Do not weaken or duplicate policy.

### Task 21: Establish one automated-review owner and preserve coverage (`#JZM7RM`, `#KZJD4Q`)

**Files:**

- Modify: review-coverage decision document
- Modify: GitHub workflow/policy owners and focused contract tests
- External: app-level watcher configuration only after exact identity is established
- Create: ledger inbox closure/update requests

Adopt or disposition existing review-policy branch work before editing. Keep one responder, throttle/disable the competing app watcher, skip CodeRabbit only for proven docs-only scope, and bundle bookkeeping-only mutations through the existing policy rather than a rejected same-files/open-PR gate. Verify workflow contracts; record external configuration evidence separately.

### Task 22: Delete confirmed dead protected exports with no behavior change (`#45V4Y7`)

**Files:**

- Modify: `src/lib/rag/rag.ts`
- Modify: `src/lib/openai.ts`
- Modify: `src/lib/clinical-search.ts`
- Modify: stale documentation references
- Create: ledger inbox closure request

After open-PR collisions clear, re-run exact caller searches, delete only `answerQuestion`, `embedText`, and `clinicalRankScore`, and update stale docs to the live APIs. Run typecheck and knip/dead-code checks. Record `RAG impact: no retrieval behavior change`; no live canary is required for a compile-proven unused deletion.

### Task 23: Enforce object-shaped document metadata (`#S19JRT`)

**Files:**

- Add: timestamped Supabase migration
- Modify: `supabase/schema.sql`
- Modify: `tests/supabase-schema.test.ts`
- Modify: `tests/rag-retrieval-row-contract.test.ts`
- Create: ledger inbox implementation update

Fail safely if existing non-object rows exist, add and validate a named `CHECK (jsonb_typeof(metadata) = 'object')`, and update the canonical schema. Run migration replay, schema, row-contract, role, and grant checks. Commit code readiness separately; do not claim deployment until a production window applies and re-reads it.

### Task 24: Extend retrieval EXPLAIN tooling to v2 (`#8VAY97`)

**Files:**

- Add: timestamped Supabase migration for the approved explain RPC
- Modify: `supabase/schema.sql`
- Modify: `scripts/profile-retrieval-rpcs.ts`
- Modify: `tests/profile-retrieval-rpcs.test.ts`
- Modify: `tests/supabase-schema.test.ts`
- Create: ledger inbox implementation update

Allow `match_document_chunks_text_v2` and `match_document_index_units_hybrid_v2`. Require a caller-supplied embedding for hybrid analysis; never substitute a zero vector or cumulative index statistics. Run focused schema/profiler/replay tests. Capture analysed production baselines only in the authorized live DB window.

### Task 25: Strip citations from unsupported abstentions (`#C2D9JF`)

**Files:**

- Modify: `src/lib/rag/rag-extractive-answer.ts`
- Modify: `tests/rag-adversarial-harness.test.ts`
- Modify: focused final-quality/fallback tests
- Create: ledger inbox implementation update

Add the normative failing case first. On `finalQualityFailure`, clear claim-bearing citations, quote cards, best source, and equivalent cited panels, matching the existing gap-refusal path. Remove only this divergence after the fixture passes. Run the focused harness/fallback checks and offline RAG selectors; closure waits for one baseline/post canary pair.

### Task 26: Refuse absent explicit chunk identifiers (`#NTAV3D`)

**Files:**

- Modify: RAG routing owner containing `chooseAnswerRoute`
- Modify: `tests/rag-routing.test.ts`
- Modify: `tests/rag-adversarial-harness.test.ts`
- Create: ledger inbox implementation update

Detect an explicitly requested chunk ID and refuse if it is absent from the already retrieved result IDs. Do not perform a secondary lookup. Pin present and missing-ID cases, remove only the matching divergence, run focused routing/harness/offline checks, and leave closure pending the canary pair.

### Task 27: Restrict citations to claim-bearing matched documents (`#VXB8XA`)

**Files:**

- Modify: exact document-match answer/citation owner found by the normative fixture
- Modify: focused RAG unit and adversarial fixtures
- Create: ledger inbox implementation update

Separate inventory matches from answer-support citations. Keep document names available as clearly labelled inventory data, but emit citations only for documents supporting an answer claim. Preserve tenant/no-read behavior. Run focused unit/harness/offline checks and leave closure pending the canary pair.

### Task 28: Keep pathway synthesis out of title-list/extractive routes (`#S4R2W3`)

**Files:**

- Modify: `src/lib/rag/rag-routing.ts`
- Modify: `tests/rag-routing.test.ts`
- Modify: exact offline/adversarial fixtures
- Create: ledger inbox implementation update

Exclude `clinicalPathwaySynthesisPattern` from the document-lookup and medication-extractive admissions while preserving true “which documents support…” queries. Add the duress and IM-pathway regressions, run focused routing and offline selectors, and leave closure pending the canary pair.

### Task 29: Execute current external evidence gates

**Rows:** `#50QRCF`, `#KFRC3H`, `#TYZK23`, `#TF6TPJ`, `#72G3XZ`, `#VKH7N1`, `#164Z0H`, `#RZQQBT`, `#6SMMB4`, `#S4K1GA`, `#HVTYAT`, `#9X40BT`, `#1VFSYF`, `#2AB2NJ`

Use read-only GitHub evidence for hosted CI/usage where current runs exist. Use the exact production provider/project for explicitly authorized read-only controls. Run elevated/device/lifecycle checks only where this environment actually exposes the required surface. Queue closure when the authoritative gate passes; otherwise queue or retain a precise update naming the missing surface, trigger, owner, and evidence already completed. Never substitute local emulation.

### Task 30: Deploy and accept database/RAG-ready batches

Apply database migrations only through their approved production path, re-read drift, and capture EXPLAIN baselines. For each protected RAG behavior, use exactly one approved baseline/post canary pair after the change is hosted. Queue closure only when local, hosted, and clinical acceptance components all pass; otherwise preserve the implementation-ready state and exact remaining gate.

### Task 31: Final ledger reconciliation audit

**Files:**

- Verify: all new `docs/outstanding-issues-inbox/*.json`
- Verify: `docs/outstanding-issues.md` remains untouched on this feature branch
- Update: programme completion record if needed

Refresh `origin/main`, re-run `node scripts/issues-report.mjs --json`, and account for every one of the 55 supplied IDs. Run `node scripts/ledger-inbox.mjs check`, `npm run check:outstanding-issues`, focused changed-domain checks not already covered by receipts, and `npm run format` before any normal push. Inspect the exact diff for scope, secrets, generated noise, and external-evidence claims. Publish/reconcile only through the repository's dedicated workflows and report each row as closed, implementation-ready/external-gated, or trigger-deferred.
