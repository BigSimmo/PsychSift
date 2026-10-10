# Decision: New job progress reaches Medical Workforce only when the doctor opts in

- **Status:** decided 2026-10-10
- **Source:** `src/lib/work-roles/hospital-starters.ts`, find "Owner request (10 Oct 2026)"

A doctor's New job progress is shared with Medical Workforce at their hospital, and the site administrator,
only after the doctor turns on "Share my progress with Medical Workforce" on their own New job page. It is off
until they do and they can turn it off any time. What is shared is their name, team, start date, how many
items are done and the titles of items still to do. Personal items are never shared, not even in the count.

If this summary and the source ever differ, the source wins.
