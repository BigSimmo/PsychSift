# Focused tasks and continuation

_Updated 2026-10-01 - reusable briefs, continuation and private measurement; Documentation owns._

Open this page when launching or resuming a task. Keep it on demand; do not copy it into
always-loaded instructions. Use the existing [workflow planners](../productivity-workflows.md),
[verification policy](verification-gates.md), [allocation policy](smart-agent-allocation.md),
[reasoning rules](codex-reasoning-effort.md) and [review protocol](../codex-review-protocol.md).

## Focused task brief

```text
Objective/task ID: one observable original user outcome and its stable ID.
Repository/base: repository, worktree, branch and actual task-base SHA.
Scope/non-goals: owned paths, permitted changes and explicit exclusions.
Acceptance: behaviour, required checks and independent review evidence.

Follow current repository instructions and relevant domain rules. Inspect the
minimum context that establishes the failure and affected scope. Implement the
smallest coherent correction. Use existing selectors, coordination and valid
receipts. Broaden verification when policy or the failure class requires it.
Do not duplicate completed investigation, weaken gates or perform unrelated
refactoring. Stop when acceptance is evidenced or a precise blocker is reached.
Report changed files, check results, limitations and delivery state.
```

Before uncertain verification, inspect selection with
`npm run verify:pr-local -- --dry-run --files <comma-separated paths>`; browser work uses
`npm run plan:browser`. These plans are not passing evidence. Inspect the chosen commands
and hooks before execution. Keep selected, deferred, skipped, failed and completed checks
distinct. Report fresh runs separately from reused receipts; validate source, dirty/untracked
inputs, selector/command, lock/dependencies, toolchain, fixtures and environment identity.
Artifact-producing proof also requires the artifacts. Preserve the existing coordinator and
required domain/review gates.

## One continuation record

Update the task's existing canonical checkpoint or programme ledger; link it from handoffs
instead of starting another status board. If the task has none, keep one manual checkpoint
in the existing ignored `.local/workflow-evidence/` area, named by objective ID. Planner
JSON files and primary logs remain supporting evidence, not competing status records.
Record:

```text
Objective/task ID | repository/worktree/branch/base/HEAD
Owned files and diff hash | constraints and delivery authority
Completed decisions and rejected hypotheses
Checks/receipts: input identity, result, fresh/reused, evidence path/hash
Unresolved blocker | next exact action
```

Retain primary evidence by accessible path and hash; a summary does not replace it.
Resume with: "Read this checkpoint and applicable instructions. Validate relevant drift
and receipt inputs. Resume from the next action. Reopen a completed investigation only if
evidence, acceptance criteria or relevant inputs changed."

Carry unresolved cross-session work through the existing [issue workflow](repository-skills-and-issues.md);
record completed reviews through the existing review ledger rather than duplicating either.

## Private measurement

Use a suitable existing private ledger. Otherwise add a small manual measurement section to
the same ignored checkpoint. Actual account/session observations stay outside tracked Git
content; no collector, dashboard, account scraping, paid replay or model experiments.
Record these fields only from ordinary task telemetry already available:

```text
Original objective ID | repository/base/result revision | task class
Requested routing | observed routing and source | acceptance status
Observed credits and source | retries/child sessions/reviews
Checks run/reused | elapsed time | human corrections
Delivery: local completion, user acceptance, publication, merge, deployment
```

Missing values are `unknown`, not zero. A requested route is not observed execution;
local completion is not user acceptance or deployment. For a defined comparable cohort,
include all work, failures, abandoned attempts, reviews and integration under the original
objective. Divide observed total credits by accepted original objectives; with none accepted,
the ratio is undefined. Incomplete credit observations cannot establish an observed total.
Deduplicate cumulative telemetry and overlapping account intervals. Keep token estimates,
external cash and local/CI compute separate from observed credit debits.

Expected benefits are less repeated context, investigation and duplicate verification;
they are unmeasured until comparable telemetry supports them. Document bytes are a proxy,
not loaded-token or billing proof. Historical balances and task targets are planning context,
not current balances or promised savings. This workflow changes no global Codex settings.
