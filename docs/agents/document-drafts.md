# Copy-first document drafts

Maintained operational guide for coding agents; Documentation owns. Updated 2026-11-04.
The governing scope and exclusions are in [shared context](shared-context-and-memory.md#autonomous-document-coordination).

The portable helper in `scripts/document-drafts.py` keeps recoverable drafts outside the source checkout. It writes no originals, contacts no service, and needs Python 3 plus Git for three-way merges. Windows and Linux use the same code. Use the host's `python3` or `python` command; no package install is needed.

From the verified repository root, choose an existing task scratch path outside the checkout and an exact authorised text document:

```sh
python3 scripts/document-drafts.py prepare . ../task-scratch/document-draft --task current-task --file docs/example.md
python3 scripts/document-drafts.py status ../task-scratch/document-draft --source .
python3 scripts/document-drafts.py reconcile ../task-scratch/document-draft --source .
python3 scripts/document-drafts.py export ../task-scratch/document-draft --source .
```

Replace the synthetic document argument with the actual document. Edit only its copy under `draft/`. Resume the same scratch workspace; preparation preserves existing drafts. Reconciliation keeps the baseline, source/draft input snapshots and earlier candidates. It carries reviewed candidate edits forward when an input changes and merges compatible changes. Inspect and resolve reported conflicts, then acknowledge the candidate with `reconcile ... --resolved docs/example.md`. When both source and draft move, export requires review of the retained inputs and new candidate even if the text has no conflict markers. Editing an already clean candidate also requires explicit review; ordinarily edit the draft and reconcile again.

Older workspaces can gain input snapshots by reconciling once while their inputs still match the last reconciliation. If those inputs have already changed and snapshots are unavailable or altered, export is blocked: preserve the old workspace and reconcile its reviewed work in a fresh task-owned workspace against the current source. Never discard the earlier candidate or request another takeover permission merely to prepare that recovery.

Export emits absolute `path`, current `before_sha256` and `after_base64` fields for the existing integrator. It is a proposal. The integrator must check claims and required gates, establish a serial write, compare the current original hash immediately before applying, and re-reconcile changed inputs. The helper has no apply command and grants no release, takeover, publication or additional authority. Keep governing-rule and substantive conflicts for their authorised decision-maker.

Supported inputs: UTF-8 `.md`, `.txt`, `.rst`, `.adoc`; at most 100 exact paths and 10 MiB total. Traversal, hidden/sensitive/configuration names, links/reparse points, changed baselines, stale exports and busy locks fail closed. Filename screening does not certify contents safe. Never copy secrets, private sessions or data outside the task purpose/audience. Never reclaim an uncertain lock by age.

Run the synthetic safety/merge checks with `python3 scripts/test-document-drafts.py`. The dedicated Document drafts workflow runs the same checks on a hosted Linux runner after relevant PR changes. That proves helper behaviour on that runner; it does not prove any chat loaded or followed the rules.

This copy reuses the reviewed shared helper, SHA-256 `83ea03fc3430b34207b95a0e0fca2aebdff42c1a9a32c2b8d59817513e31ef4c`. Maintain helper and tests together; compare reviewed hashes before updating another copy. No private instruction source or Windows installation is required on cloud hosts. A cloud checkout must select this feature branch or a main revision containing it; a PR does not change existing checkouts. Coordinate only task-safe metadata through supported native task tools with destination authority. If a host is offline, preserve the draft and continue independent authorised work; do not collect raw sessions or create a replacement chat service.
