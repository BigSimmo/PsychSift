#!/usr/bin/env bash
set -euo pipefail
test "$GITHUB_REPOSITORY" = BigSimmo/PsychSift
test "$GITHUB_REF" = refs/heads/diag/pr-preflight-20261019
test "$GITHUB_EVENT_NAME" = push
test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ && ! "$SOURCE_SHA" =~ ^0+$ ]]
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ && ! "$BASE_SHA" =~ ^0+$ ]]
test "$(git rev-parse HEAD^)" = "$SOURCE_SHA"
git merge-base --is-ancestor "$BASE_SHA" "$SOURCE_SHA"
git diff --name-only "$SOURCE_SHA" HEAD > /tmp/diagnostic-paths.txt
test -s /tmp/diagnostic-paths.txt
while IFS= read -r path; do
  case "$path" in
    .github/workflows/pr-preflight-20261019.yml|.github/diagnostics/pr-preflight-20261019/*) ;;
    *) echo "Unexpected diagnostic change: $path" >&2; exit 1 ;;
  esac
done < /tmp/diagnostic-paths.txt
test ! -e .env
test ! -e .env.local
test ! -e .env.production
mkdir -p /tmp/psychsift-pr-proof
git diff --name-only "$BASE_SHA" "$SOURCE_SHA" > /tmp/psychsift-pr-proof/changed-paths.txt
if rg -q '^supabase/' /tmp/psychsift-pr-proof/changed-paths.txt; then
  echo 'Database scope requires a separately reviewed replay/parity plan; refusing this no-DB diagnostic.' >&2
  exit 1
fi
git status --porcelain
printf 'Exact product source: %s\nExact baseline: %s\nDiagnostic commit: %s\n' "$SOURCE_SHA" "$BASE_SHA" "$GITHUB_SHA"
sha256sum Dockerfile Dockerfile.worker package-lock.json worker/python/requirements.txt eval/docling/requirements.txt eval/docling/model-artifacts.json
# Keep diagnostic helpers outside the product checkout so gates and build context prove only SOURCE_SHA.
test ! -e /tmp/psychsift-pr-helpers
cp -R .github/diagnostics/pr-preflight-20261019 /tmp/psychsift-pr-helpers
git checkout --detach "$SOURCE_SHA"
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
test -z "$(git status --porcelain)"
