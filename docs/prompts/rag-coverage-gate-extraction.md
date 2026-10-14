# X3 / #086 `rag.ts` coverage-gate extraction

Use this prompt in a fresh Codex Cloud task with
`CODEX_CLOUD_ACCESS_PROFILE=offline`. It supersedes the older proposal to move the
three-function block through `applyCoverageGateTelemetry`; current dependency inspection shows
that the two private helpers are orchestration-owned and cannot move without a back-edge.

## Perfected prompt

Safely implement the X3 / #086 `rag.ts` decomposition in the PsychSift (`BigSimmo/PsychSift`) repository.

### Objective

Make one architecture-only extraction from `src/lib/rag/rag.ts` into the new file
**src/lib/rag/rag-coverage-gate.ts**. Preserve retrieval behavior, ordering, thresholds,
fallbacks, citations, scope enforcement, telemetry, and the public `@/lib/rag/rag` API.

Move only:

- `evaluateEvidenceCoverageGate` (anchor on the declaration, not stale line numbers);
- its directly owned private `visualEvidenceUnitTypes` constant.

Keep `prepareCoverageGateResults` and `applyCoverageGateTelemetry` in `rag.ts`. They are
orchestration-owned and depend on `rag.ts` hydration, selection, timing, metadata-cache, and
telemetry state. Do not move them, inject their dependencies, or create an import back-edge.

The evaluator's other dependencies already come from `@/lib/clinical-search`,
`@/lib/rag/rag-evidence-gates`, and the shared `SearchResult`/`RagQueryClass` types. Import those
directly in the new module. Preserve the evaluator body byte-for-byte wherever practical.

RAG impact: no retrieval behaviour change — pure module extraction

No live eval canary is required because this task changes no behavior. State that explicitly in
the handoff so a reviewer can disagree cheaply.

### Provider and Git boundaries

This task is completely provider-free even if the Cloud environment supports connected work.

Do not call OpenAI, Supabase, Railway, GitHub/GitLab APIs, hosted CI, or production-like services.
Do not fetch, pull, push, commit, open a PR, inspect remote PR metadata, deploy, ingest, reindex,
run drift checks, start a server, or run any live retrieval/answer-generation/canary/release
workflow. Do not read or print credentials or environment-variable values. Leave publication as
a separate operator-authorized handoff.

### Startup and mandatory stop checks

1. Work only in the isolated Cloud checkout supplied for this task.
2. Read all applicable `AGENTS.md` files before editing.
3. Report exactly: `The Windows-only startup script is unavailable in Codex Cloud.` Then perform
   equivalent read-only repository identity, branch, `HEAD`, upstream, status, staged/unstaged/
   untracked, worktree, Git-operation-marker, package-script, and recent-history checks.
4. Proceed only when `CODEX_CLOUD=1`, the checkout has exactly one Git worktree, the branch is a
   clean non-protected task branch, and local `origin/main` is available as its base. Do not fetch.
5. Read `docs/codex-cloud.md` and run the dependency-free isolation verifier from the
   prompt-perfector repository workflow with `--cloud` before editing.
6. Read the required RAG behavior, process-hardening, workorder, maintainability-budget, contract
   test, and package-script documents named below.
7. Measure `rag.ts` with the exact line-count logic in
   `scripts/check-maintainability-budgets.mjs` before editing. Expected base is approximately
   5,030 lines.
8. Stop without editing if `rag.ts` is already a small facade; the extraction already exists; the
   three near-complete pipeline-copy modules from the rejected design exist; the target area is
   dirty; the branch is protected; the checkout is not isolated; the evaluator requires a
   signature change or import cycle; or expected reclaimed headroom is under 150 lines.

Before editing, state exactly:

`RAG protected surface: this task touches src/lib/rag/**. Intended impact is no retrieval behaviour change; this is a structure-only extraction.`

### Required reading

- `docs/rag-behaviour/README.md` and its linked behavior map, refuted approaches, and safeguards;
- `docs/process-hardening.md`, especially the `rag.ts` decomposition sections;
- `docs/maturity-backlog-workorders.md`, X3;
- `scripts/check-maintainability-budgets.mjs`;
- relevant architecture-boundary, retrieval-query-variants, RAG contract, cache, latency, and
  early-exit tests;
- `package.json` verification scripts.

### Implementation

1. Create **src/lib/rag/rag-coverage-gate.ts** containing the moved constant and evaluator.
2. Import `SearchResult`, `RagQueryClass`, `classifyRagQuery`, and the evaluator's existing
   evidence predicates from their current owner modules. Do not duplicate helpers.
3. In `rag.ts`, import the evaluator for its two internal call sites and explicitly re-export it
   so `tests/retrieval-query-variants.test.ts` and all existing public consumers remain unchanged.
   This re-export strategy preserves the public API and avoids consumer churn.
4. Do not reorder code, change a signature, rename a symbol, remove an `await`, change a literal,
   threshold, comparator, default, fallback, telemetry field, timing boundary, cache/abort path,
   scope check, evidence selection, or comment within the moved function.
5. Do not duplicate any orchestration pipeline or materially increase total RAG implementation
   size beyond import/export overhead.
6. After proof, update only the `src/lib/rag/rag.ts` limit in
   `scripts/check-maintainability-budgets.mjs` from 5,030 to the new exact measured line count.
   Keep the reclaimed budget comment and do not raise any budget.
7. Update maintained architecture documentation only if module ownership/path mapping genuinely
   changed. Do not modify #098, #099, #100, or #101.

Preserve owner/document scope checks, admission-before-scope ordering, retrieval and released
result ordering, cache and abort semantics, conservative fallbacks, citation/numeric grounding,
source governance, telemetry names/timing boundaries, and error/rollback behavior.

### Verification

Respect the cross-worktree heavy-command coordinator. Never bypass or delete its lock. If an
exclusive gate is held by another worktree, report that command as unrun with the lock owner and
reason.

Use Node 24, npm 11, and npm. Check that `node_modules` is populated, not merely present. If it is
absent or stale, use the repository Cloud maintenance/setup procedure only after the coordinator
allows installation; do not change manifests or lockfiles.

Run narrowly, then widen locally:

1. `npm run workflow:rag-lab -- --write-evidence`
2. `npm run test -- tests/retrieval-query-variants.test.ts tests/rag-tail-latency.test.ts tests/rag-shared-cache.test.ts tests/rag-variant-early-exit.test.ts`
3. `npm run check:maintainability-budgets`
4. `npm run check:rag:fixtures`
5. `npm run eval:rag:offline`
6. `npm run check:knip`
7. `npm run typecheck`
8. `npm run lint`
9. `npm run verify:cheap`
10. Run `npm run format` (whole-tree Prettier) and commit the result before pushing (or run `npm run format:check` when in a read-only/no-commit Cloud session).
11. `git diff --check`

For every command, record its real exit status and quote the decisive output line. Do not pipe a
gate through `tail`; if output filtering is unavoidable, preserve the original process status.
An admission timeout or contention result is not a pass.

### Final review and handoff

Review the complete diff for accidental logic changes, copied pipeline bodies, changed ordering,
thresholds/defaults, missing exports, import cycles, unrelated files, generated artifacts, and
secrets. Confirm the worktree again immediately before handoff.

Report:

- the responsibility extracted and why it is cohesive;
- files changed;
- `rag.ts` line count before and after;
- total `src/lib/rag` LOC and diff statistics proving move rather than copy;
- the explicit `rag.ts` re-export strategy and preserved public import;
- every check with status and decisive line, plus every unrun check and why;
- current branch/worktree status and remaining coupling/risk;
- explicit confirmation that retrieval, ranking, clinical, provider, and safety behavior were
  not intentionally changed;
- explicit confirmation that no provider/API call, live canary, commit, push, PR, hosted CI,
  deployment, ingestion, reindex, or release occurred;
- a short handoff noting that #098 and #099 remain separate, and that the planned
  **src/lib/rag/rag-hydration.ts** module is the intended #101 follow-up rather than part of this
  task.
