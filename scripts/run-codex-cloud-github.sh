#!/usr/bin/env bash

# Opt-in lifecycle entrypoint for an owner-authorized GitHub-connected environment.
# Never trace a setup secret, including when the caller enabled bash -x.
set +x
set -Eeuo pipefail
umask 077

fail() {
  printf '[codex-cloud:github] %s\n' "$1" >&2
  exit 1
}

[[ "${CODEX_CLOUD:-}" == "1" && "${CODEX_CLOUD_ACCESS_PROFILE:-}" == "connected" ]] ||
  fail 'GH_CONNECTED_PROFILE_REQUIRED: use only in an explicitly authorized connected Cloud environment.'
[[ "$#" == "1" ]] || fail 'Usage: bash scripts/run-codex-cloud-github.sh setup|maintenance'
case "$1" in
  setup) lifecycle_script=scripts/setup-codex-cloud.sh ;;
  maintenance) lifecycle_script=scripts/maintain-codex-cloud.sh ;;
  *) fail 'Usage: bash scripts/run-codex-cloud-github.sh setup|maintenance' ;;
esac

# Reject an invalid retrieval selection before authentication can persist a
# credential. The connected legacy lifecycle remains provider-free for RAG.
rag_provider_mode="${RAG_PROVIDER_MODE-offline}"
[[ "$rag_provider_mode" == "offline" ]] ||
  fail 'GH_RAG_MODE_INVALID: the connected legacy profile requires RAG_PROVIDER_MODE=offline.'
export RAG_PROVIDER_MODE="$rag_provider_mode"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'GH_REPOSITORY_REQUIRED'
cd "$repo_root"

# Only the explicitly authorized setup-only PAT is exempt here. Validate every
# other inherited provider name before login, runtime restoration or helpers.
# Suppress the child's PASS line: this exception is not a raw-parent pass.
if (
  unset CODEX_CLOUD_GITHUB_PAT
  bash --noprofile --norc scripts/check-codex-cloud-raw-env.sh >/dev/null
); then
  :
else
  raw_boundary_status="$?"
  exit "$raw_boundary_status"
fi

command -v gh >/dev/null 2>&1 || fail 'GH_CLI_MISSING'
command -v timeout >/dev/null 2>&1 || fail 'GH_TIMEOUT_COMMAND_MISSING'

export GH_HOST=github.com
export GH_PROMPT_DISABLED=1
export GH_COLOR_LABELS=0
export NO_COLOR=1
export NODE_USE_ENV_PROXY=1
unset npm_config_http_proxy npm_config_https_proxy npm_config_proxy

if [[ -n "${CODEX_CLOUD_GITHUB_PAT:-}" ]]; then
  # gh owns its standard credential store; do not copy the token to profiles,
  # repository files, remote URLs, or command arguments. Suppress login output.
  if ! printf '%s' "$CODEX_CLOUD_GITHUB_PAT" |
    timeout 30s gh auth login --hostname github.com --git-protocol https --with-token >/dev/null 2>&1; then
    unset CODEX_CLOUD_GITHUB_PAT
    fail 'GH_LOGIN_FAILED: replace the encrypted setup secret and retry.'
  fi
fi
unset CODEX_CLOUD_GITHUB_PAT

# A damaged cache may need Node restored before the Node-based auth preflight.
# Keep this bootstrap smaller than dependency setup and never source a secret.
if ! node --version >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [[ -s "$NVM_DIR/nvm.sh" ]] || fail 'GH_NODE_RUNTIME_MISSING: provide the configured Node runtime or nvm.'
  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh" --no-use
  node_major="$(tr -cd '0-9' < .node-version)"
  [[ -n "$node_major" ]] || fail 'GH_NODE_VERSION_MISSING'
  nvm install "$node_major" >/dev/null 2>&1 || fail 'GH_NODE_RESTORE_FAILED'
  hash -r
fi
node scripts/ensure-codex-cloud-git-remote.mjs --configure-gh-helper

# Check missing/expired credentials, identity, protocol and scopes before installs.
# Maintenance can reuse the gh store when setup-only secrets are not injected.
node scripts/check-github-shell-access.mjs --authentication-only --allow-provider
bash "$lifecycle_script"
bash scripts/install-codex-cloud-command-shims.sh
gh auth setup-git --hostname github.com
# Toolchain repair is not GitHub acceptance; retain the complete final live gate.
npm run check:github-shell-access:live
