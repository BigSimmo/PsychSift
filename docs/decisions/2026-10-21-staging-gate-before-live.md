# Decision: Two-doctor separation is proven on staging before a change goes live, behind a switch the owner turns on

- **Status:** decided 2026-10-21
- **Source:** `.github/workflows/staging-tenancy.yml`, find "THE STAGING GATE (owner decision 2026-10-21"

On 21 Oct 2026 the owner approved master plan section 1: prove that one doctor cannot see another's On Call
or Roster data, and add a staging step with an automatic check before anything goes live. Each push to `main`
that changes the app now waits for staging to run that commit (or an earlier one with the same app files) and
runs the two-doctor check against it. The check stays off until the owner sets the repository variable
`STAGING_GATE_ENFORCE` to `true`, so it cannot hold up a live deploy while staging is being rebuilt or `main`
is red. Two settings on the staging service must be in place before the switch goes on: staging must
deploy each `main` push by itself (it did not on 21 Oct 2026, so the check could only report staging as
stale), and Railway's Wait for CI must be off there, because staging would otherwise wait for this check
while the check waits for staging. If staging has already moved on to a newer commit with different app
files, the check holds this commit's live deploy rather than passing it untested; the newer commit's own run
decides, and it carries this commit's changes. A dispatched release proof still needs
staging on the exact candidate commit.

If this summary and the source ever differ, the source wins.
