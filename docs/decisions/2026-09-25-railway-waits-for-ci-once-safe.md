# Decision: Railway will wait for CI, but only once that cannot freeze deploys

- **Status:** decided 2026-09-25
- **Source:** `docs/outstanding-issues.md`, find "turn Railway 'wait for CI' ON, but only once it cannot freeze deploys"

Railway's "wait for CI" setting will be turned on only after the failing Firefox and WebKit checks on main are fixed or taken out of the main gate, or Railway is shown to wait on the required checks alone (#HYSWAF). The owner then enables it on the app and worker services; until then the pre-merge checks remain the safeguard.

**Update 2026-10-21 (#3685).** Wait for CI froze production deploys. The live site stayed on `d4efdc48f` while about 31 merges went unshipped, because every commit with a failed run was dropped, including failures from the worker image scan, CI, the eval canary and scheduled monitors (see `docs/deployment-architecture.md`, find "Observed 2026-10-21"). The owner approved turning it off in their own words ("Go ahead with all recommendations please", 12:01Z, recommendation 1(a)). It is to be switched back on only once a narrower gate is ready. The owner makes the switch in the Railway dashboard.
If this summary and the source ever differ, the source wins.

**Update 2026-10-09.** The owner chose "Report only": on `main` the Firefox and WebKit browser matrix reports failures (red job, pinned `main-ci-failure` issue) but no longer fails the CI run, so it cannot skip a Railway deploy. The recurring WebKit failure was fixed the same day (#3393). That meets the first condition above, so Wait for CI can be enabled on the app and worker services.
