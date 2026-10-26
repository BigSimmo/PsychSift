# Decision: Signing in asks before clearing this shift's signed-out work, and closing the question keeps it

- **Status:** decided 2026-10-26
- **Source:** `src/components/front-door/signed-out-work-prompt.tsx`, find "Closing the sheet keeps it, because clearing cannot be undone"

On 26 Oct 2026 the owner approved the design wording in pull request 3836 and chose, by decision card,
that closing the sign-in question keeps the work ("Approve, closing keeps"). When someone signs in on a
phone holding this shift's call notes, handover drafts or timers made while signed out, the app asks
whether to keep them with the account or clear them. Closing without choosing keeps them. Kept labels
still clear at the end of the shift, at sign-out, at expiry and when a different account signs in.
Before this they were cleared at sign-in without a word.

If this summary and the source ever differ, the source wins.
