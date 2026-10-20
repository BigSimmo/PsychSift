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

If this summary and the source ever differ, the source wins.
