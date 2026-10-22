# Decision: Every mode names its side, and Work is one list in one order

- **Status:** decided 2026-10-21
- **Source:** `src/lib/app-modes.ts`, find "The two sides of the app (owner decision, 21 Oct 2026)"

The owner decided the app has two sides, Clinical and Work, and kept the name Clinical. Each mode now
declares its side, and the Work areas are one list in one order everywhere: My Day, On Call, Roster,
Teaching, CPD, Admin, with My Day as the front page of Work. The Clinical sidebar clean-up is deferred.
The full direction is in `docs/product/clinical-and-work-direction.md`.

If this summary and the source ever differ, the source wins.
