# Testing and verification

## Safe local execution

Repository verification uses a local run coordinator derived from Git's common directory, so admission covers every worktree for this repository. It permits at most two shared leases from different worktrees for fail-closed focused Vitest selections and read-only typechecking. Full Vitest, coverage, lint, build, Playwright, and live-provider tests retain exclusive admission. Unknown Vitest selections fail closed to exclusive mode, and shared Vitest runs are capped at two workers each.

Composite gates do not hold an umbrella lease: `verify:cheap` and `verify:pr-local` let each lint, typecheck, unit, build, or browser stage acquire the appropriate lease. This lets focused work proceed during lightweight stages without allowing it to overlap an exclusive stage. Waiting admission is queue-ordered, so later focused runs cannot jump ahead of a queued exclusive command. Exclusive stages wait up to 15 minutes for long browser or build owners; shared focused work retains a 30-second admission timeout so an interactive check reports contention promptly.

Nested commands reuse their parent's token. Shared typechecks override the repository's `node_modules/.cache` incremental path with worktree-specific temporary `.tsbuildinfo` state, so junctioned dependency directories are not written concurrently. The coordinator retains the legacy lock path and a live sentinel owner so older worktrees safely wait instead of bypassing newer shared leases. Dead owners and abandoned queue entries are reclaimed; live owners heartbeat and command text is redacted before persistence or contention output. Do not bypass or delete coordinator state manually.

Vitest's Vite transform cache is outside the commonly-junctioned `node_modules` tree and keyed by worktree. Two focused runs from the same worktree are not admitted concurrently. Do not install packages while a repository test, build, lint, typecheck, or server command is active. Avoid short-interval polling, and do not repeat an unchanged broad gate after it has already passed.

Ordinary Vitest and Playwright runs remove OpenAI, Supabase, database, and E2E credentials and force demo/offline mode. Provider tests use the `*.live.test.ts` suffix, are excluded from default discovery, and can only be started explicitly with `ALLOW_PROVIDER_TESTS=true npm run test:live`.

**Provider-backed boundary:** `test:live`, `eval:quality`, `eval:retrieval:quality`, `verify:release`, `check:supabase-project`, and other OpenAI/Supabase/hosted workflows need **explicit user approval** before agents run them (see root `AGENTS.md`). Prefer offline gates (`verify:cheap`, `verify:pr-local`, `eval:rag:offline`) unless that approval is in the task.

### Windows process-spawn diagnostic (#VV83VA)

Before investigating a slow `git push`, `gh`, or pre-push guard on a Windows workstation, measure an unrelated local process spawn.

In PowerShell:

```powershell
Measure-Command { node --version }
# or evaluating inline execution:
Measure-Command { node -e "console.log(process.version)" }
```

From `cmd.exe`, invoke the same measurement without relying on shell aliases:

```cmd
powershell -NoProfile -Command "Measure-Command { node --version }"
powershell -NoProfile -Command "Measure-Command { node -e 'console.log(process.version)' }"
```

In Bash / WSL:

```bash
time node --version
time node -e "console.log(process.version)"
```

Subsecond completion (<0.2s) is healthy; if this simple command takes multiple seconds (measured up to 17s on process-starved hosts vs 0.08s after reboot), treat it as host process-spawn starvation rather than a repository or GitHub CLI fault. Close stale Codex, Node, and terminal sessions, then retry; reboot the workstation if the condition persists. Do not change Windows Defender, add security exclusions, or otherwise alter Windows security settings as part of this diagnosis.

## Risk-based selection

Start with the cheapest check that can fail for the changed behavior. Add another check only when it covers a distinct plausible regression that the existing evidence does not. Documentation and policy changes normally need formatting, documentation, syntax, or focused contract checks; localized behavior needs its directly affected test; cross-cutting or uncertain executable changes escalate to the relevant domain or broad gate. Do not routinely stack focused tests, the full unit suite, lint, typecheck, build, and browser checks, and do not rerun an unchanged passing gate.

`npm run verify:pr-local -- --dry-run --files <comma-separated paths>` shows the local plan. Recognised documentation and workflow/policy-only scopes stay focused. Product code, tests, executable configuration, dependencies, database/container surfaces, mixed scope, and unknown non-document paths fail closed to the heavy plan. Provider, physical-device, and release-only acceptance remain separate and require their normal approval or task context.

## Testing speed playbook

Production Chromium is ~85% of UI-scoped PR wall clock; cancelled mid-UI runs waste more than missing parallelism. Prefer selection, duration-balanced groups, and within-session cache reuse over raising Playwright workers (`workers: 1`, `fullyParallel: false`, `retries: 0` stay required — see `#093` and [process-hardening.md](process-hardening.md)).

| Change type                           | Run this                                                         | Avoid                                                     |
| ------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| Lib/helper, no UI                     | `npm run test:focused -- --files <paths>` or one Vitest file     | `verify:ui`                                               |
| Component interaction                 | `.dom.test.tsx` + focused Vitest                                 | full Chromium                                             |
| Phone chrome / scroll / composer      | `npm run verify:phone-chrome -- --dry-run`, then without dry-run | immediate `verify:ui`                                     |
| Shared shell / header / `globals.css` | phone-chrome, then `verify:ui` once at handoff                   | stacking `verify:cheap` + `verify:pr-local` + `verify:ui` |
| Docs / ledger only                    | `npm run verify:pr-local -- --dry-run` (confirm docs route)      | full unit + UI                                            |
| PR ready                              | `npm run format` (commit it) + `verify:pr-local` once            | mid-CI pushes that cancel Production UI                   |

**Local Playwright keep-root (iterative UI work).** Each `run-playwright.mjs` invocation otherwise builds under a unique `.next-playwright/<id>/` and deletes it. KEEP does **not** skip the Next production build — every invocation still rebuilds. It reuses the webpack/dist cache inside one shared root across stages in the same local session:

```bash
export PLAYWRIGHT_BUILD_ROOT_ID=local-ui
export PLAYWRIGHT_KEEP_BUILD_ROOT=true
# then: focused greps / verify:phone-chrome / single-spec runs
# each run still builds; the shared root retains webpack cache between them
# unset both vars (or delete `.next-playwright/local-ui`) when done
```

`verify:phone-chrome` sets a session keep-root automatically when it runs two or more browser stages, then cleans that root on exit. Its dry-run wording deliberately says **webpack cache reuse**, not build skipping.

**Clean-tree selection behavior (`#5MMK5R`).** `npm run verify:phone-chrome` evaluates working-tree diffs relative to the branch merge-base to identify affected browser contracts and journeys. When run against a clean working tree with no diff relative to base, it selects zero browser stages by design. To test specific browser stages against a clean tree, supply explicit comma-separated paths via `npm run verify:phone-chrome -- --files <paths>` or force all stages via `npm run verify:phone-chrome -- --full=always`.

### Dev Drive trusted package cache verification (#6SMMB4)

On Windows workstations hosting worktrees on a Dev Drive (`D:`, ReFS) where `npm config get cache` resolves to `D:\.npm-cache`, register the npm package cache as a trusted Dev Drive cache to prevent Microsoft Defender real-time scanning overhead during `npm ci` extractions across worktrees.

**Elevated registration command (run once in an Administrator PowerShell or CMD):**

```powershell
fsutil devdrv trust D:\.npm-cache
```

**Diagnostics & verification:**

1. **Elevated Dev Drive query:**
   ```powershell
   fsutil devdrv query D:
   ```
   Inspect the output for `Developer volume is trusted: Yes` and check that filesystem filters are attached in performance mode. (Note: Non-elevated prompts return `Error 5: Access is denied`).
2. **Fallback registry probe (non-elevated PowerShell diagnostic):**
   ```powershell
   Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "DevDrive*" -ErrorAction SilentlyContinue
   ```
   Or verify volume file system properties (`(Get-Volume -DriveLetter D).FileSystemType -eq 'ReFS'`). Trusting the volume or cache enables Defender asynchronous performance mode without disabling Defender real-time protection on untrusted files.

### PreCompact hook contract and logging (#RZQQBT)

`.claude/hooks/precompact-issues-capture.sh` is log-only and write-isolated. It appends firing receipts to `claude-precompact.log` under the directory from `git rev-parse --git-dir` (the worktree git dir for linked worktrees, not a hardcoded `.git/` path) and stays silent on stdout and stderr. Claude Code surfaces hook stdout to model context for `SessionStart` and `UserPromptSubmit`; `SessionStart` is the post-compaction backstop. The PreCompact hook is a silent audit log, guaranteed never to throw an unhandled error or break an automatic or manual context compaction.

**Refuted levers (do not revive):** persistent Actions cache for the Next webpack tree (~804 MB, evicts browser cache); transporting the critical job's 1.09 GB webpack cache to three shard runners (CI 31285952061 spent 19–67s downloading it and the slowest runner was slower than a cold build); splitting `ui-phone-scroll*` to rebalance `--shard` (siblings still co-land); renaming specs to game alphabetical shard order; Playwright `workers > 1` or blocking retries; dropping Production UI from ordinary UI PRs; Firefox/WebKit on every PR (main/weekly matrix only).

**Remote / Cloud browser drift.** When `check:installed-lock-parity` fails on `playwright`, or `check:playwright-browser-revision` reports `/opt/pw-browsers` revision drift, do **not** point `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` at a mismatched shell and do **not** set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` to force a run — a browser gate against the wrong revision is not evidence. `run-playwright.mjs` applies the same revision check in its launch preflight and refuses a mismatched override before acquiring the heavy lock or building. Delegating browser proof to CI Production UI is always valid. Restoring the gates locally is also possible; the recipe below was verified end to end on 2026-08-09 (`#255`). See also [codex-cloud.md](codex-cloud.md).

Two separate image faults produce this, and the second is why the obvious fix looks impossible:

1. **The baked `node_modules` is stale or incomplete.** Symptoms range from no `node_modules` at all to `playwright: installed 1.62.0 does not match locked 1.62.1` with `tailwind-merge` missing entirely. The lockfile is not wrong — do not re-pin it to the installed version.
2. **The image's Node is too old to run `npm ci`.** `jsdom@30.0.1` requires `^22.22.2 || ^24.15.0 || >=26.0.0`; images have shipped v24.13.0, so `npm ci --include=dev` dies on `EBADENGINE` under `engine-strict=true`. Never bypass with `--force`, `--legacy-peer-deps`, or `--engine-strict=false`.

```bash
# 1. Node >= 24.15.0 (satisfies both the repo's 24.x engine and jsdom's floor).
curl -sSL -o /tmp/node24.tar.xz https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz
mkdir -p /root/.node24 && tar -xf /tmp/node24.tar.xz -C /root/.node24/
export PATH=/root/.node24/node-v24.19.0-linux-x64/bin:$PATH   # node v24.19.0, npm 11.17.0

# 2. Real install. Expect exit 0; then parity prints all seven pinned packages.
npm ci --include=dev && npm run check:installed-lock-parity

# 3. Browsers. Playwright 1.62.1 wants Chromium 1234; images have shipped only 1194.
unset PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
npx playwright install chromium chromium-headless-shell   # installs into PLAYWRIGHT_BROWSERS_PATH
```

Costs roughly 5 minutes and ~330 MB (184 MB chromium + 115 MB headless shell + 32 MB node), needs a few GB free, and is paid **per session** because the container is ephemeral. The durable fix is still an image that ships Node ≥ 24.15.0, a complete `npm ci`, and the locked Chromium revision.

Codex Cloud agents remain provider-free. Run authenticated Supabase tests through the
manual `.github/workflows/authenticated-live-tests.yml` workflow, which requires the
explicit `run-authenticated-live-tests` dispatch confirmation, records the run against the
`Database / production` environment, and injects GitHub secrets only into the identity
guard and live-test steps. The secret-bearing job runs only from `refs/heads/main` and
checks out that trusted ref; it never runs on a push, pull request, or schedule. This suite
is not read-only: the confirmation explicitly authorizes bounded E2E-user sign-in/sign-out,
test requests, and production rate-limit row updates. A connected-only GitHub PAT exception
does not authorize provider tests, provider credentials, deployment, or production data access;
it is limited to the documented, exact GitHub connector-gap operation in
`docs/codex-cloud.md`.

## Commands

| Command                                   | Purpose                                                                                                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:focused -- --files <paths>` | Local iteration using Vitest related-file selection. It fails closed for deleted files, test infrastructure, configuration, or an empty/unsafe mapping.                                                                             |
| `npm run test`                            | Complete offline unit suite.                                                                                                                                                                                                        |
| `npm run test:ci-workflows`               | Focused offline contracts for CI, authenticated-workflow, Codex-autofix, and eval-canary workflow changes.                                                                                                                          |
| `npm run test:live`                       | Explicit provider suite; requires `ALLOW_PROVIDER_TESTS=true`.                                                                                                                                                                      |
| `npm run test:e2e:pr`                     | Required production Chromium journeys and visual-artifact smoke, excluding mockups and quarantined tests.                                                                                                                           |
| `npm run test:e2e:advisory`               | Quarantined and mockup journeys in one advisory invocation.                                                                                                                                                                         |
| `npm run verify:cheap`                    | Ordinary offline local gate: `check:installed-lock-parity`, `check:diff-integrity`, lint, typecheck, and the full unit suite. Nothing else. Static hygiene (runtime, sitemap, design tokens, ledgers…) lives in `verify:full` / CI. |
| `npm run verify:full`                     | Broad offline local gate: 41 static/consistency gates then lint, typecheck, and unit tests. Does not invoke the cheap script. `check:gate-manifest` reads this chain.                                                               |
| `npm run verify:pr-local`                 | Risk-routed PR-like local gate. Recognised docs/workflow scopes stay focused; executable or unknown scope adds lint, typecheck, full unit, and domains.                                                                             |
| `npm run verify:phone-chrome`             | Smart phone-chrome gate: lock parity, affected contracts, browser/PWA owners and exact journeys, then full UI only for shared foundations.                                                                                          |
| `npm run verify:ui`                       | Complete required production Chromium gate.                                                                                                                                                                                         |
| `npm run test:e2e:style-contract`         | Focused rendered-effect assertions for the unlayered classes in `globals.css` (also runs inside `test:e2e:pr`).                                                                                                                     |
| `npm run test:e2e:visual`                 | Pixel baselines. Advisory in CI; a platform with no committed baseline fails by design.                                                                                                                                             |
| `npm run test:e2e:visual:update`          | Rewrite the pixel baselines for the current platform. Review every changed PNG before committing.                                                                                                                                   |
| `npm run verify:lighthouse`               | Build, serve, and measure the budgeted routes with Lighthouse, then grade against the committed baseline. `-- --dry-run` prints the plan.                                                                                           |
| `npm run check:lighthouse-budget`         | Grade Lighthouse JSON that already exists. `-- --update` refreshes the baseline in `lighthouse-budget.json`.                                                                                                                        |
| `npm run check:coverage-inventory`        | Fail if a declared executable root is absent from the generated `coverage/lcov.info`.                                                                                                                                               |
| `npm run check:bundle-budget`             | Enforce aggregate production, five route-local, and mockup-only client-JS gzip baselines after a clean build.                                                                                                                       |
| `npm run receipts`                        | Show the gate-receipt store: current input signature per memoised gate and how many stored receipts are valid right now.                                                                                                            |
| `npm run receipts:clear`                  | Empty the gate-receipt store, forcing the next `lint`/`typecheck`/Vitest run to execute for real.                                                                                                                                   |

`lint`, `typecheck` and non-coverage Vitest runs are memoised against a content signature, so an identical
re-run on unchanged content exits 0 without repeating the work. Failures are never memoised, `CI` disables
reuse entirely, and `build`/`test:coverage` are excluded because later gates read their artefacts. Report a
reused gate as a reused receipt, not a fresh run; `GATE_RECEIPTS=refresh` forces the real thing. Full
contract: `docs/process-hardening.md`.

Set `FAST_CHECK_SEED` to reproduce a property-test run. Local and ordinary CI runs default to `424242`; scheduled CI may derive a bounded seed from the run ID.

## Component tests (jsdom)

Two Vitest projects run under one `npm run test` (see `vitest.config.mts`):

- **node** (`tests/**/*.test.ts`) — pure logic, route handlers, and SSR-string assertions.
- **jsdom** (`tests/**/*.dom.test.tsx`) — interactive component tests via `@testing-library/react`. The `.dom.test.tsx` suffix is required; a `.test.ts` file is collected by the node project and has no DOM.

Author component tests to assert **user-visible behaviour**, not markup snapshots:

- Query by role and accessible name (`getByRole("button", { name: … })`) so a missing or wrong `aria-label` fails the test; drive interactions with `@testing-library/user-event`.
- Cover the state matrix the change touches — loading / empty / error / disabled — plus keyboard operability and focus where relevant.
- The shared setup (`tests/setup/jsdom.setup.ts`) registers jest-dom matchers, auto-unmounts between tests, and polyfills `matchMedia` (override per test with the exported `installMatchMediaStub`) and `Element.scrollIntoView`.
- Mock hooks/modules with `vi.mock`; when the factory needs a spy, create it with `vi.hoisted` so it exists when the hoisted mock runs.

Reference examples: `tests/icon-button.dom.test.tsx` (accessible-name contract), `tests/sheet.dom.test.tsx` (stacked-overlay keyboard + scroll-lock), `tests/scroll-behavior.dom.test.tsx` (reduced-motion), `tests/registry-retry.dom.test.tsx` (`vi.hoisted` hook mock + error recovery).

## Playwright ownership

The repository runner exclusively builds and serves each Playwright production app. It selects a safe port, verifies `/api/local-project-id`, uses an isolated `.next-playwright/<run-id>` build directory, replaces provider configuration with inert loopback values, and removes its server and output on success, failure, or signal. Playwright configuration never starts a server. The production boot guard permits this demo profile only when the output is isolated, provider mode is offline, credentials are absent, and the Supabase URL is the inert `127.0.0.1:1` target. Before acquiring the heavy lock or building, the runner preflights the Chromium (or requested Firefox/WebKit) executable — including the default `chrome-headless-shell` binary and any `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` override — and exits non-zero immediately when it is missing, so a launch-infra failure cannot be mistaken for product-test failures after a multi-minute build. The designated download-disabled container image is the one exception: when `PLAYWRIGHT_BROWSERS_PATH` is exactly `/opt/pw-browsers` and the client-pinned shell is absent, the runner selects the newest preinstalled shell for the current platform and CPU architecture, then passes its exact path to Playwright. It logs that fallback before the build; generic shared caches still fail closed even when `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, so a developer cache cannot silently bless a stale browser.

When capturing Playwright or `verify:phone-chrome` output through a shell pipe (`cmd 2>&1 | tee …`), enable `set -o pipefail` (or avoid the pipe). Without it, bash reports the pipeline exit from `tee` (`0`) while the log still ends in `N failed` — a measurement artifact that previously looked like a green-when-broken gate (outstanding-issues #120). The Node runners themselves already propagate Playwright’s exit status.

CI may opt into incremental build-cache reuse by setting a validated `PLAYWRIGHT_BUILD_ROOT_ID` and `PLAYWRIGHT_KEEP_BUILD_ROOT=true`. The critical-first job pins `.next-playwright/ci-production`, retains it on its ephemeral runner, and publishes `dist/cache` as a one-day run-scoped workflow artifact (`include-hidden-files: true` because the path is under a dot-directory; `compression-level: 0` because Next already stores the production webpack cache uncompressed); the dependent production shards restore that artifact before building. This deliberately avoids `actions/cache` so an ~804 MB Next webpack cache cannot consume the shared 10 GB budget or evict the Playwright browser cache. Local runs and every caller without both opt-ins retain the unique-root, unconditional-cleanup contract. The artifact never contains Playwright reports, server output, or provider credentials.

Blocking tests run with zero retries. CI publishes list, JUnit, and JSON reports. Failed-test classification parses JUnit test cases and uses exact spec/title matches; a job name is never enough to classify a failure as a known flake.

Phone-chrome work uses `npm run verify:phone-chrome`. Inspect its classification with `-- --dry-run` or provide an explicit changed set with `-- --files pathA,pathB`. The default `--full=auto` escalates shared shell/header/footer, scroll-coordinator, reserve, or global-style changes to `verify:ui` only after focused ownership and journey checks pass. Page-local owners and test-helper changes remain focused; use `--full=always` for deliberate extra confidence or `--full=never` only when the dry run records why the recommended broad gate is unavailable. Physical Safari and cold-launch PWA paint still follow [phone-chrome-physical-acceptance.md](phone-chrome-physical-acceptance.md).

### Playwright project cadence, and why the two iPhone projects stay release-only

`playwright.config.ts` defines seven projects. This is where each one actually runs, so a project
can never again be defined without a reader being able to see its cadence (pinned by
`tests/playwright-project-cadence.test.ts`, which fails closed on any project named by no script
and recorded in no line here).

| Project                 | Runs on                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `chromium`              | Blocking PR gate (sharded production journeys) and the release matrix     |
| `chromium-mockups`      | Advisory PR invocation and the release matrix                             |
| `firefox`, `webkit`     | Release matrix only (`main`, release branches, dispatch, Sunday schedule) |
| `mobile-webkit`         | Release matrix **full-suite path only** — see the decision below          |
| `mobile-pwa-standalone` | Release matrix **full-suite path only** — see the decision below          |

**Decision (2026-09-04, L68): the two iPhone-14 projects stay release-only.** They execute when the
release matrix runs the whole suite — that is, when UI did not change or in-run Chromium proof is
missing — and not on the matrix's ordinary UI-change path, which names Chromium mockups plus
Firefox and WebKit.

The reason is runtime against the evidence in this repository. Each of these projects replays the
**entire** production journey suite on an emulated iPhone 14, the same shape as the Firefox and
WebKit suites. The last recorded complete matrix (run 4012) took **38 minutes** for three such
suites, the job carries a **70-minute** timeout, and a ~70-minute matrix run holding
`CI-refs/heads/main` is the incident recorded in [ci-operations.md](ci-operations.md). Two more
full suites is roughly another 25 minutes on a job already sized to its ceiling — and on the
blocking PR gate, which today runs sharded Chromium only, it would be the difference between a
UI PR waiting minutes and waiting most of an hour. That cost is not repaid, because the phone
behaviour these projects would prove already has a **focused** blocking owner:
`npm run verify:phone-chrome` selects the affected phone owners and journeys on every phone-chrome
change and escalates to `verify:ui` when a shared shell, header, footer, scroll-coordinator,
reserve, or global-style file is touched.

What is genuinely not covered is **cross-engine** phone rendering — the focused gate runs Chromium.
That is the residual risk being accepted here, and it is bounded: WebKit itself is proven every
release matrix on the desktop projects, so what goes unproven between full-suite runs is
iPhone-viewport WebKit specifically. Revisit if a phone-only WebKit regression ever reaches
`main`; the change would be to name the two projects in the matrix's ordinary-path project list in
`.github/workflows/ci.yml`, not to add them to the blocking PR gate.

### Phone sticky-header settle timing (screenshots and DOM measurements)

The phone header stack (`.phone-sticky-header-stack`) uses `position: fixed` in browser tabs and `position: absolute` within the phone viewport frame in installed standalone mode, and mounts collapsed. The top content reserve `max-sm:pt-[var(--phone-overlay-chrome-h)]` resolves to the full measured stack height only after mount via `usePhoneOverlayChromeReserve` across an 80ms quiet window (`phoneOverlayReserveGeometryQuietWindowMs`). Standalone tests must assert the absolute-positioning contract.

Playwright tests that evaluate DOM offsets (`getBoundingClientRect()`, `offsetTop`, etc.) or capture screenshots immediately at `networkidle` can observe premature unsettled geometry (such as content appearing at `y=72` under the header rather than at its settled `y=121` position, as discovered on `/dictionary/browse` in #XPY409).

**Required settle assertion pattern before reading DOM offsets or taking screenshots:**

```ts
import { expect, type Page } from "@playwright/test";

// Wait for the phone header stack and overlay reserve to settle
await expect
  .poll(
    async () => {
      return page.evaluate(() => {
        const stack = document.querySelector<HTMLElement>(".phone-sticky-header-stack");
        const reserve = getComputedStyle(document.documentElement).getPropertyValue("--phone-overlay-chrome-h");
        const stackHeight = stack ? Math.round(stack.getBoundingClientRect().height) : 0;
        const reservePx = parseFloat(reserve) || 0;
        return stackHeight > 0 && Math.abs(stackHeight - reservePx) <= 1;
      });
    },
    { message: "expected phone-sticky-header-stack and --phone-overlay-chrome-h to settle" },
  )
  .toBe(true);
```

Or when measuring a specific content element (`main` or `h1`), wait for its vertical offset to stabilize across frames:

```ts
await expect
  .poll(
    async () => {
      return page.evaluate(async () => {
        const el = document.querySelector<HTMLElement>("main, h1");
        if (!el) return false;
        const first = Math.round(el.getBoundingClientRect().top);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const second = Math.round(el.getBoundingClientRect().top);
        return first > 0 && Math.abs(first - second) <= 1;
      });
    },
    { message: "expected content vertical offset to stabilize across animation frames" },
  )
  .toBe(true);
```

## Visual regression and style contracts

Appearance is verified at two levels, because they fail differently.

**Style contracts (`tests/ui-style-contract.spec.ts`) — required, deterministic.** Class rules in
`globals.css` that sit outside `@layer` are there to beat a Tailwind utility. If one is moved into a
layer it goes inert: still in the DOM, still in the class list, painting nothing. That is ledger
#094 — PR #1316 shipped the search band's accent rail inert, and the test guarding it asserted
`toHaveClass("search-band")`, i.e. the cause rather than the effect. jsdom cannot catch this (it does
not implement cascade layers) and `check:design-system-contract` cannot either (it reads source
text), so the assertions run in a real browser and read computed style. Where a rule has an
attribute-scoped variant, the contract also proves the variant wins the cascade.

`tests/style-contract-registry.test.ts` keeps the inventory closed: every unlayered visual class must
appear in `STYLE_EFFECT_CONTRACTS` or carry a reasoned exemption in
`tests/helpers/style-contracts.ts`. A newly-added unlayered class fails that test until someone
chooses which it is — the missing piece before, when the one existing rail assertion was a one-off.
Prefer deleting an exemption by adding a contract.

The parser walks back over comma-continued selector lines, so a selector list split across lines inventories every class in it, not just the one on the line that opens the block. Closing that hole immediately surfaced three previously-unpoliced classes — `dashboard-composer-edge`, `edge-glass-header` and `medication-also-matches` — which is the gate doing its job.

**Pixel baselines (`tests/ui-visual-baseline.spec.ts`) — advisory.** Run by
`playwright.visual.config.ts`, which also still runs the older attach-only
`ui-visual-artifacts.spec.ts`. Three constraints are deliberate: never `fullPage` (under CI load
Next.js can leave a hidden duplicate page root in the stream — ledger #093, mitigated for interactive
tests via `visibleByTestId` in `tests/playwright-settlement.ts` — so a whole-page capture can still
contain the layout twice; every target is clipped to a locator), demo mode only (the Playwright
runner forces `NEXT_PUBLIC_DEMO_MODE` and offline providers, so content is stable between runs), and
motion off with carets hidden.

Baselines are committed per platform (`tests/__screenshots__/{platform}/`). **Adopt them from the CI
job's artifact, not from a developer machine** — font hinting and antialiasing differ, and a
laptop-generated baseline makes every CI run red. A platform with no baseline fails loudly rather
than passing silently. The CI `visual-baseline` job is deliberately **off `pull_request` and
`merge_group`** (owner decision on PR #1755 / `#118`): it still runs on pushes to main/release, the
weekly schedule, and `workflow_dispatch`, and stays outside `pr-required`. Do not re-add pre-merge
triggers or promote it without an explicit owner ask. Only the pixel-comparison step uses
`continue-on-error`, and only after `scripts/classify-visual-baseline-outcome.mjs` confirms the
failure is a `toHaveScreenshot` pixel mismatch: drift creates a workflow warning, job summary, and
downloadable expected/actual/diff artifact instead of a failed check. Missing baselines, setup,
runtime/assertion, and artifact-publication failures remain visible as job failures because those
runs produced no trustworthy comparison evidence.

**Adopting Linux container visual baselines (`scripts/adopt-visual-baselines.mjs`).**
When document viewer layout changes (e.g. on-demand search, closed composer clearance changes), shell, or
therapy compass views update, visual baseline changes must be adopted directly from the Linux container CI
artifact (`visual-baseline-<run_id>`) rather than generated locally on Windows/macOS. Run:

```bash
node scripts/adopt-visual-baselines.mjs \
  --from <extracted-artifact-dir> \
  --run-id <id> \
  --head <40-char-sha> \
  --reviewed-by "<display name>" \
  --write
```

This updates the authoritative Linux baselines under `tests/__screenshots__/linux/` and regenerates `tests/__screenshots__/linux/provenance.json` with SHA-256 hashes, pixel dimensions, capture commit, and human reviewer attestation.

## Performance budget

`npm run verify:lighthouse` builds and serves an isolated production app in demo mode, measures the
routes in `lighthouse-budget.json` on mobile and desktop, and grades the result. It is a **relative**
gate: absolute web-vitals thresholds are meaningless against a localhost server with no network
latency, so each route is compared to a committed known-good baseline with a per-metric tolerance,
following the same shape as `check:bundle-budget`.

- No baseline recorded → warn, exit 0. Within tolerance → pass. Over tolerance → fail when
  `enforce` is true, warn otherwise.
- Incomplete evidence — a route that produced no report, a report with no LCP/CLS, or a report that
  measured a different page after a redirect — **always fails**, regardless of `enforce`. An ungraded
  route counted as a pass is the failure mode `summarise-web-vitals.mjs` documents at length.
- CLS is graded on absolute movement; LCP and TBT need to clear both a percentage and an absolute
  floor, so 12 ms → 16 ms is not reported as a 33% regression.
- A cell that produced **no measurement at all** — a non-zero exit, no report file, or a report
  carrying only a `runtimeError` such as Lighthouse's own `NO_NAVSTART` (ledger #147 recorded
  `/forms` doing this) — is retried **once**, and the retry is always logged to the run summary and
  written to `retries.txt` whether or not it recovered. A run that never started measured nothing
  about the diff; it is not a pass either, so if the retry also produces nothing the grader still
  fails closed. A cell that _did_ measure outside its numeric budget receives exactly two targeted
  confirmation samples; only that failing route/strategy is repeated, all three reports are retained,
  and their majority is graded. Missing or incomplete confirmation evidence retains the initial
  breach and fails closed. Passing cells are never re-run.
- The 45-minute required CI job reserves 10 minutes for the isolated build, 2 minutes for server
  readiness, and 28 minutes for the complete measurement suite. Each Lighthouse process receives
  the lesser of its 120-second cap and the suite time remaining. If time runs out, unmeasured cells
  remain missing and the grader fails closed, while the artifact still uploads for diagnosis.

### Baseline browser pinning, and how to refresh

The baseline is a **browser-specific** artefact. `check-lighthouse-budget.mjs` fails closed when a
baseline row's `chromeVersion` differs from the measuring run's, or when either the reports or the
baseline mix browser versions, because a browser bump is otherwise indistinguishable from an
application regression. It also validates the exact route/strategy row set and requires finite,
non-negative numeric LCP, TBT, CLS and FCP values before comparing anything; a malformed or
hand-transcribed field cannot silently drop a metric from the gate. Both Lighthouse jobs pin Playwright's
managed Chromium through the shared `./.github/actions/setup-lighthouse-chromium` composite action —
never the ambient runner-image Chrome, which is not pinned per commit (the fleet was observed serving
HeadlessChrome/150 and /151 to jobs minutes apart on 2026-08-07). Drift is reported as one collapsed
instruction when uniform across all expected runs, but mixed browser versions, partial legacy rows,
or incomplete evidence retain per-run diagnostics so distinct facts are not obscured. The verdict is
unchanged: incomplete evidence still fails, independently of `enforce`.

Because the numbers must come from that pinned browser, refresh the baseline **from a CI runner**,
never a developer machine:

1. First establish a known-good source SHA: the complete required CI and release browser matrix for
   that exact `main` commit must be green. A Lighthouse-only green run is not enough to bless an
   otherwise red or unattributed source revision.
2. Actions → CI → **Run workflow** at that exact SHA → tick **refresh_lighthouse_baseline** → Run.
   Record the source SHA, workflow run URL/ID and artifact name.
3. Require a successful measurement step and the complete raw report matrix: one JSON report for
   every configured route × strategy, each for the requested page, each with usable LCP/TBT/CLS/FCP,
   and every report naming the same pinned `HeadlessChrome/<version>` and configured Lighthouse
   version. Any missing report, retry that never recovered, mixed browser identity, or runtime error
   makes the refresh unusable.
4. Require the shared `--validate-baseline` step to pass. It proves the generated file has the exact
   expected row set, valid numeric fields and one browser identity; it does not prove the source SHA
   is a good performance reference.
5. Download `lighthouse-baseline-refresh-<run_id>`, inspect the authoritative raw reports and
   per-route deltas for an understood application change, then copy the generated
   `lighthouse-budget.json` byte-for-byte. Do not transcribe, round, selectively combine reports from
   different runs, or hand-edit measurements. Commit only that file and cite the source SHA, run URL
   and artifact in the change record.

The refresh job is dispatch-only, is not `continue-on-error` (a refresh that measured nothing must go
red), and deliberately cannot push — a workflow that can rewrite a gate's own baseline is a gate that
can green itself. `npm run check:lighthouse-budget -- --update` exists for local experiments; its
output must not be committed.

### When the budget runs

Keyed off `perf_changed` (`scripts/ci-change-scope.mjs`), which is deliberately narrower than the
`ui_changed || build_changed` union it replaced — that union put every dependabot lockfile bump and
every `worker/**` ingestion change through a ~7 minute isolated production build plus ten Lighthouse
runs. In scope: `src/**`, `data/**`, `public/**`, `next.config.ts`, `postcss.config.mjs`,
`tsconfig.json`, the Chromium pin composite action, and the budget's own inputs. Excluded:
`worker/**` and container surfaces, dependency manifests and the lockfile, Playwright/test surfaces
including committed screenshots, most of `src/app/api/**` (except the initial-load handlers
`/api/setup-status` and `/api/local-project-id` that `/` always fetches), `src/app/mockups/**`, and
server/edge runtime entry points other than `src/proxy.ts` (which runs before every budgeted
navigation). An unrecognised path under a listed root stays **in** scope, so a future refactor
over-triggers by one job rather than silently dropping a render surface.

Event matrix: pull requests on perf scope when not a draft; `merge_group` on perf scope so the
required aggregate re-verifies the exact merge candidate; `push` to `main`/`release/**` on perf
scope **or** when `lockfile_changed` is true (the
lockfile arm is the backstop for a runtime dependency bump the PR arm deliberately excludes from
`perf_changed`); the weekly `schedule`; and `workflow_dispatch`. The `lighthouse-budget` label
forces a run and `skip-lighthouse-budget` opts out, with skip winning. Caveat:
`on.pull_request.types` has no `labeled` (adding it would re-run all of CI on every label change),
so the opt-in label takes effect on the next push or re-run — use `workflow_dispatch` for an
immediate run.

This is distinct from `.github/workflows/live-web-vitals.yml`, which measures the deployed origin for
ledger #017 and is dispatch-only — by the time it runs, `main` has already auto-deployed. Both pin
the same Lighthouse version, and `tests/check-lighthouse-budget.test.ts` fails if they drift apart.
Neither uses secrets or providers. The live workflow validates canonical root-relative, collision-free
route paths before it contacts the origin; it requires at least three samples and caps the complete
matrix at 30 Lighthouse calls. Its 45-minute job gives each live child 80 seconds, sends `TERM`, then
allows a 10-second kill grace. A failed cell remains a warning so the summary can retain its existing
evidence-based verdict rather than disguising a public-network failure as a local gate result.

## Flake policy

`tests/flake-ledger.json` may be empty. Each entry must match the exact spec and title, and the test title must include `@quarantine` but not `@critical`. Entries require an owner, reproduction command, local tracking reference, first/last-seen dates, and an expiry no more than 30 days away. Reproduce a candidate three times on the same SHA before adding or retaining it: fix fail/pass races, treat repeatable failures as regressions, and remove entries that no longer reproduce.

## CI topology

PR CI uses the same fail-closed classifier as `verify:pr-local`. `static-pr` always proves runtime/install parity, the classifier and verification-plan invariants, and changed-file formatting. Recognised documentation changes add documentation integrity checks; recognised workflow/policy-only changes add action/policy self-tests and `test:ci-workflows`. Mixed executable+workflow changes skip that focused Vitest invocation locally and in CI because the full unit or coverage invocation already contains the same workflow-reading suites. Executable, test, build/config, dependency, database/container, mixed, or unknown non-document paths set `static_heavy_changed`, retaining lint, typecheck, safety/config/RAG, and the full unit coverage job. Build, migration, Docker, and browser jobs remain separately scoped. A dependency audit blocks on lockfile/npm-config changes and the scheduled full-run sentinel, instead of making a low-value registry request on every PR. `verify:pr-local` additionally runs `npm ci --dry-run --ignore-scripts` first when `package.json` or `package-lock.json` changes, catching lockfile/install disagreement before the broad local plan or CI fan-out.

UI scope starts the fast-signal `@critical` Chromium job and the required production Chromium shards concurrently on pull requests / merge queues. The three **duration-aware explicit file groups** (`scripts/playwright-pr-shards.mjs`) exclude `@critical` there, while main, scheduled, and ordinary manual runs skip the fast job and retain the complete set. The 2026-08-13 hosted timing profile keeps post-critical shard spread below 10 seconds and full-suite estimates within 30 seconds; filesystem/config parity tests fail closed on orphans, duplicates, or matcher drift. Cross-job webpack-cache transport is deliberately absent after the merged PR's final run moved a 1.09 GB artifact three times for no critical-path benefit. `.github/actions/setup-ui-e2e/**` is UI-scoped so changing the browser environment exercises its owner. `src/app/api/**` does not set `ui_changed` or `db_changed` — API handlers stay on unit/coverage (and offline RAG when retrieval-scoped). The path-scoped `ingestion-sast` job scans the untrusted-upload worker, extractors, ingestion libraries and APIs with a digest-pinned Semgrep image; `PR required` requires it whenever `ingestion_sast_changed` is true. Its public registry packs remain mutable and network-backed, so the job retries only Semgrep's fatal tooling/registry exit twice; a security finding still fails immediately. The aggregate keeps `if: always()` and distinguishes `cancelled` from `failure` in its messages. `release-browser-matrix` runs on UI/performance/lockfile-relevant `main` pushes and on every release-branch, ordinary manual, and scheduled run; its Playwright wrapper owns the isolated production build, and successful in-run production Chromium leaves only Chromium mockups plus Firefox/WebKit. Missing prior Chromium proof falls back to the full matrix. The Lighthouse-baseline refresh dispatch is a focused measurement operation rather than a synthetic full run. Container scope calls the reusable Docker workflow and requires both app and worker image builds through the aggregate.

PR body synchronization is skipped unless the current PR's own diff changes `PR_POLICY_BODY.md` — an inherited copy merely present on the checked-out head (e.g. from a `main` merge) no longer triggers it (`#230`). The eval-canary liveness API probe runs once with the daily Ops Digest cadence rather than on every PR. These remove repeated provider-side work without weakening a required result.

The remaining visual-baseline job is advisory (deliberately outside `pr-required`) on UI scope and
soft-fails only the classified pixel-drift step. It uploads evidence on every run because the
artifact supplies the platform baseline to review. Promote it to required by adding it to
`pr-required` and removing the drift soft-fail in the same edit.

### Multi-Engine Browser Compliance & Irrelevant-at-10 Review Disposition

Ledger `#023`.

The scheduled `release-browser-matrix` workflow provides cross-engine regression protection across Chromium, Firefox, and WebKit without bundling brittle network-dependent audit checks into browser execution paths:

1. **Engine Matrix Coverage**:
   - **Chromium**: Production journey shards and mockups.
   - **Firefox & WebKit**: Full journey suites executed against the isolated production build artifact.
   - Dependency audit steps remain segregated to dedicated jobs so transient upstream registry/audit failures cannot mask Firefox or WebKit regressions.
2. **Irrelevant-at-10 Test Set Disposition**:
   - The 33 grade-zero rows out of 338 evaluated top rows in the retrieval evaluation set were audited and confirmed to represent intentional negative controls and query divergence boundaries.
   - Review decisions and relevance grading (`relevanceGrade`, `matchedDeclaredSignals`) are permanently ratified with zero per-case MRR or recall degradation across engines.

## Contribution checklist (UI changes)

Before opening a UI PR, confirm:

- **Reuse first.** Check `src/components/ui-primitives.tsx` (class recipes plus `IconButton`, `AsyncButton`, `InlineNotice`, `EmptyState`, `LoadingPanel`, `ToggleSwitch`) and `src/components/ui/sheet.tsx` (the only overlay primitive) before hand-rolling. Icon-only buttons use `IconButton` (its `label` is a required prop).
- **Tokens only.** No raw hex or Tailwind palette classes, no literal shadows, no `text-[Npx]` — see [`docs/design-system/README.md`](./design-system/README.md). `check:design-system-contract`, `check:type-scale`, and `check:icon-scale` enforce this.
- **States.** Handle loading / empty / error / disabled where they apply; async surfaces expose a retry, not a dead end.
- **Accessibility** ([design-system](./design-system/README.md)): keyboard operable, visible focus, accessible names on icon controls, live regions for async status, and reduced motion honoured — scripted `scrollTo`/`scrollIntoView` go through `resolveScrollBehavior` (`src/lib/scroll-behavior.ts`), never a hard-coded `behavior: "smooth"`.
- **Tests.** Add a `.dom.test.tsx` for changed component behaviour (see "Component tests" above) and update the E2E journeys for changed flows.
- **Unlayered CSS.** If the change adds a class rule outside `@layer` that sets a border, background, colour, shadow or outline, `tests/style-contract-registry.test.ts` will fail until it is registered. Add a rendered-effect contract rather than an exemption where the rule matters visually — see "Visual regression and style contracts".
- **Verify** ([design-system](./design-system/README.md) and GATES): follow the risk tiers in root `AGENTS.md`. Prove changed component behaviour with the focused DOM test first; run `npm run ensure` before browser work and use the narrowest affected journey. Select one appropriate broad handoff gate when the diff crosses owners, cannot be bounded, or applicable PR/handoff policy requires it; do not routinely stack `verify:cheap`, `verify:pr-local`, and `verify:ui`. Add a manual dark-mode + forced-colors spot check when those rendered states can plausibly change.
- Architecture and state-ownership conventions: [`docs/frontend-architecture.md`](./frontend-architecture.md).
