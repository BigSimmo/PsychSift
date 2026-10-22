# Decision: Normal merges and unconditional push safety

- **Status:** decided 2026-10-18
- **Source:** the owner, in chat

The owner's current Git defaults prohibit direct main pushes and force pushes, require fetching and integrating the remote before a plain push, and select normal merges. The local push hook refuses main ref updates and non-fast-forward or unverifiable ref updates before optional or provider-dependent checks. Hook payloads cannot prove a fresh fetch or detect a no-op force flag.

The batch adapter selects ordinary merge commits and refuses legacy squash batches. Existing clinical, database, owner sign-off, provider, required-check and deployment approval controls still apply, including the specific migration restrictions in AGENTS.md.

- **Retires:** `squash-auto-merge-default`

If this summary and the source ever differ, the source wins.
