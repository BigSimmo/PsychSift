#!/usr/bin/env bash
# PreToolUse — block `git push` when the tree is not Prettier-clean.
#
# Why this exists at all, given .githooks/pre-push already checks formatting:
# `core.hooksPath` is set by *this checkout's* `npm install`. An agent session
# that pushes from an environment where that never ran — Claude Code on the web,
# a fresh container, a worktree created without an install — bypasses the git
# hook entirely, and only CI catches the break. AGENTS.md records three CI
# failures on 2026-07-30 from exactly this, two of them on a file the author had
# not edited (a per-file `prettier --check` passed while the repository-wide
# check failed).
#
# So this hook deliberately does NOT duplicate the git hook. It runs ONLY when
# the git hook is absent or not wired to this repo's .githooks directory — i.e.
# exactly the gap case. In a normally installed checkout it exits in
# milliseconds having done nothing, and `guard-push.mjs` remains the real gate
# (it is stricter: it checks the *pushed commit* in an isolated worktree, not
# the working tree, which is a check this hook cannot perform).
#
# Escape hatch: prefix the command with CLAUDE_ALLOW_UNFORMATTED_PUSH=1.
#
# Contract: never fails a tool call by accident. Any parse problem, missing
# dependency, or unexpected state exits 0 with no decision, leaving the call
# exactly as it was. Failing open is correct here — the git hook and CI are both
# still downstream.
set -uo pipefail

# Read stdin with the `read` builtin instead of `$(cat)`. That is one fewer
# fork+exec on every single Bash/PowerShell tool call, and it is not slower:
# measured against payloads from 1 KB to 2 MB it is faster below 256 KB and
# level above. `read -d ''` consumes to EOF and reports non-zero *there* having
# already filled the variable, so the `|| true` is the expected path.
payload=""
IFS= read -r -d '' payload || true
[ -z "$payload" ] && exit 0

# --- cheapest possible discriminator, before any subprocess -------------------
# This hook runs on EVERY Bash/PowerShell call but acts only on `git push`, and
# reaching "not a push" used to cost two jq runs, a grep and a subshell — on
# Windows/Git Bash that is well over a second of pure process-spawn latency per
# tool call. The test below uses shell builtins only.
#
# It is deliberately a SUPERSET of the real check further down
# (`git`, optional global options such as `-C <dir>`, then `push`), so it can only ever let MORE through, never less: that
# regex cannot match unless the bytes `git` appear before the bytes `push`,
# whether the command reaches it jq-decoded, grep-extracted, or as the raw
# payload. The `\u` arm covers the one theoretical gap in that argument — an
# encoder emitting `\u0067it push` — at the cost of taking the slow path for the
# rare payload carrying a unicode escape. Anything rejected here would have
# exited at that regex anyway.
case "$payload" in
*git*push* | *\\u*) ;;
*) exit 0 ;;
esac

# --- extract the command ------------------------------------------------------
if command -v jq >/dev/null 2>&1; then
  tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  command_text="$(printf '%s' "$payload" | jq -r '
    .tool_input.command // .tool_input.script // .tool_input.code // empty
  ' 2>/dev/null || true)"
else
  tool_name="$(printf '%s' "$payload" \
    | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | head -n1 | sed -E 's/.*"([^"]*)"$/\1/')"
  # Quote-naive extraction truncates at the first escaped quote, so fall back to
  # the whole payload for matching. Over-matching is the safe direction here: the
  # worst case is one extra Prettier run on a command that merely mentions a push.
  command_text="$(printf '%s' "$payload" \
    | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | head -n1 | sed -E 's/.*"([^"]*)"$/\1/')"
  [ -z "$command_text" ] && command_text="$payload"
fi

case "$tool_name" in
"" | Bash | PowerShell) ;;
*) exit 0 ;;
esac

# --- is this a push? ----------------------------------------------------------
printf '%s' "$command_text" | grep -Eq '(^|[;&|[:space:]])git([[:space:]]+(-[Cc][[:space:]]+("[^"]*"|[^[:space:]]+)|--?[[:alnum:]-]+(=[^[:space:]]*)?))*[[:space:]]+push([[:space:]]|$)' || exit 0

# --- documented escape hatch (leading prefix only, not an incidental mention) --
printf '%s' "$command_text" \
  | grep -Eq '^[[:space:]]*CLAUDE_ALLOW_UNFORMATTED_PUSH=1([[:space:]]|$)' && exit 0

# --- only act in the gap case: the repo's pre-push hook is not wired ----------
repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -z "$repo_root" ] && exit 0
hooks_path="$(git -C "$repo_root" config --get core.hooksPath 2>/dev/null || true)"
if [ -n "$hooks_path" ]; then
  # Normalise Windows backslashes so a native `git config` value compares equal
  # to the POSIX path this script sees.
  normalised="$(printf '%s' "$hooks_path" | tr '\\' '/')"
  repo_root_n="$(printf '%s' "$repo_root" | tr '\\' '/')"
  repo_root_n="${repo_root_n%/}"
  common_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || git -C "$repo_root" rev-parse --git-common-dir 2>/dev/null || true)"
  if [ -n "$common_dir" ]; then
    case "$common_dir" in
    /* | ?:/*) primary_root_n="$(dirname "$common_dir" | tr '\\' '/')" ;;
    *) primary_root_n="$(cd "$repo_root" && cd "$common_dir/.." 2>/dev/null && pwd | tr '\\' '/')" ;;
    esac
    primary_root_n="${primary_root_n%/}"
  else
    primary_root_n="$repo_root_n"
  fi
  # `core.hooksPath` is absolute OR relative to the top of the working tree, and
  # git treats `.githooks`, `./.githooks` and the absolute spelling as the same
  # directory. Resolve to one form before comparing. A `*/.githooks` suffix glob
  # cannot do that: it needs a `/` before the name, so it silently missed the
  # bare relative value this repo's own `npm install` writes — leaving the guard
  # running a full-repository Prettier check on every push in a checkout that was
  # in fact correctly wired (measured at >100 s per push on the Windows
  # workstation, 2026-08-22).
  case "$normalised" in
  /* | ?:/*) resolved="$normalised" ;;
  *) resolved="$repo_root_n/${normalised#./}" ;;
  esac
  resolved="${resolved%/}"
  expected="$repo_root_n/.githooks"
  expected_primary="$primary_root_n/.githooks"
  # Windows drive-letter paths are case-insensitive, and Bash `=` is not. Git
  # wires `d:/Database/.githooks` and `D:/Database/.githooks` to the same
  # directory, so comparing the raw bytes puts the primary (Windows ReFS Dev
  # Drive) workstation straight back into the >100 s full-repository Prettier
  # run this whole check exists to avoid. Fold case only for the unambiguous
  # `X:/...` spelling: the MSYS `/c/...` form is byte-identical to a real POSIX
  # path, where case IS significant, and folding that could silently
  # self-disable the guard against a FOREIGN hooks directory — the unsafe
  # direction. Testing `resolved` alone is enough: a relative `core.hooksPath`
  # has already been joined onto `repo_root_n`, so it inherits that form.
  case "$resolved" in
  ?:/*)
    resolved="$(printf '%s' "$resolved" | tr '[:upper:]' '[:lower:]')"
    expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
    expected_primary="$(printf '%s' "$expected_primary" | tr '[:upper:]' '[:lower:]')"
    ;;
  esac
  # Exact equality, not a suffix match: another repository's `.githooks` also
  # ends in `/.githooks`, and its pre-push hook would not guard THIS push.
  # Pair each path match with THAT tree's pre-push: a match on the primary
  # plus an executable hook only in the worktree (or the reverse) is the
  # unwired case this guard exists to catch.
  if { [ "$resolved" = "$expected" ] && [ -x "$repo_root/.githooks/pre-push" ]; } \
    || { [ "$resolved" = "$expected_primary" ] && [ -x "$primary_root_n/.githooks/pre-push" ]; }; then
    exit 0
  fi
fi

# --- run the repository-wide check, never a per-file one ---------------------
# Per-file is not the repository-wide check: on 2026-07-30 a doc/ledger edit in
# the same push was the missed file twice out of three, while `prettier --check`
# on the edited source file passed.
command -v npx >/dev/null 2>&1 || exit 0
[ -d "$repo_root/node_modules/prettier" ] || exit 0

if unformatted="$(cd "$repo_root" && npx --no-install prettier --check . 2>&1)"; then
  exit 0
fi

json_escape() {
  printf '%s' "$1" \
    | tr '\n\r\t' '   ' \
    | tr -d '\000-\010\013\014\016-\037' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

offenders="$(printf '%s' "$unformatted" | grep -E '^\[warn\] ' | head -n 8 | sed 's/^\[warn\] //' | tr '\n' ' ')"
reason="Blocked: this push would land unformatted files, and this checkout has no wired .githooks/pre-push guard to catch it, so CI would be the first thing to fail (AGENTS.md records three such CI failures on 2026-07-30). Unformatted: ${offenders:-see prettier output}. Fix with: npm run format — then COMMIT the result, because a push sends commits and not your working tree, so formatting after committing leaves the unformatted blob on the branch. Override for this one command with the CLAUDE_ALLOW_UNFORMATTED_PUSH=1 prefix."

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$(json_escape "$reason")"
exit 0
