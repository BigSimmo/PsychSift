# Productivity workflows

The repository exposes a validated catalog of 35 canonical Database skills. Run `npm run skills` to list them by category. `npm run check:skills` validates the 35 canonical skills, 8 compatibility aliases, and every Claude, Cursor, and Clinical KB plugin `SKILL.md` for metadata, local links, npm commands, frozen-ledger discipline, provider approval boundaries, and destructive-action safeguards.

The repository exposes seven offline-first workflow planners. Each planner inspects the current change through `scripts/ci-change-scope.mjs`, prints a minimal local verification sequence, and separates provider-backed commands into an explicit approval section.

| Command                                         | Purpose                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run workflow:flightplan`                   | Classify the current diff and select the smallest appropriate verification ladder.     |
| `npm run workflow:triage`                       | Classify a saved or recent workflow failure before attempting a fix.                   |
| `npm run workflow:clinical-proof`               | Produce clinical-governance, privacy, source, rollback, and verification requirements. |
| `npm run workflow:design-sweep`                 | Plan the live route, breakpoint, accessibility, and Chromium sweep.                    |
| `npm run workflow:rag-lab`                      | Select focused retrieval tests, offline RAG evaluation, and gated live evaluations.    |
| `npm run workflow:operator-closeout`            | Inventory and deduplicate pending operator or confirmation-required actions.           |
| `npm run workflow:lifecycle -- --phase <phase>` | Plan `status`, `start`, `reconcile`, `handoff`, `landed`, or `cleanup` lifecycle work. |

## Safe execution

- Planning is read-only by default.
- Add `-- --run` to run only the printed local/offline checks.
- Provider-backed commands are never executed by the planner, even with `--run`.
- Add `-- --write-evidence` to save structured evidence under ignored `.local/workflow-evidence/`.
- Add `-- --json` for machine-readable output.
- Use `-- --files pathA,pathB` to plan an explicit proposed change before editing.
- Use `workflow:triage -- --log <path>` to classify a captured failure.
- Use lifecycle phase `reconcile` for broad multi-worktree work. It selects the report-only
  `node scripts/reconciliation-preflight.mjs` and
  `node scripts/reconciliation-evidence-pack.mjs --output .local/reconciliation-evidence/pack.json`
  locally and keeps `git fetch --prune origin` approval-gated. Add
  `--include-processes` to the preflight only when process ownership may block cleanup; it never
  serializes raw command lines. Lifecycle `start`/`cleanup` select
  `node scripts/primary-checkout-lease.mjs --check` so primary writes fail closed under another
  owner or dirty/operation state without blocking read-only or feature worktrees.

The existing shared `workflow:run`, `workflow:status`, `workflow:verify`, `workflow:deps`, `workflow:clean-state`, `workflow:export`, and `workflow:handoff` commands now resolve their shared implementation through the repository's Git common directory. This keeps them portable in linked and detached Codex worktrees. Set `CODEX_LOCAL_WORKFLOW_ROOT` only when the shared tools live somewhere non-standard.

The matching agent skills live in `.agents/skills/`. Skills provide judgment and repair loops; scripts provide deterministic selection, safety enforcement, and evidence.
