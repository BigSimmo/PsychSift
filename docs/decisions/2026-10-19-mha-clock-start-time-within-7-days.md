# Decision: An MHA clock start time can be at most 7 days back

- **Status:** decided 2026-10-19
- **Source:** `src/components/psychiatry/mha-clock-page.tsx`, find "always a mistyped month or year (owner decision, 19 Oct 2026)"

On 19 Oct 2026 the owner chose a 7-day limit on how far back an MHA clock start time can be
entered. The longest time limit on any form the clock lists is 144 hours, so an older start time is
almost always a mistyped month or year. The page refuses it and asks the reader to check the date.
Future start times were already refused.

If this summary and the source ever differ, the source wins.
