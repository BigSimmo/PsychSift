# Decision: Widen the desktop home page Lighthouse limit instead of removing its loading skeleton

- **Status:** decided 2026-10-22
- **Source:** `scripts/check-lighthouse-budget.mjs`, find "This floor covers the slow group on"

On 22 Oct 2026 the owner chose to give the desktop home page (`desktop-root`) a 700 ms LCP floor in
the Lighthouse budget, leaving the other three measured pages on the 200 ms runner floor. The home
page sometimes paints its loading skeleton before the real heading, which made the check fail about
half of all pull requests at random. Removing the skeleton was tried first and measured: the heading
then painted first, but the check's simulated LCP got slower, so the skeleton stays.

If this summary and the source ever differ, the source wins.
