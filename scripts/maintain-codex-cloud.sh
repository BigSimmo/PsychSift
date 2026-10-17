#!/usr/bin/env bash

set -Eeuo pipefail

fail() {
  printf '[codex-cloud:maintenance] ERROR: %s\n' "$1" >&2
  exit 1
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf '[codex-cloud:maintenance] ERROR: Run this script from the PsychSift repository.\n' >&2
  exit 1
}
cd "$repo_root"
repo_root="$(pwd -P)"

if bash --noprofile --norc scripts/check-codex-cloud-raw-env.sh; then
  :
else
  raw_boundary_status="$?"
  exit "$raw_boundary_status"
fi

# A cached profile must not hide an invalid inherited selection. Retain an
# explicit valid selection so a different cached profile cannot replace it.
requested_cloud_profile_set="${CODEX_CLOUD_ACCESS_PROFILE+yes}"
requested_cloud_profile="${CODEX_CLOUD_ACCESS_PROFILE-}"
if [[ "$requested_cloud_profile_set" = "yes" ]]; then
  case "$requested_cloud_profile" in
    offline|connected) ;;
    *) fail "Unsupported CODEX_CLOUD_ACCESS_PROFILE; expected offline or connected." ;;
  esac
fi
requested_cloud_rag_mode="${RAG_PROVIDER_MODE:-offline}"
requested_base_set="${CODEX_CLOUD_EXPECTED_BASE_SHA+yes}"
if [[ "$requested_cloud_profile" = "connected" && "$requested_cloud_rag_mode" != "offline" ]]; then
  fail "The selected legacy Codex Cloud profile must keep RAG_PROVIDER_MODE=offline."
fi
# Setup pins offline selections and normalizes empty connected modes to offline.
# Keep the requested mode separately until the cached profile choice is known.
export RAG_PROVIDER_MODE=offline

runtime_profile="$HOME/.clinical-kb-codex-cloud.sh"
if [[ ! -f "$runtime_profile" ]]; then
  printf '[codex-cloud:maintenance] Generated runtime profile unavailable; rerunning full setup.\n'
  exec bash scripts/setup-codex-cloud.sh
fi
if grep -q '^# PsychSift checkout: ' "$runtime_profile"; then
  grep -Fqx "# PsychSift checkout: $repo_root" "$runtime_profile" ||
    fail "The cached runtime profile belongs to another checkout; use an isolated HOME and CODEX_HOME."
else
  printf '[codex-cloud:maintenance] Legacy runtime profile format; regenerating it.\n'
  exec bash scripts/setup-codex-cloud.sh
fi

load_runtime_profile() {
  # A base loaded by this maintenance process may be refreshed below. Only the
  # pin inherited when maintenance started is an explicit task selection.
  if [[ "$requested_base_set" != yes ]]; then
    unset CODEX_CLOUD_EXPECTED_BASE_SHA
  fi
  # shellcheck source=/dev/null
  source "$runtime_profile"
  case "${CODEX_CLOUD_ACCESS_PROFILE-}" in
    offline|connected) ;;
    *) fail "Cached CODEX_CLOUD_ACCESS_PROFILE is invalid; rerun setup with the intended profile." ;;
  esac
  if [[ "$requested_cloud_profile_set" = "yes" && "$CODEX_CLOUD_ACCESS_PROFILE" != "$requested_cloud_profile" ]]; then
    fail "Cached CODEX_CLOUD_ACCESS_PROFILE differs from the requested profile; rerun setup with the intended profile."
  fi
  if [[ "$CODEX_CLOUD_ACCESS_PROFILE" = "connected" && "$requested_cloud_rag_mode" != "offline" ]]; then
    fail "The selected legacy Codex Cloud profile must keep RAG_PROVIDER_MODE=offline."
  fi
  [[ "${RAG_PROVIDER_MODE-}" = "offline" ]] ||
    fail "The cached legacy Codex Cloud profile must keep RAG_PROVIDER_MODE=offline; rerun setup."
}

export CODEX_CLOUD=1
load_runtime_profile

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '[codex-cloud:maintenance] Node/npm unavailable; rerunning full setup.\n'
  exec bash scripts/setup-codex-cloud.sh
fi

node scripts/ensure-codex-cloud-git-remote.mjs --configure-gh-helper
bash scripts/refresh-codex-cloud-base.sh
load_runtime_profile
bash scripts/install-codex-cloud-command-shims.sh
npm run check:codex-cloud
if ! CODEX_CLOUD_PROVISIONING=1 npm run check:codex-cloud -- --runtime; then
  printf '[codex-cloud:maintenance] Runtime or toolchain drift detected; rerunning full setup.\n'
  exec bash scripts/setup-codex-cloud.sh
fi

printf '[codex-cloud:maintenance] PASS: Cloud runtime and repository toolchain are current.\n'
