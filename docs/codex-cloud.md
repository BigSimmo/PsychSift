# Codex Cloud guide

_Updated 2026-10-16. This page is navigation; the linked operating policy is the authority._

## Scope and selection

Use current-host capability checks. Read [the canonical Cloud operating policy](agents/codex-cloud-environment.md)
for startup/resume, models, tools, authorisation, credentials and failure handling. Do not apply a
copied task prompt or historical setup as a universal Cloud prerequisite.

The [archived legacy bootstrap](archive/codex-cloud-legacy-profile-2026-10-16.md)
applies only when explicitly selected by the owner or environment, or when testing/repairing it.
Its executable checks remain fail-closed. The archive is not a fallback operating policy.

## Tools and authentication

For the cross-client Desktop/CLI template versus a separately installed/authenticated workspace app,
see [tools and providers](agents/codex-cloud-environment.md#tools-providers-and-credentials).
Readiness comes from the current host and actual callable tools, not a recorded account tier.

### Raw-boundary failure and local policy repair

See [the current recovery policy](agents/codex-cloud-environment.md#raw-boundary-failure-and-local-policy-repair).
It defines the selected legacy boundary and bounded local repair; no credential bypass is authorised.

### Policy and environment activation

See [activation and retained context](agents/codex-cloud-environment.md#activation-and-retained-context).
Host settings, repository content and loaded chat context are separate layers. Publication and
verified activation remain separate from a local edit.
