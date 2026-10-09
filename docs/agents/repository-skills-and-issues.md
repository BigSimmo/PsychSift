# Repository Skills and Outstanding-Work Memory

_Updated 2026-10-08 — corrected documentation guidance; operational evidence retains its original dates._

<!-- BEGIN:repository-skills-and-issues -->

## Repository productivity skills

Select repo-local skills under `.agents/skills/` when their descriptions match the actual task and their use materially helps. Read an explicitly named skill before acting. Run `npm run skills` when the current catalog is needed; `.agents/skills/catalog.json` owns its contents rather than a duplicated count here. `npm run check:skills` verifies the canonical skills, compatibility aliases, and Claude, Cursor, and PsychSift plugin skill surfaces when those surfaces change. The older long names remain compatibility aliases and must not be counted as unique skills.

The foundational orchestration skills are:

- `plan`: plan risk-scoped verification before non-trivial changes.
- `fix`: diagnose and repair local verification failures with the smallest reproducer.
- `clinical`: assemble clinical, privacy, source, and rollback evidence.
- `ui`: inspect the running app across routes, breakpoints, and accessibility modes.
- `rag`: validate retrieval and answer changes offline first, then prepare live-eval approval gates.
- `operations`: turn pending operator debt into a deduplicated, approval-gated batch.
- `task`: manage safe start, handoff, merge proof, and cleanup transitions.

When planning would help, use the matching planner command in `docs/productivity-workflows.md` without side effects by default. Do not invoke a planner for a simple task merely because a skill exists. Add `-- --run` only for authorised local/offline checks required by the task. The workflow engine must never execute commands listed under `approvalRequired`; selecting a skill or planner grants no additional authority.

## Outstanding-work memory (`/issues`)

Follow the [task-status authority map](../task-receipts.md#status-authority).
`docs/outstanding-issues.md` retains repository issue history and its recommended
queue; canonical task lifecycle belongs to the PsychSift-filtered Notion source.
Queue issue completion or scope changes through immutable inbox requests, never
direct table edits. Never restore completed, duplicate, speculative, or rejected
work to the recommended queue.

- When the user types `/issues`, invoke the `issues` skill (`.claude/skills/issues/SKILL.md`): run `npm run issues:report -- --json` to read the cached `origin/main` ledger (read-only; mutates and commits nothing).
- `/issues add|done|update|queue …` queue immutable request files under `docs/outstanding-issues-inbox/`. Ordinary branches never edit the canonical ledger. One deliberately serialized fresh-base branch runs `npm run issues:reconcile` after PRs land.
- Proactively offer to capture unresolved follow-ups, deferrals, and known risks into the ledger before session context is lost.
- Before acting on a queued item, check open PRs for overlapping routes or components to avoid duplicate concurrent work (`#292`).
- The `SessionStart` hook (`.claude/hooks/issues-surface.sh`, wired in `.claude/settings.json`) auto-surfaces the recommended queue plus open-item counts at session start (read-only).

<!-- END:repository-skills-and-issues -->
