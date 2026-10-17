#!/usr/bin/env bash

set -Eeuo pipefail

fail() {
  printf '[codex-cloud:base] ERROR: %s\n' "$*" >&2
  exit 1
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run this script from the PsychSift repository."
cd "$repo_root"
repo_root="$(pwd -P)"
# shellcheck source=scripts/lib/codex-cloud-paths.sh
source scripts/lib/codex-cloud-paths.sh

git fetch --quiet --no-tags origin '+refs/heads/main:refs/remotes/origin/main' ||
  fail "Could not refresh origin/main."

expected_base="$(git merge-base HEAD refs/remotes/origin/main 2>/dev/null)" ||
  fail "Could not determine the checkout merge base with origin/main."
[[ "$expected_base" =~ ^[0-9a-f]{40}$ ]] || fail "The checkout merge base is not a full Git commit SHA."

checkout_key="$(codex_cloud_checkout_key "$repo_root")"
cache_dir="$HOME/.cache/clinical-kb-codex/checkouts/$checkout_key"
expected_base_file="$cache_dir/cloud-expected-base-sha"
mkdir -p "$cache_dir"
chmod 0700 "$cache_dir"
expected_base_candidate="$(mktemp "$cache_dir/.cloud-expected-base-sha.XXXXXX")"
trap 'rm -f "$expected_base_candidate"' EXIT
printf '%s\n' "$expected_base" > "$expected_base_candidate"
chmod 0600 "$expected_base_candidate"
mv -f "$expected_base_candidate" "$expected_base_file"
trap - EXIT

printf '[codex-cloud:base] PASS: expected_base=%s origin_main_refreshed=true\n' "$expected_base"
