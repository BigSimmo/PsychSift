# Decision: Two-doctor separation is proven on staging before a change goes live, behind a switch the owner turns on

- **Status:** decided 2026-10-21
- **Source:** `.github/workflows/staging-tenancy.yml`, find "THE STAGING GATE (owner decision 2026-10-21"

On 21 Oct 2026 the owner approved master plan section 1: prove that one doctor cannot see another's On Call
or Roster data, and add a staging step with an automatic check before anything goes live. Each push to `main`
that changes the app now waits for staging to run that commit (or an earlier one with the same app files) and
runs the two-doctor check against it. The check stays off until the owner sets the repository variable
`STAGING_GATE_ENFORCE` to `true`, so it cannot hold up a live deploy while staging is being rebuilt or `main`
is red. Railway's Wait for CI must be off on the staging service before the switch goes on, because staging
would otherwise wait for this check while the check waits for staging. A dispatched release proof still needs
staging on the exact candidate commit.

If this summary and the source ever differ, the source wins.
