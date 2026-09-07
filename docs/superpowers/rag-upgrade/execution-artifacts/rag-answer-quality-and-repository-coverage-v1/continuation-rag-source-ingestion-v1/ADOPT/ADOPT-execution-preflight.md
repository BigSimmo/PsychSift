# U02/U03 Windows execution preflight

Read-only inspection on 7 September 2026. No repository edits, tests, installs, hooks, commits, provider calls, SQL execution, workers, publication, or protected/unrelated untracked enumeration were performed. This report is the only authored file.

## Result

The installed Windows tools can extract Task 2/3 and produce repository-owned immutable commit-range packages without changing the parent manifest or receipt schema. Continuation acceptance needs the approved manual evidence overlay, not parent `--resume U03` or `--accept-phase C01` commands. Default test bookkeeping, the commit hook, and U03's migration-role CLI violate the protected-untracked inspection boundary; use the narrowly recorded bridges below before execution.

## Identity and inspected inputs

- Worktree: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Branch: `codex/rag-local-build-20260822`.
- Observed HEAD: `2dad59e0ee26ab6586f6a49ec1dfdb993d1f9ad7`.
- `git status --short --untracked-files=no` showed 20 modified tracked documentation paths and no staged changes. The controller reported 26 documentation files including new evidence; this preflight deliberately did not enumerate untracked files to reconcile that count.
- Read root AGENTS.md, canonical `sdd-execution.md`, the continuation plan's global constraints, Task 2/3 and evidence layout, U02 audit-correction brief, installed Superpowers 6.3 SDD skill/helpers, receipt writer, package scripts, Git hooks, and narrowly relevant gate implementations. Tracked AGENTS inventory exposed no nested applicable AGENTS under these owners.
- The correction brief is still a proposed packet in the inspected snapshot; the parent's current user authorization and newly authored execution-authority record must be bound into its dispatch. Do not treat historical pause text or proposed fields as executed evidence.

## Tool availability

Observed version commands: Node `v24.19.0`, npm `11.17.0`, Git `2.55.0.windows.2`, Git Bash `5.3.15`, Deno `2.9.4`. These satisfy the documented major/minor runtime floors. `node_modules` exists; installed-lock parity was not run and dependencies are not certified by directory presence.

PowerShell resolves bare `bash` to `C:/WINDOWS/system32/bash.exe`. Explicitly invoke `C:/Program Files/Git/bin/bash.exe`; it resolves awk, Git, Node and npm, and its `test -x` reported `TASK_BRIEF_EXECUTABLE` for:

`C:/Users/joshs/.codex/plugins/cache/openai-curated-remote/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief`

The whole session's prerequisite skill capability check remains controller-owned. This bounded preflight inspected SDD only and did not execute its workspace helper.

## Extraction and canonical packages

The installed `scripts/task-brief` matches `^#+[ \t]+Task[ \t]+[0-9]+`, outside triple-backtick fences. Therefore continuation `## Task 2:` and `## Task 3:` are supported directly. The canonical contract's description of an exclusively `### Task N:` boundary is narrower than this installed implementation; no heading rewrite is necessary for U02/U03.

Extraction ends at the next numeric Task heading, not any arbitrary heading. Task 2/3 both have subsequent Task headings, so their boundaries are clean. U02's correction brief has no numeric Task heading and cannot itself be passed as a Task plan. Smallest explicit bridge: extract continuation Task 2 into a new uniquely named correction task-body artifact, supply the audit-correction brief as the explicit scope amendment, and bind both hashes plus global constraints. Do not overwrite the accepted original `U02-brief.md`. If a single extraction source is required, author a new reviewed one-task correction plan with `### Task 2:` and no unrelated tail; this is continuation evidence, not a parent manifest/schema change.

For U03, extract Task 3 directly after its updated writer inventory, literal gates and base are frozen. Supply global constraints separately; the extractor does not prepend them. Use an explicit output path with a precreated parent directory. Otherwise the installed helper calls `sdd-workspace`, which creates ignored scratch and writes `.superpowers/sdd/.gitignore`.

Proposed PowerShell invocation shape, with literal output substituted before execution:

```powershell
& 'C:/Program Files/Git/bin/bash.exe' 'C:/Users/joshs/.codex/plugins/cache/openai-curated-remote/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief' 'docs/superpowers/plans/2026-08-31-ingestion-first-continuation.md' '3' '<new U03 brief path>'
```

`npm run plans:rag:receipts:check -- --write-review-package BASE HEAD OUT` maps directly to `node scripts/check-rag-phase-receipts.mjs`. It requires literal lowercase 40-character SHAs and an output `.diff` beneath `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/`; nested continuation/U02 and U03 paths are permitted. It creates parent directories and writes a canonical full-index binary-capable diff with extended context, no external diff/textconv, and an exact reverse commit list. It uses committed blobs, not uncommitted controller documents. The early writer branch does not validate a continuation against parent phases.

The writer does not supply immutability by refusing overwrite or by itself prove ancestry/acceptance. Before writing, confirm the output filename is new, both SHAs resolve, BASE is ancestor of HEAD, and the exact commit list contains only authorized unit commits. Preserve TASK_BASE across corrections and give every attempt a unique filename. Use `--print-artifact-hash <path>` and manual continuation records to bind briefs, reports, complete original-range packages and review outcomes. Never use the installed generic review-package or its correction-only re-review policy in place of the stronger repository full-original-range rule.

## Protected-untracked bridges

### Focused tests

`scripts/run-vitest.mjs` normally consults receipts, then the arbiter, then acquires the repository coordinator lease and supplies `offlineTestEnvironment`. `scripts/gate-receipts.mjs:231-283` enumerates untracked paths and hashes their contents. `scripts/gate-arbiter.mjs:561` may call `git status --porcelain`; its CLI has no `--files` selector (`main` passes only the gate to `arbitrate`). Do not call default arbiter/receipt paths in this worktree.

Existing process-local settings `GATE_RECEIPTS=off` and `GATE_ARBITER=off` return before those scans and disable outcome bookkeeping. They force real conservative execution rather than skip tests; the coordinator and offline test environment remain intact. Record the explicit safety override and actual focused results. Do not set `CI`, bypass the test wrapper, or alter locks. Restore previous environment values in `finally` after each scoped invocation. With both settings applied, `npm run arbiter -- 'vitest(selected)'` can print the conservative RUN/off verdict without scanning; this is an override verdict, not a yield-derived result.

U02 initial authored regression, exact RED/GREEN selector:

```text
node scripts/run-vitest.mjs run tests/document-enrichment.test.ts -t "round-trips multi-item source-anchored summaries from the real producer"
```

Expected product RED is the real two-item producer rejected with `source_anchored_summary_profile_overview_invalid`; missing-test/module/lease errors do not qualify. Final affected selector:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
npm run check:edge:functions
```

The Edge script invokes Deno check, not a provider client, but may resolve uncached dependency imports. Deno is present; future output must demonstrate real checking, not its local exit-0 missing-Deno skip. Respect the no-connected boundary if uncached acquisition is encountered. No broad Answer suite is needed for the bounded F02 correction; the historic failed offline evaluation is not renewed as an exception or called passing.

U03's plan selector is:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-behavior.test.ts tests/worker-run-loop.test.ts tests/worker-runtime-control.test.ts tests/worker-row-contract.test.ts tests/check-indexing-contract.test.ts
npm run check:edge:functions
npm run check:migration-role
node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/audit.json
```

Bind any audit-amendment additions into a new U03 brief before RED. Corpus audit is explicitly fixture-backed and refuses live reads, but writes its output. SQL schedules, concurrency proof, drift regeneration requiring a database, provider parity, production-readiness and activation remain outside this preflight and outside current execution authority.

U03 `check:migration-role` cannot run unchanged: `repositoryEntries` at lines 102-117 performs broad tracked/untracked enumeration and reads every file before validation filters. Smallest manual bridge uses its exported `validateMigrationRoleEntries` with a prefiltered list of tracked guarded files and an explicit allowlist of new task migration paths, preserving the immutable historical migration and required hash. Record this as a scoped equivalent, not as the literal CLI passing. Do not add a generic checker framework. If an equivalent cannot be reviewed, retain the gate as blocked rather than inspect protected files.

### Local commits

`core.hooksPath` is `.githooks`; only pre-commit and pre-push are present. Pre-commit lines 8-10 provide `SKIP_DOCS_SYNC_HOOK=1` before all enumeration. This is the smallest commit-only existing bypass; use a process-local value for the authorized `git commit`, restore it immediately, and record the reason. No `--no-verify`, hook config change, or push-guard bypass is needed.

Without that flag, pre-commit always executes `git ls-files --others --exclude-standard`, even for metadata-only commits. Source-lib changes trigger `npm run docs:check-index`; test changes trigger `npm run design-system:adoption:update`. Source-lib/test U02 changes do not trigger sitemap or scripts inventory generation unless scope expands. Adoption validation also contains an untracked scan in its visual-baseline source-binding branch, so do not blindly run that generator as the manual substitute.

Before commit, inspect exact staged paths and diff, confirm no unrelated documents/evidence are included, run the permitted focused checks, and check module index coverage where src/lib changes require it. For U02, explicitly inspect added/changed imports and confirm no design-system component/root adoption edge or visual-baseline source changed; record that narrow manual assessment instead of claiming adoption generator PASS. If an adoption edge changed, obtain an exact privacy-safe generated-output check before commit. Product commits exclude process artifacts; subsequent manual evidence/checkpoint commits follow the continuation authority. Pre-push is irrelevant because publication is prohibited.

## Observed execution routing

Tool-level child identity is `/root/execution_preflight`. It does not by itself echo actual model or effort. Exact child local session metadata was located using the child ID only, without searching unrelated session contents:

`C:/Users/joshs/.codex/sessions/2026/09/07/rollout-2026-09-07T18-41-38-01a07b75-937c-7842-abf9-4cb0581fe39b.jsonl`

Read-only shared FileStream access exposed only selected `session_meta` / `turn_context` fields:

- session id: `01a07b75-937c-7842-abf9-4cb0581fe39b`
- provider: `openai`
- parent: `01a07b47-4623-7e90-825a-ec25116b8531`
- agent path: `/root/execution_preflight`, nickname Volta, role explorer, depth 1
- turn-context model: `gpt-6-astra`
- turn-context effort: `high`

This verifies the locally recorded resolved child configuration, not backend/provider execution attestation. It is stronger than inferring actual from requested routing. No xhigh execution is demonstrated by this child's record. Each reviewer/writer must supply its own observed record; missing fields remain unavailable. The selected CODEX_MODEL and CODEX_REASONING_EFFORT environment variables were unavailable and cannot substitute for this evidence.

## Remaining acceptance limits

This preflight establishes source-level compatibility and tool availability, not extracted-artifact output or successful future gates. Freeze and hash the controller's adopted amendment/authority first, commission independent xhigh review under its separately observed identity, then dispatch only the accepted U02 correction. U03 requires its own frozen brief and reviewed manual acceptance bridge. No parent manifest, schema, accepted receipt, or original U02 artifact needs rewriting.
