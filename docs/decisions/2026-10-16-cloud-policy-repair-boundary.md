# Decision: permit bounded local policy repair after a failed environment probe

- **Status:** decided 2026-10-16
- **Source:** `docs/agents/codex-cloud-environment.md`, find "A failed raw-boundary check does not prohibit an explicitly requested local policy review or repair."

Following the owner's request to review and edit the environment policies, bounded local policy
inspection and repair can proceed after a failed probe. In a selected legacy profile, application
and provider execution remain blocked; neither a policy edit nor a sanitized child process repairs
its raw parent boundary. See the separate legacy-profile scope decision for other host environments.

If this summary and the source ever differ, the source wins.
