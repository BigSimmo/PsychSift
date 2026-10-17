#!/usr/bin/env bash

set -Eeuo pipefail

fail() {
  printf '[codex-cloud:shims] ERROR: %s\n' "$*" >&2
  exit 1
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run this script from the PsychSift repository."
cd "$repo_root"

# The documented launcher-name exception may use an existing generated profile;
# unexpected provider names must never be hidden by sourcing that profile.
if bash --noprofile --norc scripts/check-codex-cloud-raw-env.sh; then
  :
else
  raw_boundary_status="$?"
  case "$raw_boundary_status" in
    2) ;; # Restricted continuation; the raw boundary remains failed.
    *) exit "$raw_boundary_status" ;;
  esac
fi

expected_node_major="$(tr -cd '0-9' < .node-version)"
[[ -n "$expected_node_major" ]] || fail "Could not read the Node major from .node-version."

expected_npm_major="$(sed -n 's/.*"npm"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\)\.x".*/\1/p' package.json | head -n 1)"
[[ -n "$expected_npm_major" ]] || fail "Could not read the npm major from package.json engines.npm."

runtime_profile="$HOME/.clinical-kb-codex-cloud.sh"
[[ -f "$runtime_profile" ]] || fail "The generated Cloud runtime profile is unavailable; run setup first."

# shellcheck source=/dev/null
source "$runtime_profile"

node_version_supported() {
  local version="$1"
  local actual_major actual_minor actual_patch
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r actual_major actual_minor actual_patch <<< "$version"
  (( actual_major == 24 )) || return 1
  (( actual_minor > 15 )) && return 0
  (( actual_minor == 15 && actual_patch >= 0 ))
}

# Existing shims must never be picked as their own targets, so every PATH lookup below skips
# $HOME/.local/bin.
fallback_path=""
path_entry_seen=false
IFS=: read -r -a path_entries <<< "$PATH"
for path_entry in "${path_entries[@]}"; do
  [[ "$path_entry" == "$HOME/.local/bin" ]] && continue
  if $path_entry_seen; then
    fallback_path+=:
  fi
  fallback_path+="$path_entry"
  path_entry_seen=true
done
unset path_entries path_entry path_entry_seen

resolved_node_version=""
if command -v nvm >/dev/null 2>&1; then
  resolved_node_version="$(nvm version "$expected_node_major" 2>/dev/null || true)"
fi
if [[ -n "$resolved_node_version" && "$resolved_node_version" != "N/A" ]]; then
  node_bin="$NVM_DIR/versions/node/$resolved_node_version/bin"
else
  fallback_node="$(PATH="$fallback_path" command -v node 2>/dev/null || true)"
  [[ -n "$fallback_node" ]] || fail "Node ${expected_node_major} is unavailable through nvm or PATH."
  fallback_node_version="$("$fallback_node" -p 'process.versions.node' 2>/dev/null || true)"
  node_version_supported "$fallback_node_version" || fail "Node ${expected_node_major}.x >=24.15.0 and <25 is required; detected ${fallback_node_version:-unavailable}."
  node_bin="$(cd "$(dirname "$fallback_node")" && pwd)"
fi
node_version="$("$node_bin/node" -p 'process.versions.node' 2>/dev/null || true)"
node_version_supported "$node_version" || fail "Node ${expected_node_major}.x >=24.15.0 and <25 is required; detected ${node_version:-unavailable}."
# A hung npm/npx probe must fail validation so maintenance can rerun setup.
command -v timeout >/dev/null 2>&1 || fail "The timeout command is required to bound npm/npx version probes."
bounded_probe() {
  timeout -k 5s 30s "$@"
}
command_paths=()
# Resolve and validate every target before replacing any installed wrapper.
for command_name in node npm npx; do
  if [[ "$command_name" = node ]]; then
    command_path="$node_bin/node"
  else
    command_path=""
    if [[ -x "$node_bin/$command_name" ]]; then
      command_path="$node_bin/$command_name"
    else
      command_path="$(PATH="$fallback_path" command -v "$command_name" 2>/dev/null || true)"
    fi
    # Bundled tools can drift too; validate every selected npm/npx executable.
    if [[ -x "$command_path" ]]; then
      # Reject a failed or timed-out probe before parsing any version text it printed.
      tool_output=""
      if ! tool_output="$(PATH="$node_bin${fallback_path:+:$fallback_path}" bounded_probe "$command_path" --version 2>/dev/null)"; then
        tool_output=""
      fi
      tool_version="$(printf '%s\n' "$tool_output" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
      [[ "${tool_version%%.*}" = "$expected_npm_major" ]] ||
        fail "${command_name} ${expected_npm_major}.x is required (package.json engines.npm); detected ${tool_version:-unavailable}."
    fi
  fi
  [[ -x "$command_path" ]] || fail "${command_name} is unavailable in Node ${expected_node_major}."
  shim_target="$HOME/.local/bin/$command_name"
  if [[ ( -e "$shim_target" || -L "$shim_target" ) && ! -f "$shim_target" ]]; then
    fail "Shim target ${command_name} must be a regular file."
  fi
  command_paths+=("$command_path")
done

mkdir -p "$HOME/.local/bin"
shim_stage="$(mktemp -d "$HOME/.local/bin/.codex-shims.XXXXXX")"
trap 'rm -rf -- "$shim_stage"' EXIT
command_index=0
for command_name in node npm npx; do
  command_path="${command_paths[$command_index]}"
  command_index=$((command_index + 1))
  cat > "$shim_stage/$command_name" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
# Generated by scripts/install-codex-cloud-command-shims.sh. Re-running setup
# or maintenance replaces this wrapper through the same idempotent command.
. "$runtime_profile"
clean_path=""
path_entry_seen=false
IFS=: read -r -a path_entries <<< "\$PATH"
for path_entry in "\${path_entries[@]}"; do
  [[ "\$path_entry" == "\$HOME/.local/bin" ]] && continue
  if \$path_entry_seen; then
    clean_path+=:
  fi
  clean_path+="\$path_entry"
  path_entry_seen=true
done
unset path_entries path_entry path_entry_seen
if [[ -n "\$clean_path" ]]; then
  export PATH="$node_bin:\$clean_path"
else
  export PATH="$node_bin"
fi
unset clean_path
exec "$command_path" "\$@"
EOF
  chmod 0755 "$shim_stage/$command_name"
done
for command_name in node npm npx; do
  mv -f "$shim_stage/$command_name" "$HOME/.local/bin/$command_name"
done

printf '[codex-cloud:shims] PASS: node, npm, and npx load the generated Cloud profile.\n'
