#!/usr/bin/env bash
# PreToolUse (Bash) — pre-approve read-only GitHub lookups. The decision logic and
# its reasoning live in github-read-allow.mjs beside this file.
#
# This wrapper exists only to keep the cost off every other tool call: it runs on
# every Bash call, so it rejects anything that cannot mention `gh` with shell
# builtins before paying for a Node start (well over 100 ms on the Windows
# workstation). Fails open: no node, or any error, means no decision.
set -uo pipefail

payload=""
IFS= read -r -d '' payload || true
[ -z "$payload" ] && exit 0

case "$payload" in
*gh*) ;;
*) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '%s' "$payload" | node "$script_dir/github-read-allow.mjs" 2>/dev/null || true
exit 0
