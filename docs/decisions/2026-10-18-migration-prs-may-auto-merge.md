# Decision: Migration pull requests may auto-merge once all required checks pass

- **Status:** decided 2026-10-18; superseded by 2026-10-20-database-prs-merge-by-hand.md
- **Source:** `AGENTS.md`, find "Auto-merge on one is allowed (owner decision 2026-10-18"
- **Retires:** `migration-pr-no-auto-merge`

On 18 Oct 2026 (relayed 15:14 AWST) the owner decided, as a standing rule, that pull requests touching
`supabase/migrations/**` may auto-merge once all required checks pass, including Migration replay and
the drift checks. This reverses the earlier rule that auto-merge must never be enabled on a migration
pull request. Every other Supabase safety rule is unchanged.

If this summary and the source ever differ, the source wins.
