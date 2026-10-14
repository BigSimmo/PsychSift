# External Skill Precedence and Evidence

<!-- BEGIN:external-skill-precedence -->

# External skill precedence

User-global skills and output-style plugins are installed outside this repo and know nothing about
its contracts. Where they conflict with repo docs or committed tests, the repo wins. This section
is the tie-breaker for that case only: it scopes external, generic guidance and does not override
system, developer, user, security, or compliance requirements, which remain higher priority.

- **Repo contracts outrank generic rules.** The Front-End Checklist skill corpus (~390 user-global
  skills: `alt-text`, `touch-targets`, `focus-styles`, `reduced-motion`, `color-contrast`, and so
  on) is generic guidance. On any conflict these win: `docs/wiring-conventions.md`,
  `docs/search-chrome-behaviour.md`, `docs/rag-behaviour/`, the `@theme` tokens in
  `src/app/globals.css`, and any committed test.
- **Never regress a fixed flake to satisfy a generic rule.** Known collision: generic touch-target
  guidance often teaches the WCAG 2.1/2.2 AAA-level "enhanced" criterion (2.5.5: 44×44 px, which is
  `min-h-11` in Tailwind), though the AA-level minimum is 24×24 px (2.5.8). This repo's production
  tap targets use `min-h-12` (48 px) — exceeding both the AA minimum and the AAA enhanced criterion —
  because `min-h-11` (44 px) hit a sub-pixel rounding flake in `ui-smoke`. Design-scratch mockups
  (`*-mockups.tsx`) still carry `min-h-11` and are gate-exempt. Do not "fix" production back to
  `min-h-11` to satisfy the generic rule.
- **Unlayered CSS is deliberate.** Component classes in `globals.css` intentionally override
  Tailwind utilities. Generic specificity and utility-first advice does not apply here.
- **Cite the source when applying an external rule.** If a checklist rule drives a change, name the
  rule and confirm it contradicts no repo doc or test.

## Evidence and calibration are never compressed

Output-style plugins such as caveman mode may compress prose. They must never compress proof.

- **Always paste the decisive line.** Report gates with real output, not a summary. Under heavy-lock
  contention, `npm run verify:ui` queues Playwright admission for up to 15 minutes and, if still
  blocked at the deadline, exits `75` with a `DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker
  (`run-playwright.mjs`) — a distinct non-zero code from an ordinary test failure, so tooling can
  tell "blocked, retry" apart from "red", but it never soft-skips green either way. When the gate
  does run, grep for the "N passed" line; exit 0 alone is not proof.
- **State verified versus assumed.** Calibration is not filler. Say what was actually run, what was
  read, and what is inferred. Do not drop uncertainty to save tokens.
- **Third-party fix claims stay unverified until checked.** Bot or agent claims that a fix landed
  must be verified against the actual ref/commit content before being repeated as fact. Prioritize
  inspecting already-fetched local refs (`git log`, `git show`) first; `git fetch` or other
  network/provider access requires explicit user confirmation per the "API and provider confirmation
  boundary" section.
- **PR titles and descriptions are parsed input, not prose.** `.github/workflows/pr-policy.yml`
  runs `scripts/pr-policy.mjs` against the exact PR title/body text. Missing or incomplete
  `## Clinical Governance Preflight` checklists (every item from `requiredClinicalGovernanceItems`
  checked on a clinical-risk diff) and missing or unsatisfied `RAG impact:` lines on a
  RAG-ranking-surface diff emit **advisory warnings** in `pr-policy` (since 2026-09-17,
  `docs/process-hardening.md`; no longer hard-blocking merges), while contributors and agents are
  still instructed to include them in full on relevant PRs (see "RAG ranking protection" in
  `AGENTS.md`). Caveman-style fragment-dropping breaks
  this exact-format contract — a paraphrased checklist item or a shortened `RAG impact:` reason can
  silently fail `governanceItemSatisfied`/`ragImpactDeclared` and trigger avoidable policy warnings
  even though the PR is otherwise fine.
  `gh pr create`/`gh pr edit` bodies and any `PR_POLICY_BODY.md` content therefore always get
  written in full normal prose from `.github/pull_request_template.md`, regardless of the active
  output style — this is "commits" territory under the caveman carve-out, not chat. Before
  push, sanity-check clinical-risk/RAG-ranking bodies against `scripts/pr-policy.mjs`'s
  `evaluatePullRequestPolicy` shape (run `npm run check:pr-policy` if the script itself changed).
  If a `PR_POLICY_BODY.md` file is created at the repo root to seed a description this way,
  delete it from the branch again before merge — `evaluatePullRequestPolicy` hard-blocks any PR
  whose diff still carries it (added, modified, or merely left in place), because a lingering
  copy is stale prose that keeps re-syncing into unrelated PRs.

<!-- END:external-skill-precedence -->
