# Decision: CI routing follows the shared publication modules

- **Status:** decided 2026-10-22
- **Source:** `scripts/ci-change-scope.mjs`, find "Shared server-only publication readers/DTOs previously lived under worker/"

On 22 Oct 2026 the owner approved, by decision card in the project's governance clean-up thread, the
changes PR #3764 makes to `.github/workflows/ci.yml` and `scripts/ci-change-scope.mjs`. Ingestion SAST
and the worker container build now also run when the publication modules that moved from `worker/` to
`src/lib/publication/` change, and those modules keep their earlier exclusion from the Lighthouse lane.
The retired repo-awareness snapshot also stops triggering browser journeys. Which checks must pass is
unchanged. This is the owner's yes behind that pull request's `Required check change approved:` line.

If this summary and the source ever differ, the source wins.
