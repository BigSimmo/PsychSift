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
printf '0\n' > "$start_dir/bootstrap-status"
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  # A source in an OR-list disables errexit inside the bootstrap. Use an EXIT trap in a fresh
  # shell instead: it records the first failure (including explicit exit), retains exported PATH,
  # and starts the independent guidance runner without resuming failed bootstrap commands.
  bash -s -- "$repo_root/.claude/hooks/session-start.sh" "$repo_root/scripts/claude-session-start.mjs" "$start_dir" <<'BOOTSTRAP_WRAPPER'
exec 3>&1
trap 'status=$?; trap - EXIT; printf "%s\n" "$status" > "$3/bootstrap-status"; runner_status=0; node "$2" "$3" >&3 || runner_status=$?; exit "$runner_status"' EXIT
source "$1" < "$3/payload" > "$3/bootstrap-output"
BOOTSTRAP_WRAPPER
else
  node "$repo_root/scripts/claude-session-start.mjs" "$start_dir"
fi
status=$?
if [ "$status" -ne 0 ]; then
  cat "$start_dir/bootstrap-output" >&2
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Session hook runner failed; cloud provisioning was not verified. Review hook diagnostics before running checks."}}'
fi
exit 0
