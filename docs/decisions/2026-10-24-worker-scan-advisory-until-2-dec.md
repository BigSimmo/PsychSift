# Decision: Worker image scan findings stay advisory until 2 December 2026

- **Status:** decided 2026-10-24
- **Source:** `scripts/trivy-image-scan.mjs`, find "Extended from 4 Nov to 2 Dec 2026 by owner decision 2026-10-24"

On 24 Oct 2026 the owner chose "Extend to 2 Dec, recheck weekly" on a decision card in the project
thread. The 24 HIGH and CRITICAL findings in the worker container image (#3741, libxml2 first) had
no fixed version available, so ending the exemption on 4 Nov would have turned main red with nothing
to upgrade. The worker exemption now ends by itself on 2 Dec 2026. Each week the daily scan summary
is checked and any package with a new fixed release is upgraded. App image findings and any
unassessed scan still fail. This replaces the 4 Nov date in
`2026-10-21-worker-scan-advisory-until-4-nov.md`.

If this summary and the source ever differ, the source wins.
