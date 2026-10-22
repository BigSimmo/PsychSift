# Decision: CI failure alerts on main @mention the owner

- **Status:** decided 2026-10-21; superseded by 2026-10-21-one-daily-health-summary.md
- **Source:** `.github/workflows/ci.yml`, find "workflow no longer @mentions or assigns the owner"

On 21 Oct 2026 the owner approved, by decision card in the project's RAG and ingestion audit thread,
the change to `.github/workflows/ci.yml` that makes the CI-on-main failure alert @mention the owner in
each new alert issue and each repeat comment (audit EVAL-04). It follows the phone-alert channel chosen
on 19 Oct ([`2026-10-19-production-alerts-by-phone.md`](2026-10-19-production-alerts-by-phone.md)).
The edit changes the alert wording only, not which checks must pass, and it is the owner's yes behind
that pull request's `Required check change approved:` line.

If this summary and the source ever differ, the source wins.
