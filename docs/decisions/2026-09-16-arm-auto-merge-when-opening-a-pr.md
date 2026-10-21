# Decision: Agents may arm auto-merge when they open an ordinary pull request

- **Status:** decided 2026-09-16
- **Source:** `docs/agents/pull-request-workflow.md`, find "Arming auto-merge at open (owner ruling 2026-09-16)"

An agent that opens an ordinary pull request may switch on auto-merge (squash then; merge commits only since 2026-10-18) as part of opening it, with no further confirmation. After that the auto-merge setting belongs to the owner, and merging a database change is still a production deploy.

If this summary and the source ever differ, the source wins.
