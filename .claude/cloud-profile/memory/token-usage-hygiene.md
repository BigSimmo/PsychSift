---
name: token-usage-hygiene
description: "Search before reading large files; follow current allocation and repository policies when limiting unnecessary context"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3547fb94-e641-4bd8-bc60-cd44f14c7094
  modified: 2026-08-19T08:02:34.883Z
---

Do not read entire large directories or dependency trees when only one fact is needed. When the current
repository requires checking `node_modules/next/dist/docs/` for framework changes, search for the specific
topic/API first, then read only the matched file, never the whole docs folder. Verify the current
repository and its applicable instructions instead of assuming the older `Database` repository name.

Use targeted searches and bounded reads. Delegate only when authorized and useful under
current agent allocation (`docs/agents/smart-agent-allocation.md`) and the shared working rules
in `AGENTS.md`.
An old search-count threshold does not authorize agents, select their model or establish that a named
agent exists on the current host.

Do not speculatively load MCP tool schemas via ToolSearch "just in case" — only load the tools a task actually
needs, and batch a known set into one call rather than loading them one at a time.

**Historical context, 2026-08-19:** Josh (the user, a psychiatrist and non-technical) asked directly on 2026-08-19 to reduce wasted token
usage without slowing down development, and specifically asked about a "claudeignore" mechanism. Checked with
the claude-code-guide agent first rather than guessing: Claude Code has no `.claudeignore` file or per-file-read
exclusion list, so that request can't be fulfilled as literally asked — this note is the real substitute.
`.claude/settings.json`'s permission allowlist was already recently expanded (commit 89ae14fad) and is in good
shape, so there was nothing to add there. The archived workstation record (`docs/archive/cloud-session-state-2026-10-16/dev-drive-project-location.md`) separately notes `node_modules` was most
of the repo's disk footprint — the same directory is the main _token_ risk for reads, not just disk space.

**How to apply:** Use current repository instructions to choose the workflow. This note grants no new
authorization. Do not shrink `AGENTS.md`/`CLAUDE.md` by dropping or condensing rules to save tokens — those
rules are shared safety and process contracts read by five different AI tooling systems (per the file's own "AI
tooling map"), and cutting one is a project decision for the team, never something to do unilaterally for token
savings.

Their current shape is the result of one such project decision, taken deliberately in 2026-09: `AGENTS.md` is a
small always-loaded core — the boundaries that prevent irreversible harm, plus the sections a gate parses by
exact text — and an index. Every other rule keeps its heading there and its full text, verbatim, in a named file
under `docs/agents/`. So a large `AGENTS.md` is no longer the expected state, and a rule that is not in the core
has not been dropped; open the file the core names for it. Restoring the old single wall would undo that work.

Resolve repository paths against the verified current checkout root, not this installed memory directory.
