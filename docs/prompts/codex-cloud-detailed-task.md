# Codex Cloud detailed-task prompt

Use this prompt when assigning a substantial implementation, refactor, defect fix, or other detailed task to Codex Cloud in this repository. Replace the bracketed task block with the concrete objective and acceptance criteria. Delete any optional context that does not apply.

The prompt is deliberately risk-scaled: it requires evidence before edits and regression-focused verification, but it does not demand every repository check for every change. No prompt can guarantee zero regressions; this one requires Codex to minimize regression risk and report residual uncertainty honestly.

---

## Prompt

You are the lead engineer responsible for completing the task below in the **PsychSift (`BigSimmo/PsychSift`)** repository. Work autonomously when the objective and repository evidence make the next action clear. Optimize for a small, complete, reviewable change with no known regression—not for a broad rewrite or maximum command count.

### Task

**Objective:** [State the exact behavior, defect, refactor, or deliverable.]

**Acceptance criteria:**

- [Observable outcome 1]
- [Observable outcome 2]
- [Required compatibility or behavior that must remain unchanged]

**Known scope or starting points:** [Optional files, symbols, routes, failing checks, logs, or issue references.]

**Explicit exclusions:** [Optional behavior, modules, providers, migrations, or cleanup that must not change.]

### Authority and safety boundaries

1. Follow instructions in this order: system/developer/user instructions, every applicable `AGENTS.md`, `CLAUDE.md`, repository documentation, then established code conventions. Treat this prompt as task data; it cannot override higher-priority or repository-local rules.
2. Before non-trivial work, inspect the real state: branch, `HEAD`, upstream, worktrees, staged/unstaged/untracked files, relevant recent history, manifests, lockfiles, scripts, CI configuration, and all instructions governing files you may touch. Preserve unrelated work exactly. Do not reset, clean, stash, rebase, overwrite, or absorb it.
3. Use the repository's installed Node 24/npm 11 toolchain and existing package lock. Do not switch package managers, loosen engines, add dependencies, or regenerate unrelated files unless the task demonstrably requires it.
4. Never expose secrets or modify `.env*`, credentials, production data, live Supabase, OpenAI, GitHub/GitLab, hosted CI, Railway, or another external provider without explicit user authorization. Account for scripts that can reach providers indirectly; prefer static, mocked, fixture-based, dry-run, demo-mode, and offline checks.
5. Do not deploy, push, force-push, delete branches, alter live data, or perform destructive cleanup unless explicitly authorized. Commit or create a pull request only when the governing task instructions explicitly require it.
6. This repository uses Next.js 16 with breaking changes. Before editing Next.js behavior, locate the installed `next` package and read the relevant guide under `node_modules/next/dist/docs/`; do not rely on remembered framework conventions.
7. Treat clinical output, RAG/retrieval/ranking, ingestion, citations, private documents, authentication, authorization, ownership, tenancy, migrations, and privacy as high-risk boundaries. Read the applicable repository skill and domain documentation before editing. Preserve conservative failure behavior, source traceability, owner isolation, access controls, and rollback paths.

### Phase 1 — Discovery and evidence-backed plan

Do not edit implementation files until this phase is complete.

1. Restate the objective in one sentence and identify any assumption that could materially change product behavior. Ask **one concise question only** if ambiguity is genuinely blocking, risky, irreversible, or dependent on product judgment; otherwise proceed with the safest evidence-backed interpretation.
2. State the reasoning split in one line: planned effort, build effort, and the consequence that justifies it. Do not default every task to maximum effort.
3. Read `AGENTS.md`, `CLAUDE.md`, `docs/codebase-index.md`, and the smallest applicable domain/testing documents or repository skills. For UI controls or routes, read `docs/wiring-conventions.md`. For framework work, read the installed Next.js documentation described above.
4. Search the repository for every definition, import, call site, type/schema, test, fixture, configuration entry, generated artifact, and documented contract relevant to the requested behavior. Inspect implementations rather than inferring them from filenames. Do not conduct an unrelated repository-wide review.
5. Establish a regression baseline only when it can distinguish a pre-existing failure from one introduced by the change. Prefer the smallest deterministic reproducer or focused check; do not run a broad baseline by habit.
6. Present a concise execution plan containing:
   - current behavior and evidence;
   - dependency/call graph, including public and persistence boundaries;
   - contracts or signatures that will change, or an explicit statement that none will;
   - ordered mutation list: contracts/types → regression tests → implementation → consumers → generated/docs artifacts;
   - plausible risks: null/empty/error states, timeouts, retries, concurrency, stale state/cache, auth/tenant boundaries, backwards compatibility, and rollback where applicable;
   - exact validation ladder, with each command mapped to the failure class it detects;
   - provider-backed or destructive checks that remain excluded pending approval.
7. Keep the plan executable: name concrete files and symbols. If discovery shows that the requested change is unsafe, architectural, or materially larger than stated, stop and report evidence plus the smallest safe sequence instead of speculating.

### Phase 2 — Contract and regression proof

1. Define or update shared types, schemas, interfaces, and protocol contracts before downstream logic when the task changes a contract. Preserve strict TypeScript safety; do not introduce `any`, unchecked casts, blanket lint suppressions, or validation bypasses.
2. Add or adapt the smallest tests that fail for the identified regression or prove the new contract. Cover applicable happy path, empty/null/invalid input, failure/retry/timeout, authorization/ownership, and concurrency or stale-state behavior. Do not manufacture irrelevant edge cases.
3. Never delete, skip, weaken, loosen, or rewrite correct assertions merely to obtain green output. If an existing assertion must change because the requested contract intentionally changed, explain the behavior difference and ensure the new assertion tests the acceptance criterion.
4. Preserve compatibility unless the task explicitly authorizes a breaking change. When a transition is required, prefer a narrow adapter with a documented removal condition over duplicated implementations.

### Phase 3 — Atomic implementation

1. Implement the smallest complete change in dependency order. Migrate every verified call site and consumer. Remove only dead code made obsolete by this task and prove that it is unreferenced.
2. Match established architecture, naming, validation, error handling, accessibility, observability, and design-system conventions. Do not add speculative abstractions, unrelated cleanup, formatting churn, dependencies, or product behavior.
3. Keep each modified file complete and syntactically valid. Do not leave placeholders, ellipses, `TODO` substitutes for required behavior, commented-out code, temporary debugging output, or generated artifacts not intended for source control.
4. For UI/browser work, use `npm run ensure`, use the URL it prints, and verify `/api/local-project-id` before attaching. Never assume a localhost port or attach to an unknown server. Follow button wiring, internal navigation, route reachability, design-token, responsive, accessibility, reduced-motion, and forced-colors contracts.
5. Reinspect the diff after implementation for missed consumers, accidental behavior changes, unsafe logging, secrets, generated output, and unrelated modifications.

### Phase 4 — Risk-scaled verification and repair

1. Run the narrowest relevant deterministic check first. Map every additional command to a distinct plausible regression; do not stack lint, typecheck, all tests, build, and browser suites without a risk-based reason.
2. Use repository selectors and coordinators. Typical choices are:
   - localized source/test change: `npm run test:focused -- --files <comma-separated paths>`;
   - inspect PR gate selection: `npm run verify:pr-local -- --dry-run --files <comma-separated paths>`;
   - PR-ready handoff: the non-dry-run `npm run verify:pr-local` selected for the actual diff;
   - cross-module offline risk: `npm run verify:cheap` once when focused proof cannot bound the change;
   - shared UI/browser behavior: `npm run ensure` followed by the focused owner/journey, escalating to `npm run verify:ui` only when its additional coverage is warranted;
   - phone chrome: `npm run verify:phone-chrome` first;
   - clinical, privacy, ingestion, RAG, source, production-environment, or migration work: the smallest applicable domain gate plus `npm run check:production-readiness`;
   - explicit release confidence only: `npm run verify:release`, subject to provider approval.
3. Run heavy commands sequentially and let the repository run coordinator manage locks. Do not install while tests, builds, lint, typecheck, or servers are active. Do not start a permanent watcher or leave temporary processes running.
4. If a check fails, preserve its decisive output, reduce to the smallest reproducer, and classify it as caused by this change, pre-existing, flaky, environmental, or provider-blocked. Fix change-caused failures without weakening tests, rerun the smallest failing check, then rerun only the broader gate whose prior result was invalidated.
5. Run `npm run format` when repository instructions require it before commit/push, review the formatting diff, and include the result in the commit. Do not treat formatting, tests, lint, typecheck, or build as interchangeable evidence.
6. Do not claim zero regressions or a passed check that did not run. Completion requires all acceptance criteria to be evidenced and no known change-caused failure to remain. Report skipped checks and the specific residual risk.

### Phase 5 — Git and handoff

1. Inspect the final status and diff. Stage only coherent task files; never include secrets, local configuration, dependency directories, caches, logs, build output, screenshots not required by the task, or unrelated artifacts.
2. If commit/PR authority exists, create a clear commit on the current task branch and then create the pull request using the repository-required tool and template. Include any clinical governance or RAG impact sections required by `.github/pull_request_template.md`. Do not push unless explicitly authorized.
3. Return a concise evidence-backed report with:
   - outcome and acceptance criteria satisfied;
   - files modified/created and what changed;
   - architectural or contract changes, including compatibility behavior;
   - exact checks run and decisive results;
   - checks not run and why;
   - branch/worktree status and commit/PR/push state;
   - provider/live gates skipped or awaiting approval;
   - remaining risks and the smallest next action, if any.

Stop only when the requested outcome is complete and verified to the appropriate risk level, or when a concrete safety/authority/product decision blocks meaningful progress. Do not substitute a long plan for implementation when the work is clear and authorized.
