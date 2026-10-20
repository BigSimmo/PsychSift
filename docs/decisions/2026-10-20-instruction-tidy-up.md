# Decision: The always-loaded instructions keep only the core rules and one index

- **Status:** decided 2026-10-20
- **Source:** `AGENTS.md`, find "Every rule below keeps its full text in the linked file"
- **Retires:** `start-of-task-required-reads`, `contextual-working-defaults-file`

The owner accepted the change control audit's tidy-up proposals and asked for them in a second pull request. `AGENTS.md` now carries only the boundaries that prevent irreversible harm, the sections gates read word for word, and one index table. Task receipts and the organisation map are read only when the work needs them, not at the start of every task. The separate contextual working defaults file is folded into the shared working rules. The unused PreCompact hook, the `verify:core` alias and the hand-written gate counts are gone, and the legacy cloud setup documents moved from `docs/agents/` to `docs/cloud/`. Moving the review records to pull request comments and archiving the applied inbox requests are not part of this change.

If this summary and the source ever differ, the source wins.
