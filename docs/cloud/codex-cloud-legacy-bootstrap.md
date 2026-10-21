# Retained Codex Cloud bootstrap

These notes apply only to an explicitly selected legacy bootstrap. The
[Cloud operating policy](../agents/codex-cloud-environment.md) remains canonical; the
[archived profile runbook](../archive/codex-cloud-legacy-profile-2026-10-16.md)
records the older disposable-container setup. Current host-managed tasks do not
need this bootstrap merely because they run on Linux or in Codex Cloud.

The setup command remains `bash scripts/setup-codex-cloud.sh`; maintenance is
`bash scripts/maintain-codex-cloud.sh`. Both preserve the raw-shell admission
policy. Unexpected provider names stop setup, maintenance and the direct shim
installer. The direct installer alone permits the documented inherited
`GH_TOKEN`/`OPENAI_BASE_URL` exit `2` path; that remains a failed raw boundary.
No cache, scoped profile or child scrub makes the raw parent clean.

## Optional Python 3.12 dependency lock

The selected legacy bootstrap installs `worker/python/requirements-cloud.txt`
with `--require-hashes`. Its source is `worker/python/requirements-cloud.in`,
which includes the shared OCR requirements and constrains Cython to the range
required by quicksectx 0.4.1 (`>=0.25,<3.2.0`). Regenerate with Python 3.12:

```bash
PYTHON_BIN=python3.12 npm run generate:worker-python-cloud-lock
```

The native generator uses pip-tools 7.6.0, resolves dependencies and emits hashes;
do not hand-edit versions or hashes in the generated lock. After an authorised,
coordinated regeneration, install that exact file in a fresh Python 3.12 venv
with `python -m pip install --require-hashes -r worker/python/requirements-cloud.txt`,
then require `python -m pip check` to succeed. A static lock-header check alone
does not prove dependency resolution or installation.

The default worker Docker image uses Python 3.11 and
`worker/python/requirements.txt`, generated from `requirements.in`. An optional
Cloud-lock failure does not establish a default worker failure. Never install
the production lock on Python 3.12 as a substitute: medspaCy has different
spaCy constraints for the two Python versions.

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

An older generated profile has no checkout marker, so it records no owner. Setup
rewrites it for whichever worktree runs setup first, which means a second
worktree can take over a shared home. Use an isolated `HOME` and `CODEX_HOME`
per worktree when more than one checkout shares a machine.

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

## Run an explicitly selected command in an isolated scope

Use the subprocess wrapper when the legacy bootstrap has been explicitly selected and a host is
shared. Choose a new scope directory beneath an existing real parent, then keep that same scope
for maintenance of this checkout:

```bash
bash scripts/with-isolated-cloud-home.sh --root /absolute/private/psychsift-cloud -- bash scripts/setup-codex-cloud.sh
bash scripts/with-isolated-cloud-home.sh --root /absolute/private/psychsift-cloud -- bash scripts/maintain-codex-cloud.sh
```

Select `CODEX_CLOUD_ACCESS_PROFILE` explicitly as required by setup; the wrapper does not select
an access profile, provision anything by itself or grant provider authority. These examples are
operational commands, not routine startup checks. A provider-free way to inspect the scoped file
state after an authorized installation is:

```bash
node scripts/cloud-activation-evidence.mjs --installed-home /absolute/private/psychsift-cloud/home --codex-home /absolute/private/psychsift-cloud/codex --claude-config-dir /absolute/private/psychsift-cloud/claude
```

The wrapper requires Bash, Python 3 and Git. It creates three private directories (`home`, `codex`
and `claude`) and sets `HOME`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR` only in the selected child. It
preserves standard input, command arguments and exit status. The parent shell and personal homes
are unchanged. Proxy/CA and other inherited environment values remain inherited; no credentials,
configuration or personal files are copied. This is directory isolation, not an environment scrub
or process sandbox. Legacy setup's raw-shell admission and all provider boundaries still apply.

An existing scope must have the wrapper's exact physical-checkout/user ownership record and private
directory permissions. Unowned or foreign directories, symlink path components, modified ownership
records and unsafe replacement home directories fail closed before launching the child. Scope
ownership is local provenance, not content integrity or session-loading proof. Use a different new
scope for another checkout; preserve an old scope for explicit review instead of rewriting its
record. The wrapper does not clean up scopes or adopt existing personal homes.

This wrapper does not change the retained migration contract: an older generated legacy profile
without a checkout marker still migrates through explicit setup, and markerless maintenance still
requires an explicit access-profile choice. The wrapper never executes or copies that historical
profile automatically.

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
