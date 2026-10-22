# Decision: The WA MHA Form 6A/6B statutory-text issue stays open until owner, legal and clinical sign-off

- **Status:** decided 2026-10-17
- **Source:** `docs/outstanding-issues-inbox/a5c25ca4-4fa3-421f-a944-35621169e55e.json`, find "Owner decision 17 Oct 2026 21:37 AWST"

PR #3609 archived ledger issue #WFYDV6 (the unwired `src/components/forms/wa-mha-form-print.tsx` with
unverified statutory text) without the legal and clinical sign-off the issue required. The owner decided on
17 Oct 2026 at 21:37 AWST that the issue stays open and the form stays unwired until that sign-off is
recorded. The Form 6A/6B wording still needs owner, legal and clinical sign-off; nothing in this decision signs it off. At first the ledger tooling had no reopen action, so the issue was tracked again as a new open P1 row
(#Z12CBC). Once the reopen action landed (#3627), inbox requests were queued to reopen #WFYDV6 as a P1
with its original ID and ULID and fold #Z12CBC and #BDFFYF back into it. These requests have not
yet been reconciled: the canonical ledger still archives #WFYDV6 and keeps the duplicate trackers open.
The queued fold-back is a pending transaction, not completed work. A reconciliation must not archive #WFYDV6 again without the recorded owner, legal and clinical sign-off, or the deletion of the file after the
30-day dead-code window (13 Nov 2026).

If this summary and the source ever differ, the source wins.
