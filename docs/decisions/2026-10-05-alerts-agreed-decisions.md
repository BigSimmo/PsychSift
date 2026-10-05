# Decision: Four rules for the app-wide alerts system

- **Status:** decided 2026-10-05
- **Source:** the owner's reply "Yes to all your recommendations" (5 October 2026, 14:01 UTC) to the four decisions in the "PsychSift Alerts" mock-up (v4), recorded in the project's alerts thread.

1. **The server holds only the due time.** For Remind me notes and timers, the server may store when something is due so it can buzz a closed app, never the words. The words stay on the device.
2. **Quiet hours break through only for two things:** a change to a shift starting within 12 hours, and the reader's own reminder at the exact time they set.
3. **After a night shift the morning brief waits until 14:00.**
4. **Renewal dates always stay in My Day.** Hiding or snoozing the compliance-date reminder quietens On Call's own nudges, but never removes a renewal date from My Day, and renewals get no separate alert outside the morning brief.

Rule 4 is built in `src/components/my-day/sources/entries.ts` (PR "Alerts: one Alerts page under My Day"). Rules 1 to 3 apply to the timed sender, which is not built yet.
