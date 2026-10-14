# Codex Cloud prompt — design-system clinical status semantics

Copy the complete prompt below into a new Codex Cloud task for the **PsychSift (`BigSimmo/PsychSift`)**
repository. This task is deliberately limited to PR 1 of the
[design-system/live-design convergence programme](../plans/design-system-live-convergence-plan.md#pr-1--clinical-status-semantics-and-baseline-provenance).
Do not combine it with the later interaction, edge, motion, density, or shared-home tranches.

---

## Perfected prompt

You are the implementation owner for **PR 1 — clinical status semantics and baseline provenance**
in the PsychSift (`BigSimmo/PsychSift`) repository. Complete the smallest safe, independently revertible
change that removes the currently recorded colour-only status meaning and status-coloured numeral.
Also resolve the screenshot-provenance contradiction without ever representing automated review as
human approval.

### Required outcomes

1. Classify every currently flagged occurrence as clinical state, category identity, decoration, or
   false positive, based on the rendered behavior and source context—not on the detector name alone.
2. For every real state, provide persistent visible text and a second non-colour visual channel such
   as icon shape, border style, or pattern. An `aria-label` alone is not a repair for sighted users.
3. Keep numerals semantically neutral; show warning/success/state meaning beside the value rather
   than by colouring the number.
4. Reduce both design-contract metrics to zero without moving the same debt elsewhere:
   `colourOnlyStatusIndicators: 3 → 0` and `statusColouredNumerals: 1 → 0`.
5. Make screenshot provenance truthful. Never invent a reviewer, review time, approval, or evidence.
   If no genuine human disposition is available, use only a schema-supported pending state. If the
   schema or gate cannot represent that truth safely, do not change provenance; report the exact
   blocker in the handoff for a human reviewer.
6. Preserve clinical wording, source governance, conservative missing/stale-data behavior, existing
   component contracts, responsive behavior, and assistive-technology names.

### Authoritative starting evidence

Read these before editing:

- Repository rules: [`AGENTS.md`](../../AGENTS.md) and [`CLAUDE.md`](../../CLAUDE.md).
- Cloud safety and browser readiness: [`docs/codex-cloud.md`](../codex-cloud.md).
- The bounded programme and PR 1 exit criteria:
  [`docs/plans/design-system-live-convergence-plan.md`](../plans/design-system-live-convergence-plan.md).
- Design-system entry point and contracts:
  [`docs/design-system/README.md`](../design-system/README.md),
  [`SPEC.md`](../design-system/SPEC.md), [`TOKENS.md`](../design-system/TOKENS.md),
  [`COMPONENTS.md`](../design-system/COMPONENTS.md),
  [`ADOPTION.md`](../design-system/ADOPTION.md), and [`GATES.md`](../design-system/GATES.md).
- Current machine-readable debt:
  [`scripts/design-system-contract-baseline.json`](../../scripts/design-system-contract-baseline.json).
- Current flagged owners:
  [`src/components/calculators/calculator-ui.tsx`](../../src/components/calculators/calculator-ui.tsx),
  [`src/components/ui-primitives.tsx`](../../src/components/ui-primitives.tsx), and
  [`src/components/clinical-dashboard/visual-evidence.tsx`](../../src/components/clinical-dashboard/visual-evidence.tsx).
- Screenshot contract and current provenance:
  [`docs/design-system/adoption-contract.json`](../design-system/adoption-contract.json) and
  [`tests/__screenshots__/linux/provenance.json`](../../tests/__screenshots__/linux/provenance.json).
- Likely proof owners:
  [`tests/ckb-v2-token-contract.test.ts`](../../tests/ckb-v2-token-contract.test.ts),
  [`tests/design-token-contract.test.ts`](../../tests/design-token-contract.test.ts),
  [`tests/design-system-adoption.test.ts`](../../tests/design-system-adoption.test.ts), and
  [`tests/ui-accessibility.spec.ts`](../../tests/ui-accessibility.spec.ts).
- Review and PR policy: [`docs/codex-review-protocol.md`](../codex-review-protocol.md) and
  [`.github/pull_request_template.md`](../../.github/pull_request_template.md).

Treat the paths and counts above as starting evidence, not immutable truth. Re-measure at the task
HEAD before editing. Inspect actual definitions, consumers, tests, detector logic, and generated-file
ownership. Do not manually edit a generated baseline if a repository update command owns it.

### Authority and hard safety boundaries

- Work in the repository's **offline Cloud profile**. Require `CODEX_CLOUD=1`,
  `CODEX_CLOUD_ACCESS_PROFILE=offline`, `RAG_PROVIDER_MODE=offline`,
  `NEXT_PUBLIC_DEMO_MODE=true`, and `PLAYWRIGHT_OFFLINE_MODE=true`.
- Do not call OpenAI, Supabase, Railway, GitHub/GitLab APIs, hosted CI, analytics, email, or any other
  provider. Do not access production/staging systems or live data. Do not deploy, migrate, reindex,
  rotate credentials, print secrets, or create `.env*` files.
- Do not install or update dependencies, switch package managers, loosen engines, or create a new
  lockfile. Use the installed Node 24/npm 11 toolchain and the existing `package-lock.json`.
- Do not reset, clean, stash, rebase, force-push, delete branches, overwrite unrelated work, or
  weaken tests/contracts to make a check pass.
- You may edit only the three flagged owners, the smallest directly affected tests, and generated
  design-contract artifacts that the repository's normal update path demonstrably owns.
  `tests/__screenshots__/linux/provenance.json` is permitted only under the truthfulness rule above.
  Stop before touching unrelated routes or broad shared foundations.
- A local task commit is authorized after verification. A push or pull request is **not** authorized
  by this prompt. Use native Cloud publication controls only if a separate current-task instruction
  explicitly authorizes publication; never introduce shell tokens as a workaround.

### Phase 0 — prove Cloud isolation before any write

1. Inspect `git status --short --branch`, `git rev-parse HEAD`, upstream/ahead/behind state, relevant
   recent commits, and `git worktree list --porcelain`. Check for an active merge, rebase, cherry-pick,
   or revert and for repo-owned install/test/build/server processes that could race this work.
2. The checkout must be clean. If it contains any staged, unstaged, or untracked content, stop and
   report it; do not absorb, move, stash, delete, or overwrite it.
3. If detached or on `main`, `master`, `develop`, or `release/*`, create
   `codex/cloud-design-status-semantics`. Otherwise retain the supplied task branch.
4. Run the repository isolation verifier exactly as documented by
   [Prompt Perfector's repository workflow](../../.agents/skills/prompt-perfector/references/repository-workflow.md):

   ```bash
   test "${CODEX_CLOUD:-}" = "1"
   test -z "$(git status --porcelain --untracked-files=all)"
   branch="$(git branch --show-current)"
   repo="$(git rev-parse --show-toplevel)"
   head="$(git rev-parse HEAD)"
   node .agents/skills/prompt-perfector/scripts/verify-repository-isolation.mjs \
     --cloud --expected-repo "$repo" --expected-branch "$branch" --expected-head "$head"
   ```

   Proceed only if it emits `SAFE_TO_EDIT=true` and `PRECHECK_RESULT=SAFE`. Re-run it immediately
   before the first edit. This verifies repository workflow isolation, not an OS-level sandbox.

5. Confirm runtime/install/browser readiness without mutating dependencies:

   ```bash
   node --version
   npm --version
   npm run check:codex-cloud
   npm run check:installed-lock-parity
   npm run check:playwright-browser-revision
   ```

   A browser-revision mismatch is an environment limitation, not permission to substitute a random
   browser executable. Continue with static/DOM proof and hand browser evidence to matching CI/local
   infrastructure as documented in `docs/codex-cloud.md`.

### Phase 1 — inspect, classify, and lock the plan

State one line before planning: **plan effort high; build effort medium-high; the risk is changing
clinical state meaning or falsely certifying visual evidence.**

1. Read the repository skills for `plan`, `ui`, `clinical`, `test`, `review`, and `handover`; apply
   only their relevant steps. Do not install new skills or invent a parallel workflow.
2. Because this is a review-sensitive task, run:

   ```bash
   npm run ledger:lookup -- HEAD --scope "PR 1 clinical status semantics and baseline provenance"
   ```

   Follow the verdict and `docs/codex-review-protocol.md`. Do not hand-edit ledger records.

3. Read the relevant installed Next.js 16 guide under `node_modules/next/dist/docs/` before changing
   framework-facing UI behavior. Training-data assumptions are not evidence.
4. Run the repository workflows in evidence mode for the exact candidate paths:

   ```bash
   npm run workflow:flightplan -- --write-evidence --files \
     src/components/calculators/calculator-ui.tsx,src/components/ui-primitives.tsx,src/components/clinical-dashboard/visual-evidence.tsx,scripts/design-system-contract-baseline.json,tests/__screenshots__/linux/provenance.json
   npm run workflow:design-sweep -- --write-evidence
   npm run workflow:clinical-proof -- --write-evidence
   ```

5. Record the measured global counts and per-path counts before editing. Inspect the contract scanner
   that produces them. For each of the four flagged occurrences, write a compact classification table:
   owner/symbol, rendered state, user-visible meaning, clinical risk, classification, proposed
   non-colour channel, and proof owner.
6. Inspect empty, missing, stale, loading, error, and success variants. Specifically try to disprove
   that a visually positive state could imply “safe/current” when evidence is absent or stale.
7. Inspect the provenance schema, validation scripts, Git history for the record, and candidate hashes.
   The current text may be contradictory; it is not proof that a human reviewed the images.
8. Before implementation, produce a short executable plan naming exact symbols, tests, generated
   artifacts, commands, and rollback. If classification requires a clinical/product decision, or the
   safe repair exceeds this tranche, stop with the evidence and one concise blocking question.

### Phase 2 — implement the smallest complete repair

1. Add or adjust the smallest regression tests first where practical. Tests must prove visible
   non-colour differentiation and accessible names; they must not merely snapshot implementation
   classes.
2. Prefer existing design-system primitives, semantic tokens, icons, and copy conventions. Do not add
   new dependencies, raw palette values, one-off token aliases, decorative motion, or broad component
   abstractions.
3. For each real status:
   - keep explicit persistent text;
   - add a second visual channel that survives authored-colour removal and forced colours;
   - keep icon-only decoration hidden from assistive technology when adjacent text already names it;
   - preserve keyboard/focus behavior and at least the existing hit target;
   - preserve conservative wording for unknown/missing/stale data.
4. For the flagged numeral, remove status semantics from the number itself and render the state beside
   it. Ensure reading order and the accessible name remain natural.
5. For a detector false positive, improve detector/test precision only with a focused proof that the
   rendered UI never conveys state by colour. Do not add an allowlist merely to hit zero.
6. Update generated contract artifacts only through the existing repository generator/update path
   identified during discovery. Confirm both the global count and each original owner's count fall;
   search the full diff for relocated equivalents.
7. For provenance, choose exactly one truthful path:
   - if genuine human review evidence is supplied in the task context, record only that real identity,
     timestamp, source HEAD, and schema-valid disposition;
   - otherwise, change the record to a schema-valid pending/non-human state only if repository
     contracts explicitly support it and tests prove it;
   - otherwise leave the file unchanged and make human disposition an explicit local handoff gate.
     Never regenerate or adopt images merely to resolve metadata wording.
8. Reinspect the entire task diff for clinical copy drift, false reassurance, token bypasses, secrets,
   unrelated formatting, generated noise, and unintended public contract changes.

### Phase 3 — adversarial UI proof

For browser work, first run `npm run ensure`, use only the printed URL, and verify
`/api/local-project-id` identifies this repository. Do not assume a port or attach to an unknown
server. Do not leave a watcher or server running after the task.

Exercise every changed state at the smallest relevant desktop and phone viewport, including default,
dark, forced-colours, reduced-motion, monochrome (authored colours removed/grayscale), and print.
Check keyboard navigation, visible focus, screen-reader names/reading order, 200% zoom/reflow, loading,
empty, error, stale, and success states where the component supports them. The status must remain
distinguishable when all authored colours are removed, and the UI must not imply that missing or stale
clinical evidence is safe/current.

Capture candidate evidence only when it helps review. Do not overwrite canonical screenshots or mark
them human-approved. If browser readiness fails, preserve the exact diagnostic and create a precise
local/CI handoff rather than weakening the matrix.

### Phase 4 — risk-scaled verification

Run heavy commands sequentially. Start narrowly and add a gate only when it covers a distinct plausible
failure. Determine exact focused selectors from the repository rather than inventing script names.

Minimum expected ladder:

1. Directly affected unit/DOM tests for the changed owners and contract scanner.
2. `npm run check:design-system-contract` — proves metric and adoption/design-sync contracts.
3. The focused accessibility/browser journey from `tests/ui-accessibility.spec.ts`, if the matching
   locked Chromium revision is available.
4. `npm run check:production-readiness` because the change affects clinical status presentation.
5. Inspect selection with:

   ```bash
   npm run verify:pr-local -- --dry-run --files <actual-comma-separated-changed-paths>
   ```

   Then run non-dry-run `npm run verify:pr-local` once for PR-ready local handoff if selected policy
   requires it. Escalate to `npm run verify:ui` only if shared UI foundations changed or the selector
   requires it; do not stack it automatically after focused browser proof.

6. Run `npm run format`, inspect its diff, include intended formatting, then run
   `npm run docs:check-links`, `npm run docs:check-scripts`, and `git diff --check` when documentation
   changed.

When a check fails, reduce it to the smallest reproducer, classify it as change-caused, pre-existing,
flaky, environmental, or provider-blocked, fix only change-caused failures, and rerun the invalidated
proof. Never claim an unrun or receipt-reused check was fresh; identify receipt reuse explicitly.

### Phase 5 — review, commit, and local handoff

1. Review the final diff under `docs/codex-review-protocol.md`, findings first and severity-ranked.
   Resolve all change-caused high-confidence findings. Append the review record only through
   `npm run ledger:append` with the actual full 40-character HEAD, scope, outcome, and checks.
2. Confirm final status contains only coherent task files and allowed workflow/ledger evidence. Exclude
   `.local`, caches, logs, browser output, dependencies, secrets, and unrelated artifacts.
3. Create one clear local commit. Do not push or publish unless separately authorized in the active
   Cloud task. Report the commit SHA and whether the branch has an upstream.
4. Produce this handoff packet:
   - outcome and changed symbols/files;
   - before/after global and per-path contract counts;
   - classification and repair for each original occurrence;
   - adversarial matrix with pass/fail/not-run and evidence path for every state/mode;
   - exact commands and decisive results, including reused receipts;
   - provenance disposition, evidence basis, and any human-approval gate still open;
   - branch, worktree, commit, push, and PR state;
   - provider/live checks not run and why;
   - remaining risks and the single smallest next action.

For the **local handoff**, give a copy/paste command sequence that begins by checking out the reported
branch/commit, confirms Node 24/npm 11 and lock parity, runs `npm run ensure`, verifies the printed
project identity URL, and executes only the browser modes that Cloud could not prove. Name the exact
routes, viewports, states, and expected visible/non-colour outcomes. If human screenshot disposition is
still required, list candidate paths and hashes and instruct the human to approve or reject them through
the repository's documented adoption workflow—never by directly editing “approved” metadata.

### Stop conditions

Stop and report evidence instead of guessing if: the checkout is dirty or non-isolated; runtime or
lock parity is invalid; a provider/live action becomes necessary; a real clinical/product decision is
required; a genuine reviewer identity is unavailable; the provenance schema cannot represent the
truth; the required repair expands into another convergence tranche; the matching browser cannot be
made available without an install/environment change; or unrelated failures prevent meaningful proof.

Completion means the bounded implementation is locally committed, all available risk-relevant checks
are honestly reported, both targeted metrics are zero without debt relocation, clinical meaning is
preserved under adversarial modes, and any inherently human or provider-backed gate is handed off
explicitly. It does **not** mean claiming perfection, human approval, deployment, or production proof.
