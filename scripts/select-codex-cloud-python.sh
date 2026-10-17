#!/usr/bin/env bash

set -Eeuo pipefail

select_codex_cloud_python() {
  local expected_version="$1"
  local command_name command_path actual_version host_path path_entry
  local candidates=("python${expected_version}" python3 python)
  local path_entry_seen=false
  local -a path_entries
  host_path=""
  # Compare entries literally: HOME may contain shell-pattern characters.
  # The extra delimiter preserves a trailing empty PATH entry when read into an array.
  IFS=: read -r -a path_entries <<< "${PATH}:"
  for path_entry in "${path_entries[@]}"; do
    [[ "$path_entry" == "$HOME/.cache/clinical-kb-codex/ocr-venv-${expected_version}/bin" ]] && continue
    if $path_entry_seen; then
      host_path+=:
    fi
    host_path+="$path_entry"
    path_entry_seen=true
  done

  for command_name in "${candidates[@]}"; do
    command_path="$(PATH="$host_path" command -v "$command_name" 2>/dev/null || true)"
    [[ -n "$command_path" ]] || continue
    actual_version="$("$command_path" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
    if [[ "$actual_version" = "$expected_version" ]]; then
      printf '%s\n' "$command_path"
      return 0
    fi
  done

  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  expected_version="${1:-3.12}"
  selected_python="$(select_codex_cloud_python "$expected_version" || true)"
  if [[ -z "$selected_python" ]]; then
    printf '[codex-cloud:python] ERROR: Python %s is unavailable. Pin Python %s in the Codex Cloud environment.\n' \
      "$expected_version" "$expected_version" >&2
    exit 1
  fi
  printf '%s\n' "$selected_python"
fi
