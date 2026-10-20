# Gitar auto-merge criteria for PsychSift

Merge method: always use a merge commit. Squash and rebase merging are disabled in this
repository, so a squash or rebase auto-merge request will fail.

Do not arm auto-merge on a pull request that carries an owner-seal hold. Treat a PR as held when
its title, body or labels say it is held for, waiting on, or pending an owner seal, owner approval
of a database change, or an approved production database window (for example "not merge-ready",
"merge only after explicit owner approval", "merge only inside the owner's approved window", or
"draft, unsealed" migration). PRs #3638 and #3640 are held this way: never arm auto-merge on them.

Never arm auto-merge on a pull request that touches `supabase/**` (migrations, edge functions or
project config) or that the PR policy check reports as "Clinical risk: yes". Merging those changes
the live clinical database or clinical content, so only the owner presses Merge (owner decision
2026-10-20, `docs/decisions/2026-10-20-database-prs-merge-by-hand.md`). PR policy fails a migration
PR while auto-merge is armed on it, so arming one only blocks it.

Once a pull request exists, its auto-merge state belongs to the owner: do not disable or re-enable
it. In particular, if auto-merge was turned off on a PR, do not turn it back on after a new push
or a new approval.
