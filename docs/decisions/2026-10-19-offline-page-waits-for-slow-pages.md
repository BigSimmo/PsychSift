# Decision: The offline page waits for a slow page while the browser is online

- **Status:** decided 2026-10-19
- **Source:** `public/sw.js`, find "deadline, which still catches a dead or captive connection (design audit D-20, owner yes 19 Oct"

On 19 Oct 2026 the owner agreed that a slow page should no longer be replaced by "PsychSift is
offline" after 3.5 seconds. The app now shows the offline page after 3.5 seconds only when the
browser reports itself offline, and otherwise keeps waiting up to 20 seconds, which still catches a
dead or captive connection.

If this summary and the source ever differ, the source wins.
