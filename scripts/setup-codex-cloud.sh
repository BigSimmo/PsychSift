#!/usr/bin/env bash

set -Eeuo pipefail

log() {
  printf '[codex-cloud:setup] %s\n' "$*"
}

fail() {
  printf '[codex-cloud:setup] ERROR: %s\n' "$*" >&2
  return 1
}

require_npm_config() {
  local name="$1"
  local expected="$2"
  local actual
  actual="$(npm config get "$name")" || fail "Could not read npm config ${name}."
  [[ "$actual" = "$expected" ]] ||
    fail "npm config ${name} must be ${expected} for the locked Cloud install; detected ${actual:-unset}."
}

setup_step="initialization"
diagnostic_python_bin=""
policy_only_harness="${CODEX_CLOUD_SETUP_STOP_AFTER_POLICY:-0}"
diagnose_setup_failure() {
  local status="$?"
  trap - ERR
  if [[ "$policy_only_harness" = "1" ]]; then
    printf '[codex-cloud:setup] Setup failed during %s (exit %s; policy-only test harness).\n' "$setup_step" "$status" >&2
    printf '[codex-cloud:setup] FIX: review the first error above, then retry setup.\n' >&2
    exit "$status"
  fi
  printf '[codex-cloud:setup] Setup failed during %s (exit %s). Running local diagnostics.\n' "$setup_step" "$status" >&2
  if command -v node >/dev/null 2>&1 && [[ -f scripts/diagnose-codex-cloud.mjs ]]; then
    diagnostic_args=(--setup-step "$setup_step" --exit-code "$status")
    if [[ -n "$diagnostic_python_bin" ]]; then
      diagnostic_args+=(--python-bin "$diagnostic_python_bin")
    fi
    CODEX_CLOUD=1 node scripts/diagnose-codex-cloud.mjs "${diagnostic_args[@]}" || true
  else
    printf '[codex-cloud:setup] FIX: review the first error above, then retry setup.\n' >&2
  fi
  exit "$status"
}
trap diagnose_setup_failure ERR

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run this script from the PsychSift repository."
cd "$repo_root"

expected_node_major="$(tr -cd '0-9' < .node-version)"
expected_node_range="$(sed -n 's/.*"node"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n 1)"
expected_node_floor="$(printf '%s\n' "$expected_node_range" | sed -n 's/^>=\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\) <[0-9][0-9]*$/\1/p')"
expected_node_ceiling="$(printf '%s\n' "$expected_node_range" | sed -n 's/^>=[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]* <\([0-9][0-9]*\)$/\1/p')"
expected_npm_version="$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"npm@\([^"]*\)".*/\1/p' package.json | head -n 1)"
codex_cli_version="0.147.0"
expected_cloud_python="3.12"
[[ -n "$expected_node_major" ]] || fail "Could not read the Node major from .node-version."
[[ -n "$expected_node_floor" && -n "$expected_node_ceiling" ]] || fail "Could not read the bounded Node range from package.json engines.node."
[[ -n "$expected_npm_version" ]] || fail "Could not read the npm version from package.json."

node_version_supported() {
  local version="$1"
  local actual_major actual_minor actual_patch minimum_major minimum_minor minimum_patch
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r actual_major actual_minor actual_patch <<< "$version"
  IFS=. read -r minimum_major minimum_minor minimum_patch <<< "$expected_node_floor"

  (( actual_major < expected_node_ceiling )) || return 1
  (( actual_major > minimum_major )) && return 0
  (( actual_major == minimum_major )) || return 1
  (( actual_minor > minimum_minor )) && return 0
  (( actual_minor == minimum_minor )) || return 1
  (( actual_patch >= minimum_patch ))
}

# Codex Cloud supplies standards-based proxy variables as well. Remove npm's
# deprecated lowercase aliases before the first npm invocation.
unset npm_config_http_proxy npm_config_https_proxy npm_config_proxy

install_npm_cli() {
  local package_name="$1"
  local expected_version="$2"
  local command_name="$3"
  local actual_version
  actual_version="$("$command_name" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
  if [[ "$actual_version" != "$expected_version" ]]; then
    log "Installing ${package_name}@${expected_version}."
    npm install --global "${package_name}@${expected_version}"
    hash -r
    actual_version="$("$command_name" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
  fi
  [[ "$actual_version" = "$expected_version" ]] || fail "${command_name} ${expected_version} is required; detected ${actual_version:-unavailable}."
}

setup_step="node-runtime"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# The policy-only harness exercises shell configuration without executing or
# installing a runtime. Ordinary setup retains the full bootstrap below.
if [[ "$policy_only_harness" != "1" ]]; then
  setup_step="node-runtime"
  actual_node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  if ! node_version_supported "$actual_node_version"; then
    [[ -s "$NVM_DIR/nvm.sh" ]] || fail "Node ${expected_node_range} is required; detected ${actual_node_version:-unavailable}. Select it in the Codex Cloud environment or provide nvm."
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh"
    log "Installing and selecting Node ${expected_node_major}.x to satisfy ${expected_node_range}."
    nvm install "$expected_node_major"
    nvm alias default "$expected_node_major"
    nvm use "$expected_node_major"
  fi

  actual_node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  node_version_supported "$actual_node_version" || fail "Node ${expected_node_range} is required; detected ${actual_node_version:-unavailable}."

  if [[ "$(npm --version)" != "$expected_npm_version" ]]; then
    log "Installing the repository npm version ${expected_npm_version}."
    npm install --global "npm@${expected_npm_version}"
    hash -r
  fi
fi

setup_step="runtime-profile"
access_profile="${CODEX_CLOUD_ACCESS_PROFILE:-offline}"
case "$access_profile" in
  offline|connected) ;;
  *) fail "Unsupported CODEX_CLOUD_ACCESS_PROFILE: $access_profile" ;;
esac

# Resolve the retrieval mode at setup time so the generated profile pins the
# value configured in the Codex environment. The agent shell does not inherit
# these variables, so a runtime `${RAG_PROVIDER_MODE:-auto}` fallback would
# override a connected environment configured for offline retrieval.
if [[ "$access_profile" = "connected" ]]; then
  rag_provider_mode="${RAG_PROVIDER_MODE:-offline}"
  [[ "$rag_provider_mode" = "offline" ]] ||
    fail "Ordinary Codex Cloud must keep RAG_PROVIDER_MODE=offline; run live OpenAI checks only in the protected provider workflow."
else
  rag_provider_mode="offline"
fi

runtime_profile="$HOME/.clinical-kb-codex-cloud.sh"
setup_step="runtime-profile"
cat > "$runtime_profile" <<EOF
# Generated by scripts/setup-codex-cloud.sh. Re-running setup replaces this file.
export NVM_DIR="\${NVM_DIR:-\$HOME/.nvm}"
if [ -s "\$NVM_DIR/nvm.sh" ]; then
  . "\$NVM_DIR/nvm.sh"
  nvm use --silent ${expected_node_major} >/dev/null 2>&1 || true
fi
export PATH="\$HOME/.local/bin:\$HOME/.deno/bin:\$HOME/.cache/clinical-kb-codex/ocr-venv-${expected_cloud_python}/bin:\$PATH"
export CODEX_CLOUD_OCR_PYTHON="\$HOME/.cache/clinical-kb-codex/ocr-venv-${expected_cloud_python}/bin/python"
export CODEX_CLOUD=1
export CODEX_CLOUD_ACCESS_PROFILE="${access_profile}"
export NEXT_PUBLIC_DEMO_MODE="\${NEXT_PUBLIC_DEMO_MODE:-true}"
export PLAYWRIGHT_OFFLINE_MODE="\${PLAYWRIGHT_OFFLINE_MODE:-true}"
cloud_expected_base_file="\$HOME/.cache/clinical-kb-codex/cloud-expected-base-sha"
if [ -r "\$cloud_expected_base_file" ]; then
  IFS= read -r cloud_expected_base < "\$cloud_expected_base_file" || true
  if [[ "\$cloud_expected_base" =~ ^[0-9a-f]{40}\$ ]]; then
    export CODEX_CLOUD_EXPECTED_BASE_SHA="\$cloud_expected_base"
  fi
fi
unset cloud_expected_base cloud_expected_base_file
unset npm_config_http_proxy npm_config_https_proxy npm_config_proxy
# Connected access is provided by host-installed, OAuth-backed apps, never by
# repository MCP registration or raw provider variables in the agent shell.
# Scrub the complete inventory in both profiles in case setup-only secrets were inherited.
unset OPENAI_API_KEY OPENAI_ORG_ID OPENAI_PROJECT_ID OPENAI_BASE_URL
unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY
unset SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY
unset SUPABASE_PROJECT_REF SUPABASE_PROJECT_NAME SUPABASE_STAGING_PROJECT_REF SUPABASE_STAGING_PROJECT_NAME
unset SUPABASE_ACCESS_TOKEN SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL DATABASE_URL POSTGRES_PASSWORD
unset CROSS_TENANT_SERVICE_ROLE_KEY
unset RAILWAY_API_TOKEN RAILWAY_TOKEN
unset GH_TOKEN GITHUB_TOKEN GITLAB_TOKEN GLAB_TOKEN CODEX_TRIGGER_TOKEN CODEX_CLOUD_GITHUB_PAT
unset HEALTH_DEEP_PROBE_SECRET INDEXING_V3_AGENT_SECRET
unset FIGMA_CLIENT_ID FIGMA_CLIENT_SECRET FIGMA_ACCESS_TOKEN FIGMA_PERSONAL_ACCESS_TOKEN
unset FIGMA_TOKEN FIGMA_NPM_TOKEN
unset SENTRY_AUTH_TOKEN SENTRY_DSN NEXT_PUBLIC_SENTRY_DSN
unset E2E_AUTH_ENABLED E2E_USER_EMAIL E2E_USER_PASSWORD ALLOW_PROVIDER_TESTS
if [ "\$CODEX_CLOUD_ACCESS_PROFILE" = "connected" ]; then
  export RAG_PROVIDER_MODE="${rag_provider_mode}"
else
  export CODEX_CLOUD_ACCESS_PROFILE=offline
  export RAG_PROVIDER_MODE=offline
  export NEXT_PUBLIC_DEMO_MODE=true
  export PLAYWRIGHT_OFFLINE_MODE=true
fi
EOF

# Codex spawns commands through a policy in ~/.codex/config.toml. Inheriting the
# whole environment while relying only on the CLI's name-based default excludes
# leaks provider variables that do not look credential-like (e.g. SUPABASE_URL,
# DATABASE_URL) into shells that never source the runtime profile above, so
# exclude the full provider inventory explicitly. Only the managed block is
# rewritten; any other Codex CLI settings (mcp_servers, model, profiles, notify)
# already in the file are preserved across setup/maintenance re-runs.
codex_shell_policy_excludes=(
  OPENAI_API_KEY OPENAI_ORG_ID OPENAI_PROJECT_ID OPENAI_BASE_URL
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY
  SUPABASE_PROJECT_REF SUPABASE_PROJECT_NAME SUPABASE_STAGING_PROJECT_REF SUPABASE_STAGING_PROJECT_NAME
  SUPABASE_ACCESS_TOKEN SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL DATABASE_URL POSTGRES_PASSWORD
  CROSS_TENANT_SERVICE_ROLE_KEY
  RAILWAY_API_TOKEN RAILWAY_TOKEN
  GH_TOKEN GITHUB_TOKEN GITLAB_TOKEN GLAB_TOKEN CODEX_TRIGGER_TOKEN CODEX_CLOUD_GITHUB_PAT
  HEALTH_DEEP_PROBE_SECRET INDEXING_V3_AGENT_SECRET
  FIGMA_CLIENT_ID FIGMA_CLIENT_SECRET FIGMA_ACCESS_TOKEN FIGMA_PERSONAL_ACCESS_TOKEN
  FIGMA_TOKEN FIGMA_NPM_TOKEN
  SENTRY_AUTH_TOKEN SENTRY_DSN NEXT_PUBLIC_SENTRY_DSN
  E2E_AUTH_ENABLED E2E_USER_EMAIL E2E_USER_PASSWORD ALLOW_PROVIDER_TESTS
)
codex_exclude_toml=""
for exclude_var in "${codex_shell_policy_excludes[@]}"; do
  [[ -n "$codex_exclude_toml" ]] && codex_exclude_toml+=", "
  codex_exclude_toml+="\"$exclude_var\""
done

codex_config_dir="$HOME/.codex"
codex_config_file="$codex_config_dir/config.toml"
mkdir -p "$codex_config_dir"
codex_policy_begin="# BEGIN clinical-kb-codex-cloud shell policy (managed by setup-codex-cloud.sh)"
codex_policy_end="# END clinical-kb-codex-cloud shell policy (managed by setup-codex-cloud.sh)"
if [[ -f "$codex_config_file" ]]; then
  # An interrupted prior write can leave BEGIN without END. The sed range below
  # would then delete from BEGIN to EOF and discard unrelated settings, so fail
  # before rewriting rather than silently truncating preserved config.
  if grep -Fq "$codex_policy_begin" "$codex_config_file" && ! grep -Fq "$codex_policy_end" "$codex_config_file"; then
    fail "Incomplete managed shell policy block in $codex_config_file; remove the incomplete BEGIN marker before re-running setup."
  fi
  codex_config_preserved="$(sed "/^${codex_policy_begin}\$/,/^${codex_policy_end}\$/d" "$codex_config_file")"
  # After stripping the managed block, reject every supported TOML declaration
  # of shell_environment_policy before appending ours. This covers bare or
  # quoted table headers, dotted keys, and inline tables, while full-line
  # comments are ignored.
  if printf '%s\n' "$codex_config_preserved" | sed '/^[[:space:]]*#/d' | grep -Eq \
    '^[[:space:]]*\[[^]]*shell_environment_policy[^]]*\]|^[[:space:]]*[^[:space:]]*shell_environment_policy[^[:space:]]*[[:space:]]*\.|^[[:space:]]*[^[:space:]]*shell_environment_policy[^[:space:]]*[[:space:]]*=[[:space:]]*\{'; then
    fail "Unmanaged [shell_environment_policy] table found in $codex_config_file; remove it before re-running setup."
  fi
else
  codex_config_preserved=""
fi

# Write beside the destination then rename it atomically. If setup is
# interrupted or output fails, the existing Codex configuration remains intact.
codex_config_candidate="$(mktemp "$codex_config_dir/.config.toml.XXXXXX")"
trap 'rm -f "$codex_config_candidate"' EXIT
{
  if [[ -n "$codex_config_preserved" ]]; then
    printf '%s\n' "$codex_config_preserved"
  fi
  printf '%s\n' "$codex_policy_begin"
  printf '[shell_environment_policy]\n'
  printf 'inherit = "all"\n'
  printf 'ignore_default_excludes = false\n'
  printf 'exclude = [%s]\n' "$codex_exclude_toml"
  printf '%s\n' "$codex_policy_end"
} > "$codex_config_candidate"
if [[ "${CODEX_CLOUD_SETUP_TEST_FAIL_ATOMIC_WRITE:-0}" = "1" ]]; then
  log "Forcing failure after writing the atomic candidate (test harness)."
  false
fi
mv -f "$codex_config_candidate" "$codex_config_file"
trap - EXIT

# Test harness only: write the runtime profile + shell policy, then stop before
# toolchain installs so unit tests can exercise config merge without a runtime.
if [[ "$policy_only_harness" = "1" ]]; then
  log "Stopping after shell-policy write (test harness)."
  exit 0
fi

profile_source='[ -f "$HOME/.clinical-kb-codex-cloud.sh" ] && . "$HOME/.clinical-kb-codex-cloud.sh"'
for shell_profile in "$HOME/.bashrc" "$HOME/.profile" "$HOME/.bash_profile"; do
  touch "$shell_profile"
  if ! grep -Fq '.clinical-kb-codex-cloud.sh' "$shell_profile"; then
    printf '\n# PsychSift Codex Cloud runtime\n%s\n' "$profile_source" >> "$shell_profile"
  fi
done

# shellcheck source=/dev/null
source "$runtime_profile"

log "Installing locked Node dependencies."
setup_step="node-dependencies"
require_npm_config force false
require_npm_config legacy-peer-deps false
require_npm_config ignore-scripts false
require_npm_config package-lock true
require_npm_config package-lock-only false
require_npm_config offline false
require_npm_config dry-run false
npm ci --include=dev --prefer-offline --no-audit --no-fund

setup_step="codex-cli"
install_npm_cli "@openai/codex" "$codex_cli_version" "codex"

setup_step="git-remote"
node scripts/ensure-codex-cloud-git-remote.mjs --configure-gh-helper

setup_step="checkout-base"
bash scripts/refresh-codex-cloud-base.sh
# shellcheck source=/dev/null
source "$runtime_profile"

setup_step="deno-runtime"
if ! command -v deno >/dev/null 2>&1 || [[ "$(deno --version 2>/dev/null | sed -n '1s/^deno \([0-9]*\).*/\1/p')" != "2" ]]; then
  log "Installing Deno 2.x."
  npm install --global 'deno@2'
  hash -r
fi

setup_step="system-packages"
# shellcheck source=scripts/select-codex-cloud-python.sh
source scripts/select-codex-cloud-python.sh
python_bin="$(select_codex_cloud_python "$expected_cloud_python" || true)"
[[ -n "$python_bin" ]] ||
  fail "Python ${expected_cloud_python} is required for the Cloud worker lock. Pin Python ${expected_cloud_python} in the Codex Cloud environment."
system_packages=()
if ! command -v tesseract >/dev/null 2>&1; then
  system_packages+=(tesseract-ocr)
fi
if ! "$python_bin" -c 'import venv' >/dev/null 2>&1; then
  system_packages+=("python${expected_cloud_python}-venv")
fi

if (( ${#system_packages[@]} > 0 )); then
  command -v apt-get >/dev/null 2>&1 || fail "apt-get is unavailable; required system packages cannot be installed."
  log "Installing required system packages: ${system_packages[*]}."
  if [[ "$(id -u)" -eq 0 ]]; then
    apt-get update
    apt-get install -y --no-install-recommends "${system_packages[@]}"
  elif command -v sudo >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends "${system_packages[@]}"
  else
    fail "System package installation requires root or sudo."
  fi
fi

python_bin="$(select_codex_cloud_python "$expected_cloud_python" || true)"
[[ -n "$python_bin" ]] || fail "Python ${expected_cloud_python} is unavailable after system package setup."
actual_python_version="$($python_bin -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
[[ "$actual_python_version" = "$expected_cloud_python" ]] || fail "Python ${expected_cloud_python} is required for the Cloud worker lock; detected ${actual_python_version}. Select Python ${expected_cloud_python} in the Cloud environment."
ocr_venv="$HOME/.cache/clinical-kb-codex/ocr-venv-${expected_cloud_python}"
if [[ ! -x "$ocr_venv/bin/python" ]]; then
  log "Creating the cached Python OCR environment."
  "$python_bin" -m venv "$ocr_venv"
fi
diagnostic_python_bin="$ocr_venv/bin/python"
log "Installing Python worker requirements."
setup_step="python-worker-requirements"
"$ocr_venv/bin/python" -m pip install --disable-pip-version-check --require-hashes -r worker/python/requirements-cloud.txt
"$ocr_venv/bin/python" -m pip check
requirements_marker="$ocr_venv/.requirements-cloud.sha256"
requirements_marker_candidate="${requirements_marker}.tmp"
sha256sum worker/python/requirements-cloud.txt | awk '{print $1}' > "$requirements_marker_candidate"
mv -f "$requirements_marker_candidate" "$requirements_marker"
"$ocr_venv/bin/python" -c 'from importlib.metadata import version; print("medspacy=%s spacy=%s" % (version("medspacy"), version("spacy")))'
export CODEX_CLOUD_OCR_PYTHON="$ocr_venv/bin/python"

if [[ "${CODEX_CLOUD_SKIP_BROWSER_INSTALL:-0}" = "1" ]]; then
  log "Browser installation explicitly skipped; browser checks will be unavailable."
else
  log "Installing the Playwright Chromium, Firefox, and WebKit matrix."
  setup_step="playwright-browsers"
  ./node_modules/.bin/playwright install --with-deps chromium firefox webkit
fi

setup_step="final-validation"
npm run check:runtime
npm run check:installed-lock-parity
npm run check:worker-python-locks:static
npm run check:codex-cloud
CODEX_CLOUD_PROVISIONING=1 npm run check:codex-cloud -- --runtime
CODEX_CLOUD=1 npm run diagnose:codex-cloud
trap - ERR
log "Setup complete with ${CODEX_CLOUD_ACCESS_PROFILE} access profile."
