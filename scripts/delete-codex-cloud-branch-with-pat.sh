#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  printf 'Usage: %s <non-protected-branch>\n' "${0##*/}" >&2
  exit 64
}

fail() {
  printf '[operator:github-pat] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "$#" -eq 1 ]] || usage
branch="$1"
[[ "$branch" != -* ]] || fail "Refusing an option-like branch name."
[[ "${CODEX_CLOUD:-0}" != "1" ]] || fail "Cloud secrets are unavailable during the agent phase; use native Push, the GitHub connector, or GitHub UI."
[[ -n "${CODEX_CLOUD_GITHUB_PAT:-}" ]] || fail "CODEX_CLOUD_GITHUB_PAT is unavailable; this operator-only helper must run outside Codex Cloud."

# heads/, tags/ and remotes/ prefixes resolve to another ref (heads/main -> refs/heads/main).
case "$branch" in
  main|master|develop|release|release/*|HEAD|HEAD/*|refs/*|heads/*|tags/*|remotes/*|*..*|*~*|*@\{*|*\\*|*\ *|"")
    fail "Refusing to delete a protected or invalid branch name."
    ;;
esac
git check-ref-format --branch "$branch" >/dev/null || fail "Invalid branch name."
expected_origin="https://github.com/BigSimmo/PsychSift.git"
[[ "$(git config --get remote.origin.url 2>/dev/null || true)" = "$expected_origin" ]] ||
  fail "origin must be the credential-free BigSimmo/PsychSift URL."
push_urls="$(git remote get-url --push --all origin)" || fail "Could not read origin push URLs."
[[ -n "$push_urls" ]] || fail "origin has no push URL."
while IFS= read -r push_url; do
  [[ "$push_url" = "$expected_origin" ]] || fail "origin push URL must be the credential-free BigSimmo/PsychSift URL."
done <<< "$push_urls"

askpass="$(mktemp)"
trap 'rm -f "$askpass"; unset CODEX_CLOUD_GITHUB_PAT' EXIT
cat > "$askpass" <<'EOF'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' x-access-token ;;
  *Password*) printf '%s\n' "$CODEX_CLOUD_GITHUB_PAT" ;;
  *) exit 1 ;;
esac
EOF
chmod 0700 "$askpass"

GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 \
  git -c credential.helper= -c core.hooksPath=/dev/null push origin --delete "refs/heads/$branch"
printf '[operator:github-pat] PASS: deleted %s.\n' "$branch"
