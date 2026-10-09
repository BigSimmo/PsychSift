# Decision: Railway will wait for CI, but only once that cannot freeze deploys

- **Status:** decided 2026-09-25
- **Source:** `docs/outstanding-issues.md`, find "turn Railway 'wait for CI' ON, but only once it cannot freeze deploys"

Railway's "wait for CI" setting will be turned on only after the failing Firefox and WebKit checks on main are fixed or taken out of the main gate, or Railway is shown to wait on the required checks alone (#HYSWAF). The owner then enables it on the app and worker services; until then the pre-merge checks remain the safeguard.

If this summary and the source ever differ, the source wins.

**Update 2026-10-09.** The owner chose "Report only": on `main` the Firefox and WebKit browser matrix reports failures (red job, pinned `main-ci-failure` issue) but no longer fails the CI run, so it cannot skip a Railway deploy. The recurring WebKit failure was fixed the same day (#3393). That meets the first condition above, so Wait for CI can be enabled on the app and worker services.
