# Decision: Defer suppressing indexed clock details on Forms 3A, 4A and 7A

- **Status:** decided 2026-11-06
- **Source:** the owner, in chat

On 6 November 2026, in the Claude Code session for PR #3901, the owner chose to defer the change in PR #3901 that stopped the Forms page from showing an unqualified extracted clock duration (`indexedClock`) as the Clock card's detail line.

That change altered signed-off attestation content for Forms 3A, 4A and 7A, so their review pins no longer matched. PR #3901 now keeps its other fixes but restores the previous behaviour: the Clock card and its detail sheet fall back to `indexedClock` when a form has no curated `priorityFacts.clock.detail`, and the forms render exactly the previously signed-off content. No pins were resealed and no sign-off was made.

Suppressing the indexed clock detail can return later as its own change, with the owner's clinical sign-off of the new wording for each affected form.

If this summary and the source ever differ, the source wins.
