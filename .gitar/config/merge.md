# Gitar auto-merge criteria for PsychSift

Merge method: always use a merge commit. Squash and rebase merging are disabled in this
repository, so a squash or rebase auto-merge request will fail.

Do not arm auto-merge on a pull request that carries an owner-seal hold. Treat a PR as held when
its title, body or labels say it is held for, waiting on, or pending an owner seal, owner approval
of a database change, or an approved production database window (for example "not merge-ready",
"merge only after explicit owner approval", "merge only inside the owner's approved window", or
"draft, unsealed" migration). PRs #3638 and #3640 are held this way: never arm auto-merge on them.

Pull requests that touch `supabase/migrations/**` may be armed once required checks pass (the
standing rule for migration PRs), but only when no owner-seal hold note is present. If the PR
touches `supabase/migrations/**` and you are unsure whether a hold applies, do not arm.

Once a pull request exists, its auto-merge state belongs to the owner: if auto-merge was turned
off on a PR, do not turn it back on.
