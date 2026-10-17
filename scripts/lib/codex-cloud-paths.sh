#!/usr/bin/env bash

# Shared by the explicitly selected legacy bootstrap only. The physical checkout
# path distinguishes repositories and linked worktrees sharing one home directory.
codex_cloud_checkout_key() {
  printf '%s' "$1" | sha256sum | awk '{print $1}'
}

codex_cloud_shell_quote() {
  local value="${1//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}
