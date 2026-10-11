# How these rules are organised

At task start, read [task lifecycle and receipt handoff](docs/task-receipts.md) and [the organisation map](docs/organisation/README.md).

Native loading: the core stays below the 24,000-byte per-file rule limit. Linked policy is mandatory when its topic applies. Antigravity loads the same canonical modules through `.agents/rules/project-*.md`; these wrappers contain references, not policy copies. Inspect fresh native context before claiming complete loading.

`AGENTS.md` is the always-loaded core; this file is its required continuation, read before any
repository write or publication. `AGENTS.md` carries the boundaries that prevent irreversible harm,
and the sections a committed gate parses by exact text. Every other rule keeps its heading in
`AGENTS.md` and its full text — verbatim, nothing dropped — in this continuation or a named
reference file. Open the file before acting in its area.

**Read these first in `AGENTS.md`; they prevent damage that cannot be undone, and their full text is there:**
`# Supabase project safety` (merging a migration reaches the live clinical database within
seconds, with no deploy step in between), `# RAG ranking protection`, `# Railway project safety`,
`# API and provider confirmation boundary`, and `# Local server safety`.

<!-- prettier-ignore -->
| Topic | Full text |
| --- | --- |
| Gate selection, the verification tier table, gate receipts | [`docs/agents/verification-gates.md`](docs/agents/verification-gates.md) |
| The whole PR lifecycle for every tool: open, follow CI, review threads, records, merge authority, landed, sync, sweeps | [`docs/agents/pull-request-workflow.md`](docs/agents/pull-request-workflow.md) |
| The `upload` shortcut | [`docs/agents/upload-shortcut.md`](docs/agents/upload-shortcut.md) |
| Button and route wiring, the bundle budget | [`docs/agents/wiring-and-bundle-budget.md`](docs/agents/wiring-and-bundle-budget.md) |
| External skill precedence, evidence and calibration | [`docs/agents/external-skill-precedence.md`](docs/agents/external-skill-precedence.md) |
| Deleting code you believe is dead | [`docs/agents/dead-code-deletion.md`](docs/agents/dead-code-deletion.md) |
| Claude Code hook scripts | [`docs/agents/claude-hook-scripts.md`](docs/agents/claude-hook-scripts.md) |
| The `bug-hunter` shortcut | [`docs/agents/bug-hunter-shortcut.md`](docs/agents/bug-hunter-shortcut.md) |
| Repository skills, the `/issues` outstanding-work memory | [`docs/agents/repository-skills-and-issues.md`](docs/agents/repository-skills-and-issues.md) |
| Codex dependency, review throttling, desktop worktree, reasoning effort, productivity, GitHub review, Cloud; Cursor Cloud | the `docs/agents/codex-*.md` and `docs/agents/cursor-cloud.md` pointers in `AGENTS.md` |

Five always-loaded sections stay in `AGENTS.md` in full. Exact-text gate protection is narrower than
that list: `# Search chrome behaviour` is pinned by `tests/ui-overlay-css-contract.test.ts`
(marker + “Hidden means zero reserve”); `## Codex Cloud environment` is pinned as a
**pointer heading** by `scripts/check-codex-cloud-setup.mjs` (body lives in
`docs/agents/codex-cloud-environment.md`); `## Bare PR publication is not readiness work`
and the format-before-push rule stay in `AGENTS.md` and are enforced operationally via skills,
hooks, and `scripts/guard-push.mjs` rather than a body-text parser; `## Anti-conflict and
CI-speed operating procedure` stays in `AGENTS.md` by convention and is **not** exact-text pinned —
silent reword would still pass `verify:full`. Do not treat every always-loaded block as
gate-locked.
