# Decision: The production service-role key moves into a main-only GitHub environment

- **Status:** decided 2026-10-19 (the source gives no date; this is when it was first recorded)
- **Source:** `docs/deployment-architecture.md`, find "The owner approved moving it into a GitHub"

The owner approved moving the production Supabase service-role key out of repository secrets and into
a GitHub environment named `production-secrets`, which only `main` may use and which has no required
reviewers, so scheduled jobs keep running unattended (audit finding F-21). The owner creates the
environment and adds the key before the change that names it merges, and deletes the repository copy
only after the CI boot smoke step no longer needs it.

If this summary and the source ever differ, the source wins.
