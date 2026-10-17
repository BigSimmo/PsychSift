# Codex Cloud guide

_Updated 2026-10-16. This page is navigation; the linked operating policy is the authority._

## Scope and selection

Use current-host capability checks. Read [the canonical Cloud operating policy](agents/codex-cloud-environment.md)
for startup/resume, models, tools, authorisation, credentials and failure handling. Do not apply a
copied task prompt or historical setup as a universal Cloud prerequisite.

The [archived legacy bootstrap](archive/codex-cloud-legacy-profile-2026-10-16.md)
applies only when explicitly selected by the owner or environment, or when testing/repairing it.
Its executable checks remain fail-closed. The archive is not a fallback operating policy.

Within that explicitly selected legacy workflow, setup prepends the generated sanitized profile
to `.bashrc`, `.profile` and `.bash_profile`, ahead of shell early-return guards, and installs
profile-loading `node`/`npm`/`npx` shims. Maintenance validates and reloads the profile, then
reinstalls those shims before acceptance checks. The selected legacy checker can load its generated
profile when shell PATH ordering bypasses a shim; that child-process protection does not prove the
raw parent clean or select the legacy workflow for an unrelated current host. Raw-boundary guards
still run before setup or maintenance mutations; follow the canonical recovery policy below.

Setup writes shell exclusions to the selected `CODEX_HOME/config.toml`, falling back to
`~/.codex/config.toml` only when `CODEX_HOME` is unset. It preserves unrelated settings and
rejects conflicting shell policies before replacing the generated runtime profile. These
files protect subsequent child commands; they do not remove variables from an existing parent.
The shim installer validates all three target commands before replacing any installed wrapper,
so an incompatible npm/npx fallback leaves the existing wrappers intact.
This includes bundled npm/npx binaries beside Node. Setup and shim installation reject directories
at file destinations before replacing anything. Maintenance reruns setup when shim validation
fails, retaining the ordinary raw-boundary checks on that repair path.

The Python selector removes cached virtual-environment PATH entries using literal comparisons,
including repeated entries and home directories containing brackets or spaces. Local diagnostic
version probes have a five-second timeout; an unresponsive tool is reported as unavailable.

## Tools and authentication

Retired imported review prompts have been removed, including the old full-stack master prompt,
its stress-test commentary and its duplicate working agreement. Use the maintained
[detailed-task prompt](prompts/codex-cloud-detailed-task.md) and canonical operating policy for new
work. The supported optional legacy runbook and dated audit evidence remain available.

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
