# How these rules are organised

`AGENTS.md` is the always-loaded core; this file is its required continuation, read before any
repository write or publication. `AGENTS.md` carries the boundaries that prevent irreversible harm,
the sections a committed gate parses, and one index (`# Where the rest of the rules live`) naming the
file that holds every other rule in full. Open the file before acting in its area. There is no
separate start-of-task reading list: the organisation map and task receipts are read when their
work applies (change control audit S2 to S5, 2026-10-20).

Native loading: the core stays below the 24,000-byte per-file rule limit. On disk, `.agents/rules/project-*.md` are 5-line `@[...](../../docs/agents/native-startup/*.md)` wrappers without duplicated policy prose, which Antigravity expands inline at startup.

**Read these first in `AGENTS.md`; they prevent damage that cannot be undone, and their full text is there:**
`# Supabase project safety` (merging a migration reaches the live clinical database within
seconds, with no deploy step in between), `# RAG ranking protection`, `# Railway project safety`,
`# API and provider confirmation boundary`, and `# Local server safety`.

Exact-text gate protection applies to some index targets: `tests/ui-overlay-css-contract.test.ts`
pins the `search-chrome-behaviour.md` link in `AGENTS.md` and the marker + “Hidden means zero
reserve” in `docs/agents/native-startup/search-chrome-behaviour.md`; `## Codex Cloud environment` is
pinned as a **pointer heading** by `scripts/check-codex-cloud-setup.mjs` (body lives in
`docs/agents/codex-cloud-environment.md`); the bare PR publication rule and the format-before-push
rule in `docs/agents/native-startup/process-hardening.md` are enforced operationally via skills,
hooks, and `scripts/guard-push.mjs`; and the anti-conflict procedure in
`docs/agents/native-startup/publication-workflows.md` is not exact-text pinned, so a silent reword
would still pass `verify:full`. Do not treat every startup module as gate-locked.
