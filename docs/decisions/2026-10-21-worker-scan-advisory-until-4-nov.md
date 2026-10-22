# Decision: Worker image scan findings are advisory until 4 November 2026

- **Status:** decided 2026-10-21
- **Source:** `scripts/trivy-image-scan.mjs`, find "The exemption ends by itself on this date"

On 21 Oct 2026 the owner approved, in the project chat ("Go ahead with all recommendations please",
answering the coordinator's list that named "make the worker scan report-only until 4 Nov"), making
HIGH and CRITICAL findings in the worker container image advisory on main until 4 Nov 2026. A red
image scan on main was holding up production deploys under Railway's Wait for CI while the worker
fixes in #3701 are finished. App image findings and any unassessed scan still fail, and the worker
exemption ends by itself on 4 Nov 2026.

If this summary and the source ever differ, the source wins.
