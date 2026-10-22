# Decision: Review records are pull request comments, and the old record files are archived

- **Status:** decided 2026-10-20
- **Source:** `docs/agents/pull-request-workflow.md`, find "Review and sweep records live in pull request comments"
- **Retires:** `review-record-ledger-append`

This carries out the owner's 16 September decision, as part of the change control audit's tidy-up that the owner asked to have built in the same pull request. A completed review, sweep or landed check on a pull request is now recorded as one `Review record` comment on that pull request, and the check before a review looks for such a comment at the same head. The 744 old record files moved, unchanged, to `docs/archive/branch-review-records/` and are read-only. `npm run ledger:lookup` still searches them for history, and the commands that wrote records now refuse without an explicit historical-repair opt-in.

If this summary and the source ever differ, the source wins.
