#!/usr/bin/env bash

set -Eeuo pipefail

# Run this directly with a pristine shell before sourcing profiles or invoking
# node/npm shims. It reports names and presence only, never values, and
# establishes presence in the raw parent process rather than variable origin.
#
# Exit codes:
#   0 — no provider variables inherited (raw boundary passed)
#   1 — unexpected provider variable names present; app execution and provider
#       access require a fresh task, while explicitly requested local policy/doc
#       repair and scrubbed offline checks may proceed
#   2 — only the documented Personal Pro launcher defect names (`OPENAI_BASE_URL`,
#       `GH_TOKEN`) are present. The raw boundary still failed; continue only
#       through the generated profile and command shims, never by treating this
#       as a pass.
provider_variables=(
  OPENAI_API_KEY OPENAI_ORG_ID OPENAI_PROJECT_ID OPENAI_BASE_URL
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY
  SUPABASE_SERVICE_ROLE_KEY SUPABASE_ACCESS_TOKEN SUPABASE_DB_URL
  SUPABASE_PROJECT_REF SUPABASE_PROJECT_NAME SUPABASE_STAGING_PROJECT_REF SUPABASE_STAGING_PROJECT_NAME
  DATABASE_URL POSTGRES_PASSWORD CROSS_TENANT_SERVICE_ROLE_KEY
  RAILWAY_API_TOKEN RAILWAY_TOKEN
  GH_TOKEN GITHUB_TOKEN CODEX_CLOUD_GITHUB_PAT GITLAB_TOKEN GLAB_TOKEN CODEX_TRIGGER_TOKEN
  HEALTH_DEEP_PROBE_SECRET INDEXING_V3_AGENT_SECRET
  FIGMA_CLIENT_ID FIGMA_CLIENT_SECRET FIGMA_ACCESS_TOKEN FIGMA_PERSONAL_ACCESS_TOKEN
  FIGMA_TOKEN FIGMA_NPM_TOKEN
  SENTRY_AUTH_TOKEN SENTRY_DSN NEXT_PUBLIC_SENTRY_DSN
  E2E_AUTH_ENABLED E2E_USER_EMAIL E2E_USER_PASSWORD ALLOW_PROVIDER_TESTS
)

# Name-scoped allowance: only these inherited names may use the restricted continue
# path. Any other provider name remains a hard stop.
known_launcher_defect_variables=(OPENAI_BASE_URL GH_TOKEN)

present=()
for name in "${provider_variables[@]}"; do
  if [[ -n "${!name:-}" ]]; then
    present+=("$name")
  fi
done

if (( ${#present[@]} == 0 )); then
  printf '[Codex Cloud Raw Env] PASS: no provider variables are inherited by the raw task shell.\n'
  exit 0
fi

known=()
unexpected=()
for name in "${present[@]}"; do
  is_known=0
  for known_name in "${known_launcher_defect_variables[@]}"; do
    if [[ "$name" == "$known_name" ]]; then
      is_known=1
      break
    fi
  done
  if (( is_known )); then
    known+=("$name")
  else
    unexpected+=("$name")
  fi
done

if (( ${#unexpected[@]} > 0 )); then
  printf '[Codex Cloud Raw Env] FAIL: inherited provider variable names: %s\n' "${present[*]}" >&2
  printf '[Codex Cloud Raw Env] STOP: unexpected credential-bearing names require a fresh task before app execution or provider access; explicitly requested local policy/doc repair and scrubbed offline checks may proceed.\n' >&2
  exit 1
fi

printf '[Codex Cloud Raw Env] FAIL-KNOWN: inherited documented launcher defect names: %s\n' "${known[*]}" >&2
printf '[Codex Cloud Raw Env] CONTINUE-RESTRICTED: use only the generated profile and command shims; raw boundary remains failed.\n' >&2
for name in "${known[@]}"; do
  case "$name" in
    OPENAI_BASE_URL)
      printf '[Codex Cloud Raw Env] CONTINUE-RESTRICTED: OPENAI_BASE_URL can redirect OpenAI-bound traffic; never invoke OpenAI clients from the raw parent or any binary that bypasses the profile/shim scrub.\n' >&2
      ;;
    GH_TOKEN)
      printf '[Codex Cloud Raw Env] CONTINUE-RESTRICTED: GH_TOKEN carries host GitHub credentials; never invoke gh, git credential helpers, or network clients from the raw parent or any binary that bypasses the profile/shim scrub.\n' >&2
      ;;
  esac
done
exit 2
