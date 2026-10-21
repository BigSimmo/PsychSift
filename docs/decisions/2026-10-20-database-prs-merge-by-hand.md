# Decision: Database pull requests merge by hand, and relayed rulings are not owner approval

- **Status:** decided 2026-10-20
- **Source:** `AGENTS.md`, find "merges only when the owner presses Merge after the owner's own yes"
- **Retires:** `migration-pr-auto-merge-allowed`

On 20 Oct 2026 the owner accepted every recommendation of the change control audit (the owner's words in the
Change control audit project thread: "Ok go ahead with all recommendations"). A pull request that
changes `supabase/migrations/**` now merges only when the owner presses Merge after the owner's own yes: the
`PR policy` check fails it while auto-merge is armed, and Gitar never arms a PR touching `supabase/**`
or clinical-risk paths. This replaces the 18 Oct rule that let migration pull requests auto-merge,
whose source was recorded only as "relayed". A ruling relayed by another tool, or an action from the
owner's GitHub account, is not the owner's yes for a database change or clinical sign-off
(`docs/agents/clinical-sign-off.md`, "Relayed rulings are not sign-off").

The same audit added a `Required check change approved:` line for pull requests that change the files
deciding whether the required checks pass. On 20 Oct 2026 the owner chose to keep that line a
declaration checked by shape only, not proof of the owner's yes, because no check can tell the owner from
another tool using the owner's GitHub account. The owner's review and Merge press remain the approval.

The audit also made CI compare a pull request's migrations with the base branch's sealed hashes. On
21 Oct 2026 the owner chose, by decision card in the same thread ("Add the exception"), to let a PR
whose body declares `Migration history edit approved:` skip that comparison, so an owner-approved
restore can merge. `PR policy` still validates that line and its fail-fast guard migration.

If this summary and the source ever differ, the source wins.
