# Verification Gates

_Updated 2026-10-01 - distinguish scoped CI selection from completed verification; Documentation owns._

<!-- BEGIN:verification-gates -->

## Gate selection

- PR and merge-queue CI summaries include a **PR test recommendation** derived from the same event base/head and browser planner as local work. It names the relevant check groups and recommends complete owning browser specs, escalating shared or unknown browser inputs to the full local gate. The recommendation step runs no tests and does not narrow required CI. Draft summaries explicitly distinguish deferred checks from merge readiness.
- Runtime manifests, Next/CSS/TypeScript configuration, shared browser hooks, theme state and the browser client/store are browser inputs even when no component changes. A build alone does not prove browser behaviour. The production-spec inventory guard catches configured browser tests missing from the selector.
- The post-merge browser matrix uses one Chromium runner, three Firefox partitions and two partitions for each WebKit project, retaining one worker and zero retries per runner. Its primary path excludes only projects already proved by the production shards; mobile WebKit and standalone PWA still run. This is test partitioning, not selective omission. The previous three-way WebKit engine split assigned a whole project to each runner and both mobile projects timed out. The revised within-project partitioning retains every test; its hosted speed and runner-minute effects still need measurement. Large test files can still produce uneven partitions.
- Firefox/WebKit reuse the successful production browser build from the same workflow run. Chromium builds separately because its mockup-enabled public flag is compiled into the app. A skipped producer retains the normal build path; a failed producer or missing expected artifact must not silently become reused proof. Browser download caches are isolated by engine so one engine cannot fill an immutable shared key with an incomplete archive set.
- Unit coverage runs in two partitions. Their required aggregate rejects any failed or missing partition and merges the blobs using the original coverage configuration and thresholds; partial coverage is never a passing coverage verdict.
- Rerunning CI replaces same-run coverage/build and operator-consumed artifacts under stable consumer names, while diagnostic and timing artifacts include the run attempt so earlier evidence survives. A failed-job rerun can still download a successful producer's artifact from an earlier attempt of the same run.
- Successful production and release UI partitions retain their JSON reports for seven days so future balancing can use current per-file timings. Do not treat historical zero-duration entries in the shard profile as measurements or automatically remove tests because they have recently passed.

- **Verification principle:** run the smallest check capable of detecting a plausible regression introduced by the current diff. Before starting a check, identify the failure class it covers, whether a successful check already covered that class, whether a cheaper focused check offers comparable detection, and whether the incremental confidence justifies the runtime, resource use, and repository-lock contention. If there is no plausible changed failure path, do not run the check.

| Tier                    | Use when                                                                                                                            | Default evidence                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0 — No test command     | Explanation, planning, prompt writing, read-only inspection, or no repository change                                                | No test, build, server, or baseline command                                                                          |
| 1 — Static/focused      | Documentation, comments, metadata, or narrow non-behavioural configuration                                                          | Relevant format, docs, syntax, generated-file, or diff check only                                                    |
| 2 — Focused behavioural | A localized helper, component, contract, or test change                                                                             | Directly affected unit/DOM/contract test; add typecheck only when the edit can affect compilation or a type contract |
| 3 — Domain gate         | Shared UI/routing, dependencies, security, privacy, RAG, clinical output, production configuration, or another cross-cutting domain | The smallest applicable repository/domain selector, focused journey, or contract gate                                |
| 4 — Broad handoff       | The diff crosses multiple subsystems, cannot be bounded reliably, or the task explicitly requires PR/release confidence             | One appropriate broad gate, selected rather than stacked by default                                                  |

- Do not run a broad baseline routinely before localized work, and do not select `verify:cheap` merely because a change is described as “non-trivial.” `npm run verify:cheap` is the ordinary offline gate (`check:installed-lock-parity` + lint + typecheck + test). Use `npm run verify:full` when cross-module risk warrants the broad static set (41 static gates, then lint + typecheck + test). Use `npm run verify:pr-local` when a change is ready for PR handoff: it classifies the changed paths, runs focused documentation/workflow contracts for recognised low-risk scopes, and fails closed to lint, typecheck, the full unit suite, RAG fixture validation, and relevant build/domain gates for executable or unknown scope. If the diff has not changed, do not run `verify:cheap` first merely to repeat the same coverage.
- Do not stack focused tests, full tests, typecheck, lint, build, and browser checks unless each catches a distinct plausible regression. Do not rerun an unchanged successful gate. Since 2026-08-21 that last rule is enforced rather than remembered: `scripts/gate-receipts.mjs` memoises `lint`, `typecheck` and non-coverage Vitest runs against a content signature, so an identical re-run on unchanged content exits 0 immediately instead of repeating the work. A reused receipt must be reported as "reused receipt from <time>", never as a fresh run; use `GATE_RECEIPTS=refresh` when fresh evidence is the point, `GATE_RECEIPTS=off` to disable, and `npm run receipts` to inspect the store. Receipts are local-only and never reach CI — `CI` being set disables reuse outright, because GitHub remains the authoritative merge gate. Do not memoise `build` or `test:coverage`; their artefacts are read by later gates. Contract: `docs/process-hardening.md` and `tests/gate-receipts.test.ts`. A deliberately skipped low-yield broad gate is not automatically verification debt; report the skipped check and its risk-based reason concisely.
- A fast-fail subset may precede a broader required gate only when the later gate excludes that subset for the same event; retain a fail-safe full path whenever the subset is skipped. Likewise, do not pre-run a build, install, or server setup that the selected wrapper performs itself. Guard these disjoint/fallback rules with workflow contract tests so a later edit cannot silently restore duplicate work or create a coverage hole.
- Use dry-run selectors before expensive gates when scope is uncertain. `npm run verify:pr-local -- --dry-run --files <comma-separated paths>` inspects PR-local selection without running commands. The broader `--extended` plan is dry-run only unless explicit approval is reflected by `ALLOW_EXTENDED_PR_LOCAL=true`.
- CI uses the same fail-closed scope model: recognised docs and workflow/policy-only changes run focused contracts; executable product/test/config, dependency, database, container, RAG, security-sensitive, mixed, or unknown paths retain the applicable heavy jobs. Do not broaden a path trigger or restore an always-on heavy job without evidence that the focused route misses a realistic failure class. Scheduled drift/release checks and the always-reporting `PR required` aggregate remain safety backstops.
- Let the repository run coordinator control cross-worktree verification. It permits at most two focused Vitest/read-only typecheck leases from different worktrees; full Vitest, coverage, lint, build, Playwright, and live-provider tests remain exclusive. Do not install while a repository test, build, lint, typecheck, or server command is active. Avoid aggressive short-interval polling, and do not repeat an unchanged full gate after it passes.
- **Running several Claude Code sessions at once is safe only when each session works from its own worktree (`newtask`) and no two sessions target the same branch or pull request.** Inside that boundary the coordinator above already lets safe work overlap — two sessions can hold a focused-test/typecheck lease together, and heavier gates (lint, build, full tests, Playwright) simply queue behind each other rather than colliding. Never work around a busy/queued coordinator message by forcing or deleting lock state; wait, or narrow the gate. The single biggest thing that makes other sessions wait is one session holding a broader gate than the change needs, so keep to the narrowest tier in the verification pyramid above.
- For UI, frontend, browser, routing, styling, reduced-motion, or forced-colors behaviour changes, run `npm run ensure` before browser work and prove the changed owner or journey first. Use `npm run verify:ui` when shared UI foundations changed or PR/handoff policy requires the complete Chromium gate, not as an automatic addition after focused proof. For phone-chrome changes, run `npm run verify:phone-chrome` first: it checks installed-lock parity, selects the affected browser/PWA owners and exact journeys, and adds `verify:ui` last only when shared chrome foundations make the broad gate necessary. Inspect uncertain scope with `-- --dry-run`. Chromium evidence does not close physical Safari or installed-PWA acceptance gaps.

- For explicit release confidence, use `npm run verify:release` once; this includes the full Playwright project set and retains all provider-approval requirements. Ordinary local completion or PR handoff does not by itself authorize or require this release gate.
- For clinical ingestion, answer generation, source governance, privacy, production-readiness, or environment changes, run the smallest relevant domain check plus `npm run check:production-readiness`.
- For pull requests that touch ingestion, answer generation, search/ranking, source rendering, document access, privacy, production env, or clinical output, complete the clinical governance preflight in `.github/pull_request_template.md`.
- Track known verification debts and staged process improvements in `docs/process-hardening.md` instead of relying on chat-only memory.

## Do not pay twice for the verdict GitHub is about to reach

`check:gate-manifest` checks that each local `verify:full` gate has a declared CI command
(or an explicit mapping); it reads `verify:full:internal`, not `verify:cheap:internal`.
It does not evaluate event, draft or scope conditions, observe job results, or prove that a
particular run repeats local verification. Inspect the selected workflow jobs separately.
`gate-receipts.mjs` closes the local-versus-local half of that: it memoises `lint`,
`typecheck`, and non-coverage Vitest against a content signature, so an identical re-run
on unchanged content exits 0 immediately instead of repeating the work.

```bash
npm run receipts          # inspect the receipt store
npm run receipts:clear    # empty it
```

A reused receipt must be reported as "reused receipt from `<time>`", never as a fresh run;
use `GATE_RECEIPTS=refresh` when fresh evidence is the point, `GATE_RECEIPTS=off` to
disable. Receipts are local-only and never reach CI — `CI` being set disables reuse
outright, because GitHub remains the authoritative merge gate. Do not memoise `build` or
`test:coverage`; their artefacts are read by later gates. Contract: `docs/process-hardening.md`
and `tests/gate-receipts.test.ts`.

This does not license skipping verification. It licenses not re-running the _same_ verdict
on content that has not changed. The smallest-correct-gate rule above still decides which
gate is right.

### The default for an ordinary PR push

**Run the narrowest gate that covers the diff, plus `npm run format`. Identify the heavy jobs
expected in CI and any policy-authorised local deferrals in the PR body.** CI is event- and
risk-scoped: `push` covers `main` and `release/**`; PR and merge-group base/head classify paths,
and individual jobs also apply draft and event conditions. Scheduled/manual runs with no
resolvable base conservatively select full scope; a Lighthouse-refresh dispatch has its own
focused scope. Selected or deferred checks remain pending until their completion is observed.
Skipped, missing or failed jobs are not passing evidence. Do not defer required local proof
on a claim that CI will repeat it when the job conditions do not establish that coverage.

This is not a licence to push unverified work. The narrow gate still has to cover the diff's
plausible failure classes — a two-file script change needs its own suites and `typecheck`, and a
shared-foundation change still needs the broad gate. What it forbids is reaching for the broad
gate because it is the familiar command.

Three traps, all observed in one session on 2026-09-25:

- **`verify:cheap` ran four times for changes of one script plus one test file.** Each run is
  ~8 minutes and 23,000 tests over 1,500 files; the diff never exceeded two files, and CI repeated
  the same suite for those pushes at the time. `npm run test:focused -- --files <the two suites>` plus
  `npm run typecheck` was the gate that covered it, and takes seconds.
- **Two of those four runs were spent re-running after `npm ci`.** The installed-lock-parity guard
  fails whenever `main`'s lockfile has moved, which is a dependency state to repair, not a reason
  to widen the gate. Reinstall, then run the narrow gate — not the broad one again.
- **Exit 0 with no output is not a pass.** A backgrounded gate whose log is still buffering looks
  identical to one that finished clean. Read the decisive line before reporting a verdict, and if
  the log is empty, the run has not reported yet.

In the PR body, name the focused gate and paste its decisive line, then list what you did not run
locally:

```
Expected in CI for this event/scope: <selected check groups and conditions>.
Deferred locally under existing policy: <checks and reason>.
Completed passing evidence: <exact revision, checks and evidence paths>.
Pending, skipped, failed or unobserved: <checks and status>.
```

Report only the groups applicable to this event and scope. The distinction lets a reviewer
see deliberate deferral without mistaking it for completed passing verification.

<!-- END:verification-gates -->

## The browser gate is narrowed, not deferred

`npm run verify:ui` is the most expensive run here - 646 Chromium tests, ~25 minutes.
Eligible non-draft CI runs select production browser jobs when `ui_changed` is true.
Each lane also requires its event conditions and successful prerequisites; drafts or
blocked prerequisites can leave browser scope unrun. Selected browser proof remains
pending until successful execution is observed, even when local focused proof passed.

Deferring it wholesale is not a safe lever — pushing a UI change with **no** browser
evidence is not a bet this repository takes. The lever here is a different one: run the
part of the suite the diff can actually break.

```bash
npm run plan:browser              # dry run: the level it chose, the specs, and why
npm run plan:browser -- --run     # execute that plan
npm run plan:browser -- --full    # force the whole suite
```

Four levels, and only the middle two are a saving:

| Level     | When                                                     | What runs                                                                              |
| --------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `none`    | no browser surface changed                               | nothing — CI skips Production UI for this scope too                                    |
| `changed` | a `ui-*.spec.ts` changed                                 | those specs, **complete** — never grepped, since the diff rewrote their own assertions |
| `focused` | changed UI source attributable to specs                  | the owning specs, complete                                                             |
| `full`    | shared foundation, unattributable file, or unknown scope | `verify:ui`                                                                            |

**Attribution is evidence, not a table.** A spec owns a changed file when both contain
the same literal — a `data-testid` the source renders and the spec asks for, or a route
the source defines and the spec navigates to. Component names are deliberately not
matched: a spec never names a component, so a match there would be a comment, and a
comment is not proof a journey covers the code.

**It fails closed.** A file with no owning spec, a shared foundation (`globals.css`, any
shared style root, the Playwright config, the runner, the shell/chrome coordinator set),
a browser-lane path it cannot classify, or a deleted file all escalate to the full suite
on their own — a bug here would cost an unrun journey, so the defaults point toward
running more, not less.

**The project is part of the selection.** `chromium` grep-inverts `@mockup` and
`chromium-mockups` collects only those, so a mockup spec run under `--project=chromium`
collects nothing and "passes" having executed no test. The planner reads both
`testMatch` patterns out of `playwright.config.ts` (rather than copying them, which
would drift) and routes each selected spec accordingly — `tests/ui-tools.spec.ts` holds
both kinds and gets both projects. A spec neither project collects escalates to the full
suite rather than producing a command that matches nothing.

**Coverage that rests on an unreadable precondition is reported as conditional.**
`ui-critical-fast` is guarded on `github.event.pull_request.draft != true`, which no
worktree can evaluate. On a draft PR CI skips the very job that makes narrowing safe, so
the planner prints those assumptions with the verdict instead of stating flatly that CI
will repeat the run.

Non-negotiable, and the reason the saving is allowed at all:

- **A narrowed run is not the UI gate.** Report it as "focused browser proof at level
  `<x>`, full suite left to CI" — never "verify:ui passed". `check:browser-test-plan`
  and `tests/browser-test-plan.test.ts` pin that wording in the runner itself.
- **CI is untouched.** The planner advises local work only; GitHub runs exactly what it
  ran before, and no required check may be weakened to save local time.
- **Dry run by default.** `--run` executes; nothing happens without it.
- **When CI will NOT repeat it** — a browser-lane change on a scope where the Production
  UI jobs are skipped — the planner says so and tells you to consider `--full`, because
  there the local run is the only browser evidence there will be.

Cloud sessions are told this at SessionStart by `.claude/hooks/testing-policy.sh`, which
is read-only, exits 0 on every path, and states the reporting rules alongside the
commands.
