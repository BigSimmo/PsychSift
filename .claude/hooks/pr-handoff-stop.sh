#!/usr/bin/env bash
# Deny CronCreate for the rest of a session that has opened its own pull request.
#
# Why: a cron entry parked on a PR outlives the session, so nothing later can
# stop it. Everything else about following a PR — reading checks and run logs,
# re-running a failed job, syncing the branch, pushing fixes, waiting between
# looks — is governed by docs/agents/pull-request-workflow.md#follow-ci and
# the applicable authorization. Bare publication stops at the URL. Where CI
# follow is in scope, stop when CI settles and never park a cron job on it.
# This hook enforces only the one
# clause prose cannot: cron survives the session that created it.
#
# Two modes, both registered in .claude/settings.json:
#
#   post  PostToolUse — after a call that created a PR (the `gh pr create` CLI
#         or a GitHub MCP create_pull_request tool) AND whose output contains
#         a real PR URL, drop a session-scoped marker so pre-mode knows this
#         session has an open PR.
#
#   pre   PreToolUse — while that marker exists, deny CronCreate. Every other
#         tool call passes untouched.
#
# `Run PR` sweeps, pr-ci-fix work, and reviews of someone else's PR are
# untouched: they never create a PR, so no marker is ever written.
#
# Contract: never fails a tool call by accident. Any parse problem — a
# malformed payload, an unreadable marker — exits 0 with no decision, which
# leaves the tool call exactly as it was.
set -uo pipefail

mode="${1:-}"
case "$mode" in
post | pre) ;;
*) exit 0 ;;
esac

# Read stdin with the `read` builtin instead of `$(cat)`: one fewer fork+exec on
# every Bash/PowerShell call, and not slower — measured from 1 KB to 2 MB it wins
# below 256 KB and draws above. `read -d ''` consumes to EOF and reports non-zero
# *there* having already filled the variable, so `|| true` is the expected path.
payload=""
IFS= read -r -d '' payload || true
[ -z "$payload" ] && exit 0

# --- fast reject, before any subprocess ---------------------------------------
# Both modes are registered on EVERY Bash/PowerShell call, and in almost all of
# them there is nothing to do.

# Post mode acts only when tool_response carries a `github.com/<…>/pull/<n>` URL
# (the URL gate in the post branch). That match is case-sensitive, so the raw
# payload must contain the lowercase bytes `pull`; JSON escaping `/` as `\/`
# cannot hide them. The `\u` arm keeps the claim airtight against a hypothetical
# encoder emitting `pull`.
if [ "$mode" = post ]; then
  case "$payload" in
  *pull* | *\\u*) ;;
  *) exit 0 ;;
  esac
fi

# Pre mode acts only on CronCreate — nothing else is denied — so reject every
# other tool call before doing any JSON extraction or git-dir resolution at all.
if [ "$mode" = pre ]; then
  case "$payload" in
  *CronCreate*) ;;
  *) exit 0 ;;
  esac
fi

# Resolve the git directory the way `git rev-parse --absolute-git-dir` does, with
# builtins only. fast_git_dir is left EMPTY whenever the answer is not certain —
# any of git's own discovery controls being set, a `.git` file that does not
# resolve, a cwd that is itself a git dir, or no repository above cwd — and every
# one of those falls through to the authoritative `git rev-parse` below.
#
# The discovery controls are load-bearing, not decoration. GIT_CEILING_DIRECTORIES
# in particular stops git ascending, so from a ceiling-excluded subdirectory git
# reports NO repository and the marker belongs in TMPDIR — while a naive upward
# walk finds the excluded checkout's `.git` and puts it there instead. Those two
# answers disagreeing across a post/pre pair is exactly how this guard would stop
# firing, so treat every discovery control as uncertain rather than guessing.
fast_git_dir=""
resolve_fast_git_dir() {
  # Keep in sync with git's discovery controls; an unrecognised one must fail
  # closed to `git rev-parse`, never be walked past.
  [ -n "${GIT_DIR:-}${GIT_COMMON_DIR:-}${GIT_WORK_TREE:-}${GIT_CEILING_DIRECTORIES:-}${GIT_DISCOVERY_ACROSS_FILESYSTEM:-}" ] && return 0
  # cwd is itself a git dir (bare repo): walking up would find a different repo.
  [ -f "$PWD/HEAD" ] && [ -d "$PWD/objects" ] && [ -d "$PWD/refs" ] && return 0
  local dir="$PWD" line target
  while :; do
    if [ -d "$dir/.git" ]; then
      fast_git_dir="$dir/.git"
      return 0
    fi
    if [ -f "$dir/.git" ]; then
      # Linked worktree: a one-line `gitdir: <path>` pointer.
      IFS= read -r line <"$dir/.git" 2>/dev/null || return 0
      line="${line%$'\r'}"
      case "$line" in
      "gitdir: "*)
        target="${line#gitdir: }"
        case "$target" in
        /* | [A-Za-z]:[/\\]*) ;;
        *) target="$dir/$target" ;;
        esac
        [ -d "$target" ] && fast_git_dir="$target"
        ;;
      esac
      return 0
    fi
    case "$dir" in "" | /) break ;; esac
    dir="${dir%/*}"
    [ -z "$dir" ] && dir=/
  done
  return 0
}
resolve_fast_git_dir

# Pre mode's entire job is gated on this session's marker existing (a PR must
# already be open before CronCreate is denied), and no marker is written until
# this session opens a PR. The id is read with bash's own regex engine and
# accepted only in the same safe charset the full parse enforces, so a
# path-injection id matches nothing here and falls through to be rejected there.
# `-e`, not `-f`: anything present at that path defers to the slow path rather
# than short-circuiting it.
if [ "$mode" = pre ] && [ -n "$fast_git_dir" ]; then
  if [[ "$payload" =~ \"session_id\"[[:space:]]*:[[:space:]]*\"([A-Za-z0-9_-]+)\" ]]; then
    [ -e "$fast_git_dir/claude-pr-handoff-${BASH_REMATCH[1]}" ] || exit 0
  fi
fi

# Extract a JSON string value for key $1 from the raw payload (first match).
# Handles only simple double-quoted values (no escapes). Empty on miss.
# Callers that need shell-token matching must also scan $payload when
# jq_available=0 — this helper truncates at the first escaped quote inside
# the JSON string (e.g. `git commit -m \"msg\" && gh pr checks` → `git commit -m \`).
json_string_field() {
  local key="$1"
  printf '%s' "$payload" \
    | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
    | head -n1 \
    | sed -E 's/.*"([^"]*)"$/\1/'
}

# --- payload fields -----------------------------------------------------------
# jq when available (exact). Without jq:
#   - tool_name / session_id from crude key extraction
#   - command_text from tool_input command/script/code/input fields when present,
#     else the whole payload (pre-mode still needs a searchable string for the
#     PR-write-tool check below)
#   - tool_output ONLY from the tool_response region — never the whole payload,
#     and never a suffix that still contains a later tool_input (so an input URL
#     cannot satisfy the post-mode URL gate when keys are ordered response-first)
jq_available=0
if command -v jq >/dev/null 2>&1; then
  jq_available=1
  tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  # Bash uses .command; PowerShell payloads may use script/code/input instead.
  command_text="$(printf '%s' "$payload" | jq -r '
    .tool_input.command // .tool_input.script // .tool_input.code // .tool_input.input // empty
  ' 2>/dev/null || true)"
  tool_output="$(printf '%s' "$payload" | jq -r '[.tool_response] | tostring' 2>/dev/null || true)"
  session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null || true)"
else
  tool_name="$(json_string_field tool_name)"
  session_id="$(json_string_field session_id)"
  command_text="$(json_string_field command)"
  [ -z "$command_text" ] && command_text="$(json_string_field script)"
  [ -z "$command_text" ] && command_text="$(json_string_field code)"
  [ -z "$command_text" ] && command_text="$(json_string_field input)"
  # If no command-like field was found, scan the input half of the payload only —
  # never tool_response — so a printed `gh pr create` cannot look like a create.
  if [ -z "$command_text" ]; then
    if printf '%s' "$payload" | grep -Fq '"tool_response"'; then
      command_text="${payload%%\"tool_response\"*}"
    else
      command_text="$payload"
    fi
  fi
  if printf '%s' "$payload" | grep -Fq '"tool_response"'; then
    # Prefer a string-valued tool_response when the crude extractor can see it.
    tool_output="$(json_string_field tool_response)"
    if [ -z "$tool_output" ]; then
      # Complex/non-string response: take the slice after tool_response, but
      # stop before a later tool_input so an input URL cannot pass the gate.
      tool_output="${payload#*\"tool_response\"}"
      case "$tool_output" in
      *\"tool_input\"*) tool_output="${tool_output%%\"tool_input\"*}" ;;
      esac
    fi
  else
    tool_output=""
  fi
fi

# Post-mode create-token matching: decoded command, plus (jq-less) only the
# payload half *before* tool_response. Scanning tool_response would let a
# command that merely prints `gh pr create` + a PR URL lock the session.
shell_input_matches() {
  local re="$1"
  printf '%s' "$command_text" | grep -Eq "$re" && return 0
  if [ "$jq_available" -eq 0 ]; then
    local input_half="${payload%%\"tool_response\"*}"
    printf '%s' "$input_half" | grep -Eq "$re" && return 0
  fi
  return 1
}

# Missing or unsafe session ids fail open: do not share an unknown-session
# marker across unrelated malformed payloads (path injection included).
if [ -z "$session_id" ] || ! printf '%s' "$session_id" | grep -Eq '^[A-Za-z0-9_-]+$'; then
  exit 0
fi

# --- marker location ----------------------------------------------------------
# Absolute git dir so the marker path is valid from any cwd (and for linked
# worktrees). The builtin resolver above answers this without spawning git in
# the ordinary cases; `git rev-parse` stays the authority everywhere it did not.
# Falls back to TMPDIR outside a repo.
git_dir="$fast_git_dir"
[ -z "$git_dir" ] && git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
[ -z "$git_dir" ] && git_dir="${TMPDIR:-/tmp}"
marker="$git_dir/claude-pr-handoff-$session_id"

# Intentionally do not prune sibling sessions' markers. Post-mode runs on every
# Bash/PowerShell call (settings matcher), so age-based deletion of *other*
# sessions' files would disarm a session that still has an open PR. Markers are
# one-line files under the git dir and disappear with the worktree; leftover
# orphans are cheap hygiene, not worth silent enforcement loss.

json_escape() {
  # Escape backslash/quote, fold newlines to spaces, and strip other C0 control
  # characters so a future multi-line deny reason cannot emit unparseable JSON.
  printf '%s' "$1" \
    | tr '\n\r\t' '   ' \
    | tr -d '\000-\010\013\014\016-\037' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

is_shell_tool() {
  case "$tool_name" in
  "" | Bash | PowerShell) return 0 ;;
  *) return 1 ;;
  esac
}

case "$mode" in
post)
  # A PR-creating call that actually returned a PR URL. Both halves matter:
  # without the URL check a failed create would mark this session as having an
  # open PR with nothing to babysit.
  created=1
  if is_shell_tool && shell_input_matches 'gh[[:space:]]+pr[[:space:]]+create'; then
    created=0
  fi
  # End-anchor required: create_pull_request_review / _review_comment must NOT
  # count as opening a PR (pre-mode already uses the same anchored shape).
  if printf '%s' "$tool_name" | grep -Eqi 'create_?pull_?request$'; then
    created=0
  fi
  [ "$created" -eq 0 ] || exit 0
  # Require a non-empty tool_output that itself carries a PR URL. An empty
  # tool_output (jq-less payload with no tool_response key) must not match.
  [ -n "$tool_output" ] || exit 0
  printf '%s' "$tool_output" | grep -Eq 'github\.com/[^ "]+/pull/[0-9]+' || exit 0

  # Only tell the model a PR is open when the marker actually landed. A failed
  # write (permissions / full disk) must fail open with no context — otherwise
  # the model would think CronCreate is guarded when it is not.
  if ! printf 'pr-opened %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" >"$marker" 2>/dev/null; then
    exit 0
  fi
  [ -f "$marker" ] || exit 0

  context="The pull request is open: hand over its URL. Follow docs/agents/pull-request-workflow.md#follow-ci within the requested scope: bare publication stops at the URL; where CI observation is in scope, fix only this change's breakage and stop as soon as CI settles. Never park a cron job on this PR; it would outlive the session."
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$(json_escape "$context")"
  exit 0
  ;;

pre)
  [ -f "$marker" ] || exit 0
  [ "$tool_name" = "CronCreate" ] || exit 0

  printf -v quoted_marker '%q' "$marker"
  reason="Blocked: a cron entry parked on this pull request outlives the session, so nothing later could stop it. Where CI observation is authorized, inspect the current host's supported wait or terminal-event tools and use a bounded wait; if unavailable, report pending CI and stop. Follow docs/agents/pull-request-workflow.md#follow-ci. Unlock only on an explicit user ask, by deleting the marker in Bash: CLAUDE_ALLOW_PR_FOLLOW=1 rm -- $quoted_marker"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$(json_escape "$reason")"
  exit 0
  ;;

*)
  exit 0
  ;;
esac
