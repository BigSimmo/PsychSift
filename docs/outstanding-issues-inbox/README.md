# Outstanding-issues inbox

Feature branches never edit `../outstanding-issues.md` directly. Use `npm run issues:add`, `npm run issues:update`, `npm run issues:queue`, or `npm run issues:done`; each writes one validated JSON request in this directory, so concurrent PRs add different files and merge cleanly.

When multiple landed requests mutate the same canonical issue, keep the intended request and add an immutable cancellation request for each rejected mutation:

```sh
node scripts/ledger-inbox.mjs cancel <request-uuid> --reason "<why this mutation must not apply>"
```

The cancellation request must land before reconciliation. It preserves both records for audit, prevents the cancelled mutation from changing the canonical ledger, and lets reconciliation process the remaining batch deterministically.

After the relevant PRs have landed, fetch `origin/main`, start a dedicated ledger-reconciliation branch from that exact base, run `npm run issues:reconcile -- --dry-run`, then run `npm run issues:reconcile`. The reconciler refuses a stale base or dirty canonical file and holds a repository-wide cross-worktree lock. It allocates numeric IDs, updates the canonical Markdown ledger, and moves processed requests and cancellations to `applied/` as an audit trail. `check:ledger-write-discipline` verifies that exact transaction in CI and pre-push.

## Retaining a closed source branch during a rebuild

A retained source branch can still carry unmerged applied records after its PR closes. For an explicitly preserved source, use both `--preserved-source-pr <number>` and `--preserved-source-sha <full-sha>` on the dry-run and actual reconciliation. These selectors request verification; they do not override the guard.

The check requires configured `gh` access and applicable authorisation for read-only GitHub metadata. It verifies the source PR is closed and unmerged, targets this repository's `main`, and has the exact pinned head. It checks all pages for an open PR using that head branch, rereads the source PR, and verifies the preserved local commit and remote branch. Missing, unavailable, malformed or changed evidence blocks admission. Only that exact source branch/SHA is admitted; other competing reconciliations still block. The source branch cannot be the reconciliation writer, and the selectors cannot be combined with concurrent/skip overrides. The freshness, immutable-request, journal and repository-wide lock checks remain unchanged.

After correction requests and this guard are reviewed and landed, fetch current main and the retained source into the same repository, start a clean dedicated branch from current main, and use:

```sh
npm run issues:reconcile -- --dry-run --preserved-source-pr 3509 --preserved-source-sha db2d180360b3d3dc7ef805f6faae227b4e4b0e8b
npm run issues:reconcile -- --preserved-source-pr 3509 --preserved-source-sha db2d180360b3d3dc7ef805f6faae227b4e4b0e8b
```

Run the actual transaction only after the dry-run passes and normal ownership/admission permits it. Preserve the original source branch and all immutable records. Review the generated ledger and snapshot, verify ledger discipline against the fetched base, and publish the reconciliation for its own review; merge authority is separate.
