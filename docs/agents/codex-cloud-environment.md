# Codex Cloud Environment

<!-- BEGIN:codex-cloud-environment -->

## Codex Cloud environment

Codex Cloud uses an isolated Linux container and does not inherit desktop files,
credentials, OAuth sessions, MCP authentication, local services, or uncommitted work.
Use `docs/codex-cloud.md` as the environment contract:

- Whenever agents are requested or otherwise permitted, follow the tracked
  [smart agent allocation policy](smart-agent-allocation.md). It is discovered through
  the root `AGENTS.md`, without desktop files. Verify available hosted model/effort
  controls before dispatch; documentation is not execution proof. A local draft
  must be published to the selected Cloud branch before a fresh task can load it.

- Configure setup as `bash scripts/setup-codex-cloud.sh && bash scripts/install-codex-cloud-command-shims.sh`.
- Configure maintenance as `bash scripts/maintain-codex-cloud.sh && bash scripts/install-codex-cloud-command-shims.sh`.
- For an explicitly owner-authorized GitHub shell environment, use
  `bash scripts/run-codex-cloud-github.sh setup` and
  `bash scripts/run-codex-cloud-github.sh maintenance` instead, with the connected profile.
  The encrypted setup secret is consumed before profile scrubbing; only the standard `gh`
  credential store persists for that authorized capability. See the scoped exception and
  acceptance requirements in `docs/codex-cloud.md` (Setup and maintenance).
- Default to `CODEX_CLOUD_ACCESS_PROFILE=offline` for ordinary and protected RAG work.
  Use `connected` only when the user explicitly authorizes the required provider access.
- When MCP tools are already callable in a Cloud session and the task needs them, use the host
  plugin/connector inventory. The production Supabase target is limited to prompted, read-only
  `docs` and `development` metadata tools; do not enable database, SQL, row, or log tools.
  Write-capable Figma, Railway, and Sentry tools still require explicit confirmation. Paid API
  canaries (`eval:rag`, `eval:retrieval:quality`, `eval:quality`, `verify:release`,
  `test:live`, `check:supabase-project`) still need explicit confirmation. Project
  `.codex/config.toml` keeps Desktop/CLI MCP entries `enabled = false` in git (`check:codex-cloud`
  fails if any tracked entry is enabled). Opt in locally via `$CODEX_HOME/config.toml` (preferred)
  or a never-committed project-file edit, then `codex mcp login railway`. Cloud setup never writes
  Railway or Supabase MCP registrations to `$CODEX_HOME`. Hosted ChatGPT/Codex requires an
  installed, workspace-authorized, OAuth-authenticated app, and a fresh task must prove the callable
  inventory with read-only identity calls. Root `.mcp.json` is a static cross-client template, not
  hosted runtime proof.
- Cloud has no Windows task-start script. Report that exact fact, then perform equivalent
  read-only identity, branch, status, worktree, and Git-operation checks. Proceed only in a
  clean disposable checkout on a task-specific non-protected branch.
- Cloud mirrors the tracked repository toolchain, not Windows files, `.env.local`,
  desktop plugins, browser sessions, OAuth sessions, user-global skills, or uncommitted
  work. Keep required workflows in tracked instructions, scripts, tests, and repo-local
  skills.
- Repository setup cannot grant GitHub installation permissions, workspace RBAC, network
  policy, or provider credentials. Treat those as product/account settings and verify them
  separately without printing secret values.
- In a fresh Cloud task, run `bash scripts/check-codex-cloud-raw-env.sh` before sourcing a
  profile or entering a login shell. It must report only provider variable names and presence,
  never values. The probe establishes presence in the unsanitized parent process, not where a
  variable originated, and repository edits cannot remove a variable from an already-running
  process. When exit `1` / `FAIL`+`STOP` or a failed credential check occurs, application
  execution (`npm run ensure`), live provider access, and full runtime acceptance remain blocked
  and require a fresh task once the environment source is cleared; however, explicitly requested
  local policy, documentation, and configuration inspection and repair are permitted, along with
  scrubbed offline checks (`git diff --check`, `npm run check:codex-cloud`,
  `npm run check:instructions`, `npm run check:decisions`, and offline unit tests run after
  sourcing `~/.clinical-kb-codex-cloud.sh` or through `~/.local/bin/{node,npm,npx}` command shims,
  which `unset` `GH_TOKEN`, `OPENAI_BASE_URL`, and all other provider variables before Node
  executes). Exit `2` / `FAIL-KNOWN` for the documented launcher-injected names (`OPENAI_BASE_URL`
  and `GH_TOKEN`) uses the restricted profile-and-shim continue path for provider-free work; do
  not generalize that allowance to other provider credentials. Exit `2` is still a failed raw
  boundary — future automation must not treat non-1 as success or as a blind retry. Because
  `OPENAI_BASE_URL` can redirect OpenAI-bound traffic and `GH_TOKEN` carries host GitHub
  credentials, never invoke OpenAI or GitHub clients from the raw parent or any binary that
  bypasses the profile/`node`/`npm`/`npx` scrub. In non-login shells (`bash -c`), source
  `~/.clinical-kb-codex-cloud.sh` before running `npm run check:codex-cloud` so the scrubbed
  profile is active; it must report the static-and-environment PASS line. Run
  `npm run check:codex-cloud -- --runtime` with `CODEX_CLOUD_EXPECTED_BASE_SHA` set to the
  intended merge/base commit when the checkout has only a task HEAD. Setup and maintenance may
  report freshness as unverified so provisioning remains repairable, but explicit acceptance must
  not pass an arbitrary HEAD. The command shims load the generated profile for normal `node`,
  `npm`, and `npx` work. Also run `npm run check:runtime` and
  `npm run check:installed-lock-parity` before trusting a new or reset environment. A skipped
  browser install is not full browser readiness. Output is limited to approved mode values,
  presence booleans, full Git commit identities, and MCP server/command/environment-variable
  names; never print credential values.
- Do not add OpenAI, Supabase, Railway, GitHub, database, or user credentials as ordinary
  Cloud environment variables. Codex Cloud secrets are setup-only and unavailable to the
  agent phase unless the platform explicitly exposes a secret to the named task phase; do not
  copy them into files to bypass that boundary.
- Provider-backed checks, hosted CI mutations, deployment, production data access, and
  Git publishing still require the explicit authorization defined above.
- The ordinary offline Cloud profile intentionally cannot perform authenticated production or
  live-provider checks. `check:production-readiness` reports this as a provider capability gap.
- Authenticated live tests run through the manual
  `.github/workflows/authenticated-live-tests.yml` GitHub Actions workflow, its explicit
  dispatch confirmation, and the `Database / production` environment, never by exposing
  credentials to the Codex Cloud agent shell.
- The active hosted workspace is **Personal Pro**. Use Railway's installed official ChatGPT app
  with browser OAuth and **Allow read actions**; Personal Pro does not provide the dedicated-group
  RBAC or per-tool action disabling assumed by Enterprise/Edu instructions. Prove Railway with the
  callable tool inventory and a read-only identity/project-list call. Repository setup and local
  MCP config cannot activate it, and the Codex Cloud connector page currently offers no Railway
  connector. Use the documented split control plane: Codex Cloud for code and its native GitHub
  connector, ChatGPT web for Railway and project-scoped read-only Supabase. Every provider change
  still requires explicit approval. Enterprise/Edu custom-app controls are a future governance
  option, not the current workspace classification.
  CLI token auth is a separate operator capability: it requires a separately installed Railway CLI
  and a dedicated
  `RAILWAY_API_TOKEN`, and must never substitute `RAILWAY_TOKEN` or expose either token to an
  ordinary agent shell. GitHub connector access, GitHub CLI authentication, the credential-free
  `origin` URL, and shell Git authentication are separate capabilities.
- For an explicitly authorised GitHub task, use the authenticated GitHub connector/MCP
  tools as the default remote control plane. Use them for repository, PR, issue, review
  thread, and Actions work, including inline-thread replies/resolution, Actions
  run/job/log/artifact inspection, and approved branch, file, or PR mutations. Missing
  `gh`, shell GitHub credentials, or direct shell network access is not a loss of this
  capability. The intended connection is `BigSimmo` with repository write access.
  Reserve administrator access for separately approved operations.
- In Codex Cloud, use native Push, the authenticated GitHub connector, or GitHub's UI for branch
  publication and cleanup. `CODEX_CLOUD_GITHUB_PAT` is excluded from every Cloud agent shell.
  The helper `bash scripts/delete-codex-cloud-branch-with-pat.sh <non-protected-branch>` is
  operator-only outside Codex Cloud; it must reject `CODEX_CLOUD=1`, validate the exact
  non-protected ref and credential-free origin, and never print the token. If the native or
  connector path is unavailable, report the platform limit rather than copying a PAT into a
  profile, remote URL, cached file, or agent environment.
- Confirm the exact repository and PR/thread/job before a write, and verify the connector
  result before treating the write as successful. A repository cannot sanitize a variable
  already inherited by the top-level task process; the tracked shims protect normal
  `node`/`npm`/`npx` commands. Report raw-parent exposure as a Codex Cloud environment or launcher
  finding rather than weakening the provider-variable contract, while still completing any
  explicitly requested local policy/doc inspection and scrubbed offline checks.
- Cloud browser proof is Playwright/Chromium, Firefox, or WebKit container evidence, not
  physical iPhone Safari/PWA acceptance.

### Summary rules formerly carried inline in `AGENTS.md`

These are the Codex Cloud bullets `AGENTS.md` carried inline until they were consolidated here.
They are reproduced verbatim; where they restate a rule above, both wordings stand.

Codex Cloud uses an isolated Linux container and does not inherit desktop credentials, local services, or uncommitted work. Full environment specification and runbooks live in `docs/codex-cloud.md`.

- Default to `CODEX_CLOUD_ACCESS_PROFILE=offline` for ordinary/RAG work; use `connected` only with explicit provider authorization.
- Personal Pro split control plane: Codex Cloud for code and GitHub connector; ChatGPT web for Railway and read-only Supabase metadata.
- Acceptance: run `bash scripts/check-codex-cloud-raw-env.sh`, `npm run check:codex-cloud`, and `npm run check:codex-cloud -- --runtime` (with `CODEX_CLOUD_EXPECTED_BASE_SHA`). A failed raw-parent credential check blocks app execution and provider access, not explicitly requested local policy repair or scrubbed offline checks.
- Do not expose provider secrets (OpenAI, Supabase, Railway, GitHub PATs) in Cloud agent shells or committed config.
- Authenticated live tests run via `.github/workflows/authenticated-live-tests.yml` with manual dispatch, never from Cloud agent shells.
- Branch deletion helper `bash scripts/delete-codex-cloud-branch-with-pat.sh` is operator-only outside Cloud.

<!-- END:codex-cloud-environment -->
