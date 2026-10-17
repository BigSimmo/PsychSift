# Decision: repair Cloud setup and remove obsolete imported prompts

- **Status:** decided 2026-10-17
- **Source:** `docs/codex-cloud.md`, find "Retired imported review prompts have been removed"
- **Retires:** `cloud-imported-working-agreement`

The owner requested setup repairs, improvements and removal of stale files. Setup now respects
the selected Codex configuration directory and preserves an existing runtime profile when
configuration admission fails. Shim target validation precedes wrapper replacement. The three
old imported review inputs and their scanner exemptions are removed; retained legacy tooling
and dated audit evidence remain. These repairs do not establish a clean raw parent environment.

A follow-up audit covers cached Python PATH filtering, bundled npm/npx compatibility,
non-file output targets, maintenance recovery after shim validation failure and bounded local
diagnostic probes. Regression tests use temporary directories and synthetic executables.

If this summary and the source ever differ, the source wins.
