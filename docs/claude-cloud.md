# Claude Code on the web — container parity

Claude Code on the web runs in a disposable Linux container that starts with the repository checkout
and nothing else. Everything that lives in the operator's Windows home directory is absent, and so are
Playwright, Python, Tesseract, Deno and the GitHub CLI. That is why a cloud session used to behave
noticeably differently from a local one, and why browser proof and worker checks failed there.

This document is the contract for closing that gap. The Codex Cloud equivalent is
[codex-cloud.md](codex-cloud.md); the two are deliberately separate environments with separate
provisioners.

## What runs, and when

`.claude/settings.json` registers two `SessionStart` hooks in order:

| Order | Command                                   | Timeout | Does                                               |
| ----- | ----------------------------------------- | ------- | -------------------------------------------------- |
| 1     | `.claude/hooks/session-start.sh`          | 900s    | Installs Node 24 to `$HOME/.node24`, then `npm ci` |
| 2     | `scripts/setup-claude-cloud.sh --session` | 300s    | Everything below                                   |

Both no-op instantly unless `CLAUDE_CODE_REMOTE=true`, so a local Windows session is untouched.

## The tiers

`scripts/setup-claude-cloud.sh` is tiered, marker-guarded and idempotent. A warm container re-runs in
about a second; a cold one can be resumed after an interrupted run without redoing completed work.

| Tier       | Installs                                                                                 | Cost when cold |
| ---------- | ---------------------------------------------------------------------------------------- | -------------- |
| `profile`  | The checked-in user profile (see below)                                                  | under a second |
| `plugins`  | sentry, superpowers, episodic-memory, elements-of-style, **plus their npm dependencies** | seconds        |
| `gh`       | GitHub CLI binary — see the authentication caveat below                                  | seconds        |
| `deno`     | Deno 2, for Supabase Edge Functions                                                      | seconds        |
| `browsers` | Playwright Chromium + Firefox + WebKit, with system deps                                 | minutes        |
| `python`   | Tesseract, Python 3.12 venv, `worker/python/requirements-cloud.txt`                      | minutes        |

**Split by cost, not by importance.** The first four run inline, because the profile in particular has
to land before the model does anything. `browsers` and `python` are launched **detached**: a cold
Playwright matrix plus the hash-pinned spaCy/medspaCy wheel set is ten-plus minutes, far too long to
hold a session open for. Neither writes into the repository or `node_modules` — browsers land in
`~/.cache/ms-playwright` and the OCR venv in `~/.cache/clinical-kb-claude-cloud` — so they cannot race
a build or test the model starts meanwhile.

> **Network egress requirement for `browsers` tier**: Provisioning Playwright browsers and downloading
> retained CI trace artifacts requires container network access to Playwright CDNs and Azure Blob storage.
> If egress is blocked, browser downloads fail with HTTP 403. See [What still needs a human §5](#what-still-needs-a-human).

**A background tier is not proof.** Before trusting any browser or worker result in a fresh container,
confirm the tier finished:

```bash
bash scripts/setup-claude-cloud.sh browsers python
```

That re-runs in a second if the markers are already good, and reports what is missing if they are not.
The provisioning log is `~/.cache/clinical-kb-claude-cloud/setup.log`.

### Running tiers by hand

```bash
bash scripts/setup-claude-cloud.sh              # every tier
bash scripts/setup-claude-cloud.sh browsers     # one tier
bash scripts/setup-claude-cloud.sh --force gh   # ignore the marker and redo
bash scripts/setup-claude-cloud.sh --list       # tier names
```

Environment overrides: `CLAUDE_CLOUD_SKIP_TIERS` (comma-separated), `CLAUDE_CLOUD_SESSION_TIERS` and
`CLAUDE_CLOUD_BACKGROUND_TIERS` (which tiers the hook runs inline versus detached — set either to an
empty string to disable it), and `CLAUDE_CLOUD_BROWSERS`.

## The checked-in user profile

`.claude/cloud-profile/` is a snapshot of the operator's user-level Claude Code configuration. The
repository cannot reach into a Windows home directory, so the snapshot travels in-tree and
`scripts/apply-claude-cloud-profile.mjs` unpacks it into the container's `~/.claude`.

| Path                                  | Becomes                             | Merge rule                                 |
| ------------------------------------- | ----------------------------------- | ------------------------------------------ |
| `.claude/cloud-profile/CLAUDE.md`     | `~/.claude/CLAUDE.md`               | Replaced; any existing copy backed up once |
| `.claude/cloud-profile/settings.json` | `~/.claude/settings.json`           | **Deep-merged**, profile wins per key      |
| `.claude/cloud-profile/skills/`       | `~/.claude/skills/`                 | Replaced per skill                         |
| `.claude/cloud-profile/memory/`       | `~/.claude/projects/<slug>/memory/` | Copied **only when absent**                |

Any part can be skipped for a targeted re-run —
`node scripts/apply-claude-cloud-profile.mjs --skip=skills,memory` — and `--dry-run` reports without
writing.

Three rules are load-bearing:

- **Settings are merged, never replaced.** Whatever the platform put in `~/.claude/settings.json` —
  auth state, machine ids, feature flags — survives. Only the profile's own keys are imposed.
- **Memories are never clobbered.** A memory the container writes during a session is newer than the
  snapshot and must win, so the copy is skip-if-present. Clobbering would silently delete work.
- **The applier refuses to run unless `CLAUDE_CODE_REMOTE=true`**, or `--force` is passed. The
  operator's real `~/.claude` is the _origin_ of this snapshot; overwriting it with a copy of itself
  is the one genuinely destructive thing this tooling could do. `scripts/setup-claude-cloud.sh` carries
  the same guard, needing `--allow-local` to provision a non-cloud machine.

### Refreshing the snapshot

The profile is a snapshot, not a live link — it goes stale as the workstation configuration changes.
Refresh it deliberately by copying the current `~/.claude/CLAUDE.md`, `~/.claude/skills/*` (resolving
the symlinks into `~/.agents/skills`) and the project's memory directory back into
`.claude/cloud-profile/`, then commit. Keep `settings.json` hand-maintained: the workstation copy
carries Windows-only entries (the Shellular notification hook, Desktop Commander MCP permissions) that
must **not** be pushed into a Linux container.

Two things about `skills/` in particular:

- **It is a filtered copy, not a mirror.** `docx` and `xlsx` are deliberately excluded — together they
  are roughly 47,000 lines of Office-document authoring guidance, and a container that does code,
  tests, docs and review has no use for either. A refresh that copies `~/.claude/skills/*` wholesale
  will drag them back in; drop them again before committing. Add the same exclusion for any other
  skill whose whole purpose is a workstation-only capability.
- **It is vendored third-party content, so it travels on its own.** The tree is around 90,000 lines
  across 400 files that nobody reviews line by line, and mixing it into a change carrying real code
  puts the whole diff past what review tooling will read at all — CodeRabbit declines a pull request
  over 150 files. Land a snapshot refresh as its own pull request, separate from any code change to
  the provisioner or the applier.

Because the tree can legitimately be absent from a checkout mid-refresh, nothing may assume it is
there: `scripts/apply-claude-cloud-profile.mjs` copies skills only when the directory exists, and
`tests/claude-cloud-profile.test.ts` states which of its assertions need the tree rather than failing
on a valid intermediate state. Both properties are pinned by that test file.

## What still needs a human

Provisioning cannot supply credentials or authorise connections. In a fresh cloud container:

1. **Credentials — and cloud has nowhere safe to put them.** A cloud environment's variables box is
   not a secrets store: Anthropic's own guidance is not to put API keys or credentials there, because
   every value is readable by anyone using the environment, and `Static API tokens and credentials`
   is listed as unavailable in cloud sessions with "no dedicated secrets store exists yet". Nothing
   in this repository can change that.

   So treat **demo mode as the normal cloud posture.** With Supabase and OpenAI configuration absent,
   `isDemoMode()` serves the synthetic corpus and the app works — that is designed behaviour, not a
   failure. Cloud is then good for code, tests, docs and review, and is simply not where live-data or
   provider-backed work happens; that stays on the workstation, which is also where the
   provider-confirmation rules in `AGENTS.md` assume it happens.

   Live mode would need `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PROJECT_NAME`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY`, plus
   `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` for browser journeys. `SUPABASE_SERVICE_ROLE_KEY` bypasses
   row-level security on a database holding clinical documents, so it is the one value that should
   never be pasted into a shared-readable box under any circumstances.

2. **`gh` is installed and authenticated — but only REST is served.** The `gh` tier puts the binary on
   `PATH`; it does not log it in. Anthropic keeps git credentials outside the sandbox deliberately —
   cloning, branching and pushing go through a credential proxy — so the container holds no token of
   its own. This entry used to predict that `gh api` / `gh pr` would therefore fail on
   authentication, and record that as unverified. **A real session settled it on 2026-08-21, and the
   prediction was wrong in a way worth knowing:** the platform does inject GitHub access, `gh api`
   REST calls succeed, and the wall is at the API layer instead.

   `gh` GraphQL is refused with `HTTP 403: This GraphQL query is not enabled for this session — only
the pinned set of PR-review operations is served. Use REST via gh api repos/{owner}/{repo}/...`.
   The trap is that this takes out subcommands that look purely RESTful: `gh pr create` and
   `gh pr view` both fail on their GraphQL repo-info preamble before doing any work, and the error
   names GraphQL rather than the subcommand, so it reads like a broken install rather than a scoped
   permission.

   What worked in that session, all through the injected credential: reading pull requests and their
   commits, files and check runs; posting a review-thread reply; deleting a review comment; and
   creating a pull request. Use REST or the GitHub MCP tools and none of it is blocked:

   ```bash
   gh api repos/{owner}/{repo}/pulls/{n} --jq '{state,merged,mergeable_state}'
   gh api repos/{owner}/{repo}/commits/{sha}/check-runs --jq '.check_runs[].name'
   # PR creation, replacing `gh pr create`: build the JSON body, then POST it
   gh api repos/{owner}/{repo}/pulls --method POST --input payload.json
   ```

   Review-thread **resolution** is the one job REST cannot do — it is GraphQL-only, and that mutation
   is outside the pinned set. Use the `resolve_review_thread` GitHub MCP tool, which reaches GitHub
   through Anthropic's servers rather than the container, and takes a thread node id from
   `pull_request_read` with `method: "get_review_comments"`.

   Treat the pinned set as liable to change: prefer the MCP tools when they cover the job, and fall
   back to REST rather than assuming a GraphQL path will keep working.

3. **MCP sign-in.** `.mcp.json` declares the Railway and Supabase HTTP servers and
   `.claude/settings.json` enables them, so both reach a cloud session. Authenticating them there is
   a separate matter. Anthropic documents browser-based interactive auth as unsupported in cloud
   sessions, so the in-container OAuth path is doubtful. The route that does work is a **claude.ai
   connector**: connectors added at claude.ai/customize/connectors authenticate once in your browser
   on the claude.ai side, and their traffic reaches a cloud session through Anthropic servers rather
   than the container network. Prefer a connector over the `.mcp.json` entry for anything you need in
   cloud, and treat the `.mcp.json` route as unverified there.
4. **Plugins.** The supported route is the repository's `.claude/settings.json`: Claude Code installs
   anything in its `enabledPlugins` from the declared `extraKnownMarketplaces` when the session
   starts. That is what makes plugins work here. The `plugins` tier is a repair path for when that
   install does not happen, and it also runs `npm install` inside each plugin, which the installer
   itself does not do — a plugin with runtime dependencies otherwise unpacks clean and fails at first
   use. A tier-installed plugin only takes effect in the _next_ session.
5. **Network egress allowlist for Playwright browsers and CI traces.** In Claude Code on the web
   (`CLAUDE_CODE_REMOTE=true`), container egress is mediated by Anthropic's network proxy (`/root/.ccr/`).
   The default egress policy blocks the mirrors needed for Playwright browser installation and GitHub
   Actions trace artifact downloads.

   **The three blocked hostnames (verified by request, not inferred):**
   - `cdn.playwright.dev` (returns `HTTP 403 request blocked`): Primary mirror in `playwright-core@1.63.0`'s
     `PLAYWRIGHT_CDN_MIRRORS`. Without access, `scripts/setup-claude-cloud.sh browsers` fails to download
     Chromium, Firefox, and WebKit binaries.
   - `playwright.download.prss.microsoft.com` (returns `HTTP 403 request blocked`): Secondary ESRP CDN
     mirror in `playwright-core@1.63.0`. The legacy `*.azureedge.net` endpoints were removed in this version,
     so allowlisting those achieves nothing.
   - `*.blob.core.windows.net` (returns `CONNECT tunnel failed 403`): GitHub Actions artifact downloads
     redirect to Azure Blob storage. When blocked, retained Playwright trace artifacts (`playwright-traces-*`)
     cannot be fetched for failure triage (e.g. debugging Firefox click state failures in #33346A).

   **Why system packages are not a substitute:**
   Stock Debian/Ubuntu apt packages or tarballs for Firefox cannot substitute for Playwright's browser:
   Playwright launches Firefox with `-juggler-pipe` and waits for `Juggler listening to the pipe`, which
   only its custom-patched build emits. The repo's `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` override is custom
   and Chromium-only (pointing to `/opt/pw-browsers/chromium` in fallback containers), but that fallback is
   Chromium 141, which lacks modern V8 runtime features (such as `Map.prototype.getOrInsertComputed` required
   by `pdfjs-dist@6.3.289`, causing document-viewer failures in `tests/ui-smoke.spec.ts`).

   **Remediation (Operator environment configuration):**
   Add the following hostnames to the Claude Cloud environment egress allowlist in container network settings:
   - `cdn.playwright.dev`
   - `playwright.download.prss.microsoft.com`
   - `*.blob.core.windows.net`

   This is an operator configuration in the Claude Cloud environment settings (tracked under task `#PM71Z1`);
   no repository code change is required.

## What cannot be replicated

Desktop Commander, the Docker MCP toolbox, the frontend-checklist MCP server, Claude in Chrome,
computer-use, and the Shellular desktop notification hook are all bound to the Windows workstation.
Cloud sessions will not have them, and no provisioning step can change that.

Cloud browser evidence is Playwright/Chromium, Firefox or WebKit container evidence. It does not close
physical Safari or installed-PWA acceptance gaps — the same limit `codex-cloud.md` records.
