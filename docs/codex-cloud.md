# Codex Cloud environment

_Updated 2026-10-08 — corrected documentation guidance; operational evidence retains its original dates._

> This Bash setup is for Linux-based Codex Cloud environments. Codex Desktop on
> Windows uses `npm run setup:codex-worktree`; pointing Desktop at this Cloud
> script starts WSL outside the Windows worktree and cannot provision it.

This repository supports reproducible Codex Cloud work with Node 24, npm 11, locked
development dependencies, Deno 2, Python/OCR tooling, and the Chromium, Firefox, and
WebKit Playwright browser matrix. The repository setup can prepare and validate the
container. It cannot grant GitHub installation permissions, workspace RBAC, agent-network
policy, or provider-account permissions; those are configured in Codex and each provider.

For agent work, the root `AGENTS.md` points to the portable
[smart agent allocation policy](agents/smart-agent-allocation.md). Apply it whenever
agents are used, using only the model, effort and concurrency controls exposed in
the current Cloud task. Publication to the selected branch and a fresh-task check
are required before claiming Cloud adoption; local instructions alone do not
establish it. This policy neither changes the main-chat model nor grants provider
access. Its Cloud delivery section defines fallback and evidence requirements.

## Issues this setup resolves

- Codex Cloud had no tracked setup or maintenance command on `main`.
- Two incompatible Cloud checkers existed only in dirty worktrees.
- The prompt-perfector bootstrap parsed the Windows task-start output incorrectly and
  rejected Cloud's legitimate single primary checkout.
- Tool repair covered Node dependencies but not Deno, OCR, Python, or browsers.
- Provider-variable clearing was incomplete and the Cursor Cloud guidance was easy to
  mistake for Codex Cloud guidance.
- GitHub connector access, shell Git credentials, network access, and provider credentials
  were treated as one permission even though they are separate controls.
- The Codex Cloud CLI can emit a root `error.log` containing account/session metadata; the
  repository now ignores that exact diagnostic path.

## Create the environment

In Codex environment settings, create an environment for `BigSimmo/PsychSift` using the
official [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment)
contract:

| Setting               | Value                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Repository            | `BigSimmo/PsychSift`                                                                        |
| Base image            | Default universal image                                                                     |
| Node version          | `24`                                                                                        |
| Python version        | `3.12`                                                                                      |
| Setup command         | `bash scripts/setup-codex-cloud.sh && bash scripts/install-codex-cloud-command-shims.sh`    |
| Maintenance command   | `bash scripts/maintain-codex-cloud.sh && bash scripts/install-codex-cloud-command-shims.sh` |
| Environment variables | Use the complete profile below                                                              |

Keep agent internet access off for this repository's ordinary Cloud environments. Package
installation happens during setup; ordinary structure-only work, including the RAG
decomposition prompt below, remains offline. The appended command-shim installer is required:
it makes every normal `node`, `npm`, and `npx` invocation load the generated sanitized
profile before starting Node. It is idempotent and builds the executable path from `nvm version`
instead of resolving through `PATH`, so maintenance cannot accidentally wrap an earlier wrapper.

The setup command fails if the required Cloud toolchain cannot be installed. It intentionally does
not install Railway CLI: hosted Railway access comes from the authenticated workspace app, and the
CLI postinstall downloads a separate binary that may be blocked in the Cloud setup network. It pins
Codex CLI `0.147.0`, reviewed on 2026-08-22. OpenAI's
[official Codex CLI guide](https://learn.chatgpt.com/docs/codex/cli) supports Linux installation;
the npm package is used here so maintenance can verify an exact version without running an
unversioned installer. Set
`CODEX_CLOUD_SKIP_BROWSER_INSTALL=1` only for an explicitly source-only environment; that
environment is not full browser-ready.

### Cloud compared with local development

Cloud parity covers repository-owned tooling, not every capability of a developer workstation or
CI runner:

| Boundary                        | What the repository provides                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository-owned setup          | Pinned Node/npm, a lockfile-only dev install, Git hooks, Deno, the hashed Python/OCR environment, browser installation, and static/runtime checks. `--prefer-offline` reuses cached npm data when available but may still fetch missing packages; it is not offline mode. `--no-audit` and `--no-fund` keep provisioning deterministic and quiet, while dependency auditing remains a separately scoped CI gate. |
| Host/platform capability        | GitHub installation permissions, callable connector tools, network policy, Docker or privileged operations, capacity, caches, and persistence are supplied by the selected host. Repository setup cannot grant or guarantee them; verify the needed capability in the current task.                                                                                                                              |
| Intentional security boundary   | Cloud setup does not copy `.env*` files, credentials, OAuth sessions, provider URLs, mutable provider configuration, browser state, or local MCP authentication. Keep those differences from Desktop/operator workflows.                                                                                                                                                                                         |
| Optional or external acceptance | `CODEX_CLOUD_SKIP_BROWSER_INSTALL=1` creates a source-only environment. Provider-backed, production-like, physical-device, and physical Safari/PWA checks remain separate and require the authorization and environment described below.                                                                                                                                                                         |

See [Access profiles](#access-profiles), [GitHub access](#github-access),
[Playwright browser readiness](#playwright-browser-readiness-255), and [Acceptance](#acceptance)
for the authoritative task-level checks. Never repair a host capability gap by copying credentials,
tokens, provider URLs, OAuth state, `.env*` files, or mutable provider configuration into the Cloud
agent shell.

### Playwright browser readiness (#255)

Browser gates need the **locked** Playwright package and a Chromium revision that matches
`node_modules/playwright-core/browsers.json`. When a remote/Cloud image forces
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and that
tree only ships an older revision (for example 1194 while the lock expects 1234):

1. Run `npm run check:installed-lock-parity` and `npm run check:playwright-browser-revision`.
2. Do **not** point `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` at the mismatched shell.
3. Delegate browser proof to CI Production UI, or refresh the environment image / install matching
   browsers into a managed cache, or unset the container browser env vars so
   `npx playwright install` can populate the managed path.

`CODEX_CLOUD_SKIP_BROWSER_INSTALL=1` remains source-only: that environment is not browser-ready.

## Access profiles

### Offline (default)

Use this for refactors, static checks, mocked tests, and all work that expressly forbids
providers:

```text
CODEX_CLOUD=1
CODEX_CLOUD_ACCESS_PROFILE=offline
RAG_PROVIDER_MODE=offline
NEXT_PUBLIC_DEMO_MODE=true
PLAYWRIGHT_OFFLINE_MODE=true
```

The generated shell profile removes known OpenAI, Supabase, Railway, GitHub/GitLab,
database, CI-trigger, test-user, and emergency-PAT variables. This prevents an unrelated
Cloud task from silently becoming provider-backed.

Set all five offline values in the environment UI. The setup also writes the generated
profile to `.bashrc`, `.profile`, and `.bash_profile`. Covering `.bash_profile` is required:
Bash stops login-profile discovery at the first matching file, so an existing `.bash_profile`
can otherwise prevent `.profile` from running. Offline mode values are forced after inherited
platform values so stale `auto`/`false` settings cannot outrank the repository contract.
Do not manually source the profile as an acceptance workaround: start a fresh task and invoke
the direct `npm run check:codex-cloud` commands below. The tracked command shims make those
ordinary Node commands load the profile themselves.

### Connected (explicit opt-in)

Use `CODEX_CLOUD_ACCESS_PROFILE=connected` only in a separate environment whose tasks are
expected to call named providers. Configure the smallest domain/method allowlist and the
least-privileged credentials for those tasks. Never commit credentials or print their
values. The setup script does not call providers and does not prove provider authorization.

Create or select a separate environment named `PsychSift - connected` for `BigSimmo/PsychSift`,
then set only these ordinary environment variables in
[Codex environment settings](https://chatgpt.com/codex/settings/environments):

```text
CODEX_CLOUD=1
CODEX_CLOUD_ACCESS_PROFILE=connected
RAG_PROVIDER_MODE=offline
NEXT_PUBLIC_DEMO_MODE=true
PLAYWRIGHT_OFFLINE_MODE=true
```

Keep OpenAI disabled unless a later task explicitly authorizes it. Do not add provider keys,
tokens, database URLs, service-role values, E2E credentials, or `ALLOW_PROVIDER_TESTS` to this
environment. The generated agent profile removes the complete provider-variable inventory in
both access profiles. Connected access records authorization intent and keeps the GitHub boundary
explicit, but it does not register hosted MCP apps, expose raw credentials to the shell, or guarantee
that every GitHub capability appears as a direct agent tool. For ordinary Cloud task publishing,
use the native Cloud diff/PR controls and verify the resulting GitHub branch and PR link. A
metadata-only `make_pr` response is not publication evidence. If a requested GitHub API is not
available, report that limitation rather than using shell credentials as a workaround.

Codex Cloud secrets and ordinary environment variables have different exposure and lifecycle
properties. This repository has no mechanism that promotes setup-only OpenAI, Supabase, E2E,
or Railway secrets into the agent phase. Do not persist them in profiles, repository files,
`.env*`, caches, logs, or ordinary variables as a workaround. A `connected` profile models
explicit authorization and relaxes the offline-mode assertions, but it does not create
credentials. Authenticated Supabase/E2E tests use the protected manual workflow documented
below. Run other provider checks locally/operator-side or through a separately approved,
least-privilege provider mechanism.

## GitHub access

The GitHub connector is the supported repository/PR path. Follow the official
[Codex GitHub setup](https://help.openai.com/en/articles/11390924), authorize the
`BigSimmo/PsychSift` repository, and ensure the installation grants the user write access if
Cloud tasks must publish PRs. Repository discovery proves read access only.

For an explicitly authorised GitHub task, use Cloud's authenticated GitHub integration
as the remote control plane. For ordinary Cloud work, publish through the native task
diff/PR controls and verify the returned GitHub branch and pull-request link. Do not infer
that GitHub is unavailable merely because `gh`, shell Git credentials, or a particular
direct agent tool are absent. The intended GitHub identity is `BigSimmo`. Use repository
write access for branch and pull-request publication; reserve administrator access for separately
approved operations. Some GitHub APIs, including review-thread or Actions management, may not be
exposed in every Cloud task. When the user explicitly authorises the shell fallback, configure it
only through an encrypted, setup-only `CODEX_CLOUD_GITHUB_PAT` environment secret and require the
live acceptance command below to pass before the task starts. Never place its value in a prompt,
repository file, ordinary environment variable, command argument, remote URL, log, or
documentation.

GitHub connector permission is separate from credentials inside the agent shell. The connector,
native Push control, and GitHub UI remain the preferred Cloud publication and cleanup paths. The
explicit shell fallback necessarily leaves an authenticated `gh` credential helper available to
the agent, so it has a wider trust boundary than the connector. The setup secret itself
is still excluded from the agent environment and the generated shell profile. The live gate never
reads or prints the credential: it verifies the exact `BigSimmo` identity, `BigSimmo/PsychSift`
write permission, `repo`, `workflow`, `read:org`, and `gist` scopes, PR metadata/diff/check/comment/Actions
reads, review-thread reply and resolution schema, repository review-thread reads and resolve permission,
successful Actions job metadata, log access
through a body-free HTTP `HEAD` against a non-skipped job, the rerun command surface, the
credential-free origin, authenticated fetch,
and an ordinary feature-branch push through `--dry-run`. The probe alone disables local hooks so
the real-push verification suite cannot make setup hang; actual pushes retain those guards. It
uses an unguessable task-local probe name, checks that exact ref before and afterward, and fails if
any remote ref appears.
Each provider subprocess has a 30-second bound. Provider failures classified as transient (rate
limiting, GitHub 5xx, DNS/TLS, timeout, or connection reset) receive at most three attempts with
short exponential backoff. Authentication, permission,
schema, unsafe-origin, and branch-policy failures fail immediately rather than being hidden by retries.

`bash scripts/delete-codex-cloud-branch-with-pat.sh <non-protected-branch>` is retained only for
an explicitly authorised operator running outside Codex Cloud. It rejects `CODEX_CLOUD=1`,
protected/invalid refs, and any origin other than the credential-free
`https://github.com/BigSimmo/PsychSift.git`. Never copy a PAT into a Cloud task, profile, checkout,
remote URL, cache, or log.

Setup restores a missing `origin` to the credential-free URL
`https://github.com/BigSimmo/PsychSift.git`; it preserves an existing correct remote and fails
instead of overwriting a wrong or credential-bearing remote. When GitHub CLI authentication is
already available, setup asks `gh auth setup-git` to install its token-free helper command. It
never embeds a token or invents a PAT. It also fetches `origin/main`, stores the current task's merge
base outside the checkout, and exports
that exact 40-character SHA as `CODEX_CLOUD_EXPECTED_BASE_SHA` in subsequent agent shells. `git
ls-remote` and a dry-run push remain separate acceptance checks; if the connector does not expose
shell Git authentication, report that platform capability gap.

Suggested GitHub acceptance task:

```text
Read AGENTS.md and docs/codex-cloud.md. Create a task-specific branch, add one harmless
documentation-only line, commit it, and record its branch name and full 40-character HEAD SHA.
Use the Codex GitHub workflow to publish that exact existing branch and create a draft pull
request. Do not recreate, rename, amend, rebase, or rebuild the branch or commit. Do not merge.
Report whether repository clone, branch publication, and draft PR creation each succeeded, then
report the expected and published branch names and full HEAD SHAs and whether they match exactly.
If branch publication or draft PR creation succeeds, include its link. For each failed write,
report the failure and state that no link is available. Remove the draft branch/PR only after I
approve cleanup.
```

## Setup and maintenance

For the native connector/operator path, configure the following complete commands in the
environment UI:

```bash
bash scripts/setup-codex-cloud.sh && bash scripts/install-codex-cloud-command-shims.sh
```

```bash
bash scripts/maintain-codex-cloud.sh && bash scripts/install-codex-cloud-command-shims.sh
```

For the explicitly authorised GitHub shell fallback, store the credential only as the encrypted
setup secret named `CODEX_CLOUD_GITHUB_PAT`, select `CODEX_CLOUD_ACCESS_PROFILE=connected`, and use
the tracked lifecycle wrapper below. Never substitute a literal credential. The token must carry
`repo`, `workflow`, `read:org`, and `gist`: `gh auth login --with-token` requires the latter two in
addition to the repository scope, while failed-job reruns require `workflow`.

```bash
bash scripts/run-codex-cloud-github.sh setup
```

```bash
bash scripts/run-codex-cloud-github.sh maintenance
```

The repaired hosted environments use these commands when the checked-out branch contains the
wrapper, retaining the prior working inline commands for older branches. After this change is
merged, new `main` tasks adopt the tracked implementation automatically; opening a PR alone does
not change the scripts present on `main`.

The final command is a fail-closed task admission gate, not an optional diagnostic. A cache hit,
accepted OAuth token, repository listing, or connected-environment label is insufficient by itself.
The wrapper validates authentication, identity and scopes before installing dependencies, suppresses
login output and shell tracing, and removes the setup-secret variable before invoking repository
setup. It deliberately uses `gh`'s standard credential store for this owner-authorized shell
capability; the credential must never be copied into repository files, shell profiles, remote URLs,
ordinary environment variables, or prompts. This is an explicit exception for GitHub shell
authentication, not authorization to persist OpenAI, Supabase, Railway or other provider secrets.
Maintenance reuses valid stored authentication when setup-only secrets are absent, and fails closed
if it is missing, expired, or insufficient. The full final gate still verifies PR/Actions reads and
the Git transport dry run after toolchain repair. An authentication-only PASS is not that verdict.
If a damaged cache lacks Node, the wrapper first restores the configured major using the existing
`nvm` installation so the authentication preflight does not block normal lifecycle recovery.

After changing configuration or credentials, obtain fresh-task proof. Reset the environment cache
only if a new task still uses stale setup. Resume older tasks and verify them individually; a running
agent does not acquire changes automatically. Cloud may reconstruct a local commit under a different
SHA when resuming: verify the current diff, actual HEAD, destination branch, and remote PR before
publishing instead of trusting a SHA from an earlier answer.

Credentials can expire or be revoked; no setup script can prevent that. Replace the encrypted secret,
then rerun the same live gate. Keep clinical providers offline and use an appropriate network
allowlist. See [the Cloud reliability audit](audit/codex-cloud-reliability-20260907.md) for the
verified environments and remaining capability boundaries.

The maintenance command reasserts the safe `origin`, runs static/effective environment
acceptance, then runtime acceptance. The shim installer runs after either lifecycle command and
repairs the normal Node command boundary. Any runtime, dependency, CLI, Deno, Python/OCR, or
browser drift reruns the full setup instead of repairing only `node_modules`. All profile
insertions, command shims, CLI installs, and remote repair are idempotent.

### Automatic setup diagnostics

Cloud setup tracks its current phase. If a command fails, the error trap runs
`npm run diagnose:codex-cloud` automatically and prints sanitized `ISSUE` and `FIX` lines after
the original error. The diagnostic checks the Node/npm contract, the active Cloud Python runtime,
the runtime-specific Python lock header, and the failed setup phase without printing environment
values or calling a provider. Run it manually in an agent shell when setup completed but the
runtime later appears stale:

```bash
npm run diagnose:codex-cloud
```

The command is Cloud-only: outside a `CODEX_CLOUD=1` shell it reports `NOT_APPLICABLE` rather than
mistaking a desktop Python installation for Cloud runtime drift.

The production worker image and Codex Cloud deliberately use separate hashed Python locks because
medspaCy 1.3.1 requires spaCy `<3.8` on Python 3.11 but `>=3.8` on Python 3.12. Production uses
`worker/python/requirements.txt` (Python 3.11); Cloud uses
`worker/python/requirements-cloud.txt` (Python 3.12). After changing
`worker/python/requirements.in`, regenerate and verify both locks with their matching interpreters.

## Acceptance

Run this in a fresh Cloud task before relying on the environment:

```text
Read all applicable AGENTS.md files and docs/codex-cloud.md. State whether this is the
offline or connected profile. Report tool versions without printing environment values.
Run npm run check:codex-cloud, npm run check:runtime,
npm run check:installed-lock-parity, and npm run check:codex-cloud -- --runtime. Confirm that
setup exported CODEX_CLOUD_EXPECTED_BASE_SHA as a verified 40-character ancestor. Do not call a
provider unless this task explicitly names and authorizes that provider. Report the decisive
line from every command and any unrun check.
```

Expected decisive lines include:

```text
[Codex Cloud Check] PASS: static and environment Cloud contracts match.
[Codex Cloud Check] PASS: static, environment, and runtime Cloud contracts match.
```

The effective-environment check runs automatically when `CODEX_CLOUD=1`, including without
`--runtime`, so a newly started agent shell cannot pass with stale modes. Its report prints only
approved mode values and presence booleans. The runtime check additionally verifies Node/npm
policy and installed-lock parity, the pinned Codex CLI, Deno 2, Python 3 and worker imports,
Tesseract, actual headless launch-and-close for Chromium/Firefox/WebKit, the Python requirements
fingerprint plus `pip check` and medspaCy/spaCy versions, the expected base commit as an ancestor
of HEAD, the `BigSimmo/PsychSift` origin identity, offline credential absence when applicable,
and obsolete npm proxy variable names without reading or printing their values. It reports
the full current HEAD, local main and origin/main when present, expected base, ancestry result,
and a separate freshness state. Setup and maintenance use the process-local
`CODEX_CLOUD_PROVISIONING=1` flag so an unavoidable task-only checkout reports
`freshness=unverified` without entering a repair loop. The explicit acceptance command does
not set that flag and fails unless the setup-generated `CODEX_CLOUD_EXPECTED_BASE_SHA` proves the
intended base.
MCP inspection emits server names, commands, and environment variable names only.

A repository cannot remove a variable already inherited by the top-level task process. Before
sourcing any profile or invoking node/npm in a fresh task, run:

```bash
bash --noprofile --norc scripts/check-codex-cloud-raw-env.sh
```

The probe checks the complete provider-variable inventory and prints names only. Outcomes are
name-scoped in the probe itself:

- exit `0` / `PASS` — raw boundary clean
- exit `1` / `FAIL` + `STOP` — any unexpected provider name (for example
  `SUPABASE_SERVICE_ROLE_KEY`); start another fresh task and do not continue
- exit `2` / `FAIL-KNOWN` + `CONTINUE-RESTRICTED` — only the documented Personal Pro launcher
  defect name `OPENAI_BASE_URL`

Exit `2` is still a failed raw boundary: humans/agents may continue only under this contract.
Do not treat “non-1” or “retry on any failure” as success in future automation — wire the three
states explicitly. When the probe reports `FAIL-KNOWN` for `OPENAI_BASE_URL` alone, preserve that
name-only output for OpenAI support and continue provider-free work only through the generated
profile and command shims, followed by a passing `npm run check:codex-cloud`. Do not generalize
that restricted path to any other inherited name. An inherited `OPENAI_BASE_URL` can redirect
OpenAI-bound traffic, so never call OpenAI clients from the raw parent process or from binaries
that bypass the profile/`node`/`npm`/`npx` shim scrub. A sanitized child shell is never proof
that the raw-parent boundary passed.

`npm run check:production-readiness` remains useful in the offline profile for local safeguards.
Missing Supabase/OpenAI agent-phase credentials are reported as a provider capability gap and do
not make the provider-free cache unhealthy. `ALLOW_PROVIDER_TESTS=true` expresses authorization,
not credential availability; live tests still fail closed with a sanitized capability-gap message
in the offline profile.

## Provider acceptance

Provider access is verified separately because a generic bootstrap must not make paid or
production-like calls. The active hosted workspace is **Personal Pro**. It does not have the
dedicated-group RBAC or per-tool action disabling assumed by Enterprise/Edu instructions. Use
Railway's installed official ChatGPT app, complete browser OAuth without static tokens or headers,
set the global app policy to **Allow read actions**, and leave changes approval-gated. Authorize
only workspace `bigsimmo's Projects` and project `PsychSift`
(`5deaad0b-675a-4c13-978e-5ca2b5b877f9`) where Railway offers that choice. Reduce read results to
non-secret account, project, workspace, environment, and service metadata. Railway's remote MCP
does not accept project tokens; install Railway CLI separately only for explicitly approved
local/operator workflows (for example `npm run check:env-parity -- --railway`). That CLI path is
not available in ordinary Cloud tasks and is not part of Cloud runtime acceptance. Prefer
`RAILWAY_API_TOKEN` for personal CLI auth; never substitute the project-scoped CI
`RAILWAY_TOKEN`. Enterprise/Edu custom-app controls are an optional future governance upgrade,
not the current operating target.

The Supabase MCP entry is scoped to production project `sjrfecxgysukkwxsowpy`, forces
`read_only=true`, and exposes only documentation/development metadata tools. The database and
debugging groups are excluded so ordinary Cloud cannot execute SQL, read clinical rows, or inspect
production logs. Complete its browser OAuth flow for the organization containing `PsychSift Production`
and restart the client if tools do not appear. Schema writes, Edge Function deployment, branching,
and storage mutations require a separately configured non-production project or branch; do not
broaden the production entry. OpenAI generation, Supabase live data, Railway changes, hosted CI
reruns, ingestion, deployment, and release workflows remain separate explicit actions.

Project `.codex/config.toml` is the checked-in Codex Desktop/CLI MCP template. Its URL-only entries
must stay `enabled = false` in git — `npm run check:codex-cloud` hard-fails on any tracked
`enabled = true`. A trusted local operator opts in outside the committed tree: prefer enabling
`railway` in `$CODEX_HOME/config.toml`, or make a never-committed local edit to the project file for
the session, then run `codex mcp login railway`. Setup does not copy any MCP server into
`$CODEX_HOME`. Hosted ChatGPT and Codex Cloud require the separately installed/authenticated
workspace app. Start a fresh task after consent and verify the actual callable inventory.
The root `.mcp.json` is a cross-client Desktop/CLI template and static allowlist only. It does not
prove hosted Cloud availability. The checked-in Context7 integration is
Cursor local stdio, separate from this Codex Cloud Railway + Supabase allowlist.
A separately selected hosted Context7 connector has its own authentication and
availability. See the [Context7 guide](agents/context7.md) for version matching,
sanitised queries and the authorised CLI fallback; repository configuration does
not prove hosted access.

### Personal Pro split control plane

Personal Pro currently exposes GitHub, Slack, and Linear on the Codex connector settings page; it
does not expose Railway or Supabase there. Use the smallest functional split instead of copying
credentials into Cloud:

- **Codex Cloud:** repository work, offline checks, and GitHub reads/publication through the native
  GitHub connector or Cloud PR controls.
- **ChatGPT web:** Railway through the official OAuth app and Supabase through the pinned
  project-scoped read-only app. Keep Railway on **Allow read actions** and ask before every change.
- **Desktop/CLI:** opt-in local MCP via `$CODEX_HOME/config.toml` (preferred) or a
  never-committed local enable of the project `.codex/config.toml` `railway` entry, followed by
  `codex mcp login railway`; this is a local operator fallback, never hosted proof.

The repository checker prints these routes as sanitized `provider_route.*` lines. They describe
where a capability is allowed, not proof that a host installed or authenticated it. A fresh task
must still establish the callable inventory.

Production Supabase stays project-scoped and `read_only=true`, with
`default_tools_approval_mode = "prompt"` so every production metadata/read call requires
confirmation. Do not use unrestricted SQL or query clinical rows. Railway, Figma, and Sentry
write-capable tools remain approval-gated. OAuth credentials stay in the host store—never the
tracked files or agent environment.

For Figma, that means using the official app/plugin OAuth path for a named design task, not adding
Figma client IDs, client secrets, REST tokens, or npm registry tokens to Cloud environment
variables. Product truth remains `docs/design-system/` and the app code; design writes still need
explicit task approval.

In a fresh connected task, first run the raw-shell probe and repository acceptance, then inspect
the actual callable tool inventory. A configured URL or `enabled = false` template is not runtime
proof. Verify Railway and Supabase with read-only identity/project metadata calls and report only
non-secret status; if either tool is absent, the host integration is not activated.

### Connected-environment remediation checklist

Use this checklist when a Cloud task reports a connected profile but cannot call providers, publish
its branch, or make the local health endpoint ready. Repository setup can prepare the boundary, but
the host must grant OAuth and repository access in a fresh task; do not try to repair those gaps by
copying credentials into the checkout.

1. **Create the durable host environment.** In Codex environment settings, create or select
   `PsychSift - connected` for `BigSimmo/PsychSift`. Set exactly the five non-secret values from the
   connected profile above. Configure setup as
   `bash scripts/setup-codex-cloud.sh && bash scripts/install-codex-cloud-command-shims.sh` and
   maintenance as
   `bash scripts/maintain-codex-cloud.sh && bash scripts/install-codex-cloud-command-shims.sh`.
   Do not add provider keys, database URLs, service-role credentials, test-user credentials, or
   `ALLOW_PROVIDER_TESTS`. Connected setup writes only the managed shell-environment policy; it
   never registers hosted MCP apps or writes OAuth tokens.
2. **Grant the host integrations.** In the Personal Pro workspace, install Railway's official
   ChatGPT app, complete Railway OAuth, select **Allow read actions**, and keep all changes subject
   to explicit approval. If a stale custom app or connector named `railway_cloud` shows an
   authentication-expired reconnect banner, remove or reconnect that host-local app in the MCP/App
   settings before starting a new task; repository setup cannot refresh hosted OAuth tokens.
   Personal Pro has no dedicated-group RBAC or per-tool disabling, so do not claim those controls.
   Authorize the Codex GitHub connector for
   `BigSimmo/PsychSift` with repository write access. Complete Railway OAuth only for workspace
   `bigsimmo's Projects` and project `PsychSift` (`5deaad0b-675a-4c13-978e-5ca2b5b877f9`). Complete
   Supabase OAuth only for the organization containing `PsychSift Production`; retain project ref
   `sjrfecxgysukkwxsowpy`, `read_only=true`, and the docs/development-only feature allowlist. Do not broaden the
   production Supabase MCP to write access. Enable Figma or Sentry only for a task that names that
   provider; their write-capable tools remain approval-gated. Railway's OAuth metadata advertises
   `offline_access`; verify the scanned consent includes it and prove refresh behavior with a second
   read-only call after the one-hour access-token lifetime. If no refresh token is issued, require
   reauthentication instead of adding a token workaround.
3. **Start a fresh task.** OAuth tools and environment values are fixed when the task starts. A
   setup rerun inside an already-running offline task can validate a generated connected profile,
   but it cannot inject host MCP tools or retroactively grant OAuth. Restart the MCP client or open
   a new task after consent. When the host exposes its app identifiers, pass that non-secret
   inventory to the environment check with
   `--hosted-app-inventory=github,railway,supabase`. The exact `=` form is required and the option
   may appear only once; every other unsupported argument fails closed. The checker rejects stale
   `railway_cloud`, shared sensitive-token patterns, and identifiers outside its reviewed connector
   allowlist. It normalizes connector-name case and never echoes supplied values. Invalid input
   suppresses capability output rather than printing a misleading unverified state. Inventory
   remains explicitly unverified when the host does not provide it; repository config is never
   substituted for this evidence.
4. **Prove the shell boundary before providers.** First run the direct raw-shell command above
   before profiles or command shims. Then run `npm run check:codex-cloud`,
   `npm run check:codex-cloud -- --runtime`, `npm run check:runtime`, and
   `npm run check:installed-lock-parity`. Confirm the setup-generated
   `CODEX_CLOUD_EXPECTED_BASE_SHA` is a full intended merge-base commit. Require the raw PASS line,
   both Cloud PASS lines, correct runtime/lock
   parity, `CODEX_CLOUD_ACCESS_PROFILE=connected`, no provider variable reported present, and a
   credential-free matching origin. Repository MCP metadata is configuration evidence only.
5. **Prove each provider read-only.** Use the tools exposed by the fresh host session, not shell
   tokens. For GitHub, read repository metadata and confirm `BigSimmo/PsychSift` plus the intended
   identity. For Railway, read workspace/project/service metadata and confirm the IDs above without
   triggering a deployment. Record the exact Railway inventory. Set the app to allow reads and ask
   before changes. The Personal Pro global read-versus-change control does not provide tool-level
   RBAC. If the account later moves to Enterprise/Edu, an admin may additionally allow only
   `whoami`, `list-projects`, `list-services`, `list-feature-flags`, and `get-feature-flag`, while
   disabling write/agent tools and newly discovered actions by default. For Supabase, read
   project/schema metadata and confirm the pinned ref
   without querying clinical row contents. Report only non-secret identity and status metadata.
   OpenAI has no generic connected-profile credential: leave `RAG_PROVIDER_MODE=offline` until a
   separately approved paid canary or protected workflow supplies its own credential boundary.
6. **Publish a task branch safely.** Work on a task-specific non-protected branch. Format, stage, and commit
   the intended repository change, then publish that exact existing commit through the native GitHub
   connector/Cloud PR workflow, and verify the remote branch and PR link. If shell Git
   authentication is intentionally available, `git push --set-upstream origin <task-branch>` is
   acceptable after confirming the credential-free origin; otherwise a failed `git ls-remote` is
   not repaired with an embedded PAT. Do not publish a generic detached `work` branch merely to
   remove an informational "no upstream" warning.
7. **Separate local app proof from live readiness.** Run `npm run ensure`, use the printed URL, and
   confirm `/api/local-project-id` before checking `/api/health`. In demo mode, an HTTP 503 with
   missing Supabase configuration and skipped OpenAI is expected and must not be relabelled healthy.
   Stop only the verified repository-owned server after the check. Production-connected health and
   authenticated tests run through the protected operator/provider workflow below, not by placing
   credentials in the Cloud agent shell.
8. **Treat swap as capacity control, not access setup.** Do not create persistent or ad-hoc swap by
   default. First run the intended full unit suite and production build while observing available
   memory. If they complete without memory pressure, record "swap not required." If a reproducible
   out-of-memory failure remains after using the repository's coordinated single-heavy-command
   workflow, resize the disposable environment or configure swap in the host image; do not commit a
   swapfile, add it under the repository, or rely on an ephemeral in-task swapfile as a durable fix.

Acceptance is complete only when evidence distinguishes these independent capabilities:

| Capability              | Required evidence                                                                      | Not sufficient                                                     |
| ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Connected boundary      | Cloud environment and runtime PASS lines with provider variables absent                | Editing the generated profile in one running task                  |
| GitHub read/write       | Connector repository read plus verified publication of the exact task commit           | Repository discovery, `make_pr` metadata, or a local commit        |
| Railway read            | Exact callable hosted-app tools plus OAuth metadata for the expected workspace/project | Installed Railway CLI or repository MCP config alone               |
| Supabase read           | OAuth-backed metadata for the pinned read-only project                                 | A configured MCP URL without completed OAuth                       |
| OpenAI/live application | Explicitly approved paid canary or protected authenticated workflow                    | Setting `RAG_PROVIDER_MODE=auto` without credentials               |
| Local application       | Project identity plus the reported health status from the `ensure` URL                 | Assuming a localhost port or treating demo 503 as production-ready |
| Capacity                | Full intended checks complete without OOM, or a host-level capacity change is proven   | Swap size by itself                                                |

If a capability still fails, record the exact sanitized failure and its owner: repository setup,
Codex environment/OAuth, provider RBAC, GitHub installation, protected workflow, or host capacity.
Do not collapse those distinct boundaries into a generic "Cloud access" result.

## Authenticated live testing

Do not expose provider credentials to the Codex Cloud agent. Cloud secrets are removed
before the agent phase, and copying them into ordinary environment variables or files
would bypass that security boundary.

Use the manual **Authenticated live tests** GitHub Actions workflow instead. It runs the
repository's explicit `npm run test:live` suite from protected `main`, requires the
`run-authenticated-live-tests` dispatch confirmation, records the run against the
`Database / production` environment, checks the expected Supabase project, and receives
only the GitHub secrets required by the current authenticated Supabase test. It is not
triggered by pushes, pull requests, or schedules.

The suite is not read-only. Dispatching it explicitly authorizes the bounded mutations made
by the E2E user: production sign-in/sign-out, authenticated test requests, and rate-limit
row inserts or updates. It does not authorize unrelated production changes.

To run it after a Codex Cloud change:

1. Merge the reviewed change to `main` through the normal protected workflow.
2. Open **Actions → Authenticated live tests → Run workflow**.
3. Select `main` and choose `run-authenticated-live-tests` after reviewing the disclosed mutations.
4. Review the `Database / production` environment deployment and test log.

As checked on 2026-09-27, the `Database / production` environment lists BigSimmo
as its only required reviewer, permits self-review and administrator bypass, and has no
environment secrets. The workflow's manual dispatch and explicit confirmation authorize
the bounded live-test mutations described above. The configured reviewer may pause this
one environment job, but it does not provide independent approval or gate Railway app
and worker deployments. Verify the current environment settings and an actual waiting
run before relying on a reviewer prompt. See
[`deployment-architecture.md`](deployment-architecture.md#production-release-controls-checked-2026-09-27)
for the release-control scope and steps needed for independent approval.

Adding a future provider to `*.live.test.ts` does not automatically grant its credentials.
Expand the workflow's secret list deliberately and preserve the project/target guard.

## RAG X3 prompt

The corrected structure-only extraction prompt is tracked at
[`prompts/rag-coverage-gate-extraction.md`](prompts/rag-coverage-gate-extraction.md). It
uses the offline profile, keeps private coverage preparation/telemetry helpers in `rag.ts`,
and moves only the independently bounded evaluator. This avoids the import back-edge in the
older proposed three-function extraction.
