#!/usr/bin/env bash
# One registered hook owns the dependency order; Claude's hook-array scheduler is not an ordering API.
set -uo pipefail
repo_root="${CLAUDE_PROJECT_DIR:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"
start_dir="$(mktemp -d)" || {
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Session setup could not create temporary state; dependent setup was skipped."}}'
  exit 0
}
trap 'rm -rf -- "$start_dir"' EXIT
cat > "$start_dir/payload"
: > "$start_dir/bootstrap-output"
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  # Source in a fresh shell so bootstrap's exported Node PATH reaches every later step. An external
  # shell retains bootstrap's errexit behavior even though this wrapper handles failure nonfatally.
  bash -c 'source "$1" < "$3/payload" > "$3/bootstrap-output"; node "$2" "$3"' _ \
    "$repo_root/.claude/hooks/session-start.sh" "$repo_root/scripts/claude-session-start.mjs" "$start_dir"
else
  node "$repo_root/scripts/claude-session-start.mjs" "$start_dir"
fi
status=$?
if [ "$status" -ne 0 ]; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Session bootstrap failed; dependent setup was skipped. Review setup diagnostics before running checks."}}'
fi
exit 0
