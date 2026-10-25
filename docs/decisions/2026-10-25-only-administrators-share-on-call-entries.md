# Decision: Only administrators create, edit or verify shared On Call entries

- **Status:** decided 2026-10-25
- **Source:** `src/lib/on-call/shared-entry-publisher.ts`, find "Only a site administrator may (owner decision, 25 Oct 2026)"

On 25 Oct 2026 the owner approved the audit's recommendation (#304) with "Go ahead and fix and complete
and go ahead with all recommendations". Since sign-up opened, any account could publish an On Call
escalation ladder or contact number to every signed-in clinician. Now only a site administrator,
checked live, can create, edit or verify a shared entry. Anyone signed in can still keep private
entries. Shared entries that ordinary accounts posted before this change are still visible and need
reviewing.

If this summary and the source ever differ, the source wins.
