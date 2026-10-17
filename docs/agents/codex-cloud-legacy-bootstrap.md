# Retained Codex Cloud bootstrap

These notes apply only to an explicitly selected legacy bootstrap. The
[Cloud operating policy](codex-cloud-environment.md) remains canonical; the
[archived profile runbook](../archive/codex-cloud-legacy-profile-2026-10-16.md)
records the older disposable-container setup. Current host-managed tasks do not
need this bootstrap merely because they run on Linux or in Codex Cloud.

The setup command remains `bash scripts/setup-codex-cloud.sh`; maintenance is
`bash scripts/maintain-codex-cloud.sh`. Both preserve the raw-shell admission
policy. Unexpected provider names stop setup, maintenance and the direct shim
installer. The direct installer alone permits the documented inherited
`GH_TOKEN`/`OPENAI_BASE_URL` exit `2` path; that remains a failed raw boundary.
No cache, scoped profile or child scrub makes the raw parent clean.

## Select one checkout and config home

Setup binds its generated `~/.clinical-kb-codex-cloud.sh` and command shims to
the selected physical Git checkout root. The profile returns before changing
environment or loading nvm in any other checkout. The shims remove their own
PATH entries there and dispatch the command already available on the remaining
PATH; they fail with exit `127` when no external command exists. Nested Git
repositories and other linked worktrees have different checkout identities.

Rerunning setup or maintenance against a generated profile bound to another
checkout fails before runtime work. Setup also refuses unmanaged runtime profiles
and symbolic-link shell startup destinations. Shim installation validates every
target and destination before staging all three wrappers. It refuses unmanaged
regular destination files and runtime targets inside the shim directory. Atomic
replacement replaces a destination symlink itself, preserving its runtime target.

Maintenance does not execute or infer a selection from an older profile without
a checkout marker. Select `CODEX_CLOUD_ACCESS_PROFILE=offline` or `connected`
explicitly when migrating it; maintenance then reruns setup with that selection
and any inherited base pin. Without an explicit selection it stops with guidance
instead of silently changing the access profile. Setup still rejects unmanaged
or symbolic-link runtime profiles.

The active shell policy is written to `${CODEX_HOME:-$HOME/.codex}/config.toml`.
Unrelated settings are preserved and the managed block is replaced atomically.
An existing config destination must be a regular file; directories and symbolic
links fail before runtime or profile writes.
The shell policy applies to that entire Codex config home. Use an isolated
`HOME` **and** `CODEX_HOME` for separate legacy installations or when other tasks
need a different shell policy. Do not point setup at a shared personal home to
provision an isolated environment.

Checkout guards protect fresh shells. A shell that already activated the legacy
profile retains its exports after changing directories; the bootstrap cannot
recover unknown earlier environment values. Use a fresh shell or a separate
scoped process when switching projects. Host proxy and CA variables are preserved
by the legacy profile; provider scrubbing keeps the existing inventory and policy.

## Checkout base cache

`refresh-codex-cloud-base.sh` writes the fetched merge base under
`~/.cache/clinical-kb-codex/checkouts/<sha256-of-physical-checkout-root>/cloud-expected-base-sha`.
Separate repositories and linked worktrees cannot replace one another's cached
base. The generated profile ignores the old home-wide `cloud-expected-base-sha`.
Moving a checkout requires a fresh setup/base refresh.

An explicitly supplied `CODEX_CLOUD_EXPECTED_BASE_SHA` always takes precedence,
including an empty or invalid value. Existing checkout validation must reject
invalid pins; setup must not silently repair them using a cached value.

## Inspect historical installed artifacts

Run `bash scripts/audit-codex-cloud-artifacts.sh --dry-run` from the selected
checkout for a bounded, provider-free inventory. It reports only known runtime
profile, command-shim, shell-startup, active Codex-config and base-cache paths.
It does not source profiles or execute Node/npm/npx. Generated markers, checkout
ownership and SHA-256 hashes help review existing files; the output never prints
their contents or credential values.

The inventory always stays read-only. Historical installs have no trusted
hash manifest, so a generated marker alone cannot prove that a file or managed
block still matches repository output. It cannot safely authorize automatic
uninstall or reconcile. Preserve host edits and unrelated config, review exact
managed blocks before retirement, and record any separately authorized cleanup.
This command does not remove installed CLIs, dependencies, Python environments,
browser caches, host memories or files belonging to other tools.

Source changes take effect only after the selected environment actually reruns
setup and a fresh session verifies its active config/profile. Local tests and
edited files do not establish activation on other hosts or in existing chats.
