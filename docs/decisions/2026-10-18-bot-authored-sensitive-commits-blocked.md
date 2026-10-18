# Decision: Bot-authored commits may not change Supabase, infra SQL or clinical paths

- **Status:** decided 2026-10-18
- **Source:** `scripts/pr-policy.mjs`, find "Bot-authored sensitive changes (owner rule, 2026-10-18)"

On 18 Oct 2026 the owner decided that PR policy must fail when a bot account authored a commit that
touches `supabase/**`, `backend/**/infra/*.sql` or a clinical-risk path, so such pull requests cannot
auto-merge without human review. Dependabot's dependency-only changes are unaffected.

If this summary and the source ever differ, the source wins.
