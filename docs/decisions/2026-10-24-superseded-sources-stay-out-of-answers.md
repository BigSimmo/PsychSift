# Decision: Superseded sources stay out of answer evidence

- **Status:** decided 2026-10-24
- **Source:** the owner, in chat

On 24 October 2026 the owner confirmed that the filter merged in PR #3743 stays as it is: a source
marked outdated (superseded) is removed before any answer route uses it as evidence. This settles
the apparent conflict with the owner's 21 October rejection of the earlier attempt, PR #3700. The
rule itself lives in the code comment in `src/lib/rag/superseded-evidence.ts`, find "a superseded
source is never used as evidence". The 22 October live count found no document marked
outdated, so nothing changed for users.

If this summary and the source ever differ, the source wins.
