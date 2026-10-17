# Claude Code on the web — container parity

This document describes the repository's Claude web container provisioner. Inspect the current
host's permissions, tools and installed dependencies before relying on it; a fresh container need
not have the same capabilities as an earlier one. Workstation home files, credentials and services
do not automatically transfer. Earlier missing-tool incidents motivated this provisioner.
The Codex Cloud equivalent is
[codex-cloud.md](codex-cloud.md); the two are deliberately separate environments with separate
provisioners.

## What runs, and when

`.claude/settings.json` registers one sequential orchestrator,
`bash "$CLAUDE_PROJECT_DIR/scripts/claude-session-start.sh"`, with a 1,300-second timeout.
It bootstraps Node/dependencies through `.claude/hooks/session-start.sh`, then runs
`scripts/claude-session-start.mjs` with that runtime. The runner executes Cloud setup, base
freshness, issues, testing-policy and organisation context in order and emits one SessionStart
context envelope. Hook registration order is not used as a scheduling guarantee.

Provisioning runs only when `CLAUDE_CODE_REMOTE=true`; local sessions retain the context hooks.
Bootstrap failure skips dependent provisioning and reports the failure without failing the
session. Readiness must be checked before relying on any affected tool. The remote marker selects
execution; it does not attest setup success or provider authority.

## The tiers

`scripts/setup-claude-cloud.sh` is tiered, marker-guarded and idempotent. A warm container re-runs in
about a second; a cold one can be resumed after an interrupted run without redoing completed work.

All selected tier names, including session and background overrides, are validated before any tier
runs. Listing tiers and the local no-op path create no cache or profile state. Cached `gh` and `deno`
markers also require their commands to work; Deno must still report major version 2. Python
receipts require the actual Python 3.12 interpreter, OCR imports and Tesseract. Python activation
is separate from installation caching: each session receives its own PATH/PYTHON_BIN exports,
including a warm cache hit. A marker alone is not current runtime evidence.

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

`.claude/cloud-profile/` is a reviewed portable seed. The applier installs it into the selected
`CLAUDE_CONFIG_DIR`, falling back to `~/.claude`. Plugin repair and cache signatures use that same
selected directory. Prefer a separate configuration home for each source checkout when a host is
shared; project instructions continue to own project behavior.

The `.cloud-profile-install.json` manifest binds the selected directory to its source checkout
and records managed file hashes and setting values. Updates reconcile this ownership record:

| Path                            | Update and retirement behavior                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `CLAUDE.md` and `skills/` files | Install absent files; update/retire unchanged owned files; preserve host modifications |
| Profile settings                | Add missing keys; update/retire unchanged owned values; preserve other host settings   |
| Project memory seeds            | Copy listed seeds only when absent; never claim ownership or remove host memory        |

A different source checkout, differing unmanaged file or conflicting host setting causes an
explicit refusal before the planned file changes. Use an isolated configuration home rather than
overwriting another installation. To adopt an older installation, inspect a dry run and use
`--adopt` only for byte-identical unmanaged files/settings. Adoption does not authorize replacing
host edits. Modified owned entries remain recorded and reported for review.

Plugins-only setup requires an existing manifest owned by this checkout. For a fresh or legacy
configuration home, install the profile first (or explicitly adopt identical legacy content)
before running the plugins tier. A read-only ownership check never claims an unowned home.

Use `node scripts/apply-claude-cloud-profile.mjs --dry-run` to inspect an update and add
`--uninstall --dry-run` to inspect retirement. Remove `--dry-run` only for an authorized selected
host operation. Uninstall removes only unchanged owned content; it preserves modified files,
unowned resources and all personal memory. A different checkout must use a separate home or
retire the original installation from its owning checkout first. Operations serialize with a
configuration-local lock; interrupted operations require inspection, not deletion of unknown host
files. A retained modified entry can leave the ownership record in place after uninstall.

Any part can be skipped with `--skip=settings,claude-md,skills,memory` (choose only the intended
parts). Local execution still requires `--force`; that flag does not bypass ownership checks.
See [Cloud instruction activation](agents/cloud-instruction-activation.md) for the distinction
between a repository update, host reconciliation and loaded chat context.

The memory seed directory carries curated reusable guidance and dated examples. Its
`seed-manifest.json` lists the only Markdown files the applier may copy. The manifest must use
unique plain filenames naming existing regular files and must include `MEMORY.md`; index links
must refer to listed seeds. Invalid manifests or index links reject the selected profile before
settings, instructions or skills are changed. An unlisted
file placed in the source directory is not installed, and the archive is never a fallback source.
Keep the manifest, reviewed seed content and seed index aligned when refreshing the profile.

The seed directory must not copy old coordination boards, open-task queues, workstation locations or prior session authority
into a new host. The seven records retired on 2026-10-16 are preserved byte-for-byte in
[the Cloud session-state archive](archive/cloud-session-state-2026-10-16/README.md), outside the
applier's source directory. Their original dates and links remain historical evidence.

This source cleanup affects fresh seeding only. Existing host-authored memories and indexes are
preserved, including files with retired seed names. The applier neither purges host memory nor
rewrites an existing `MEMORY.md`; do not claim that updating this repository cleans an already
provisioned host. Follow the current repository instructions and verify current task facts when
retained memory disagrees.

Three rules are load-bearing:

- **Settings are merged, never replaced.** Whatever the platform put in `~/.claude/settings.json` —
  auth state, machine ids, feature flags — survives. Only absent or unchanged owned profile values
  are installed or updated; conflicting unmanaged values are preserved and reported.
- **Memories are never clobbered.** The copy is skip-if-present to preserve host-written work.
  Existence or recency does not make memory authoritative; current instructions and verified facts
  win when content conflicts. Correcting host memory requires its applicable exact-content approval.
- **The applier refuses to run unless `CLAUDE_CODE_REMOTE=true`**, or `--force` is passed. The
  operator's real `~/.claude` is the _origin_ of this snapshot; overwriting it with a copy of itself
  would replace user-owned guidance; the installer now refuses those collisions. `scripts/setup-claude-cloud.sh` carries
  the same guard, needing `--allow-local` to provision a non-cloud machine.

### Refreshing the snapshot

The profile is a snapshot, not a live link — it goes stale as the workstation configuration changes.
Refresh it deliberately by reviewing the current `~/.claude/CLAUDE.md` and selected `~/.claude/skills/*`
(resolving symlinks into `~/.agents/skills`) before copying portable content into `.claude/cloud-profile/`.
Retain reviewed repository adaptations, including current-tool routing and same-task continuation;
a workstation copy must not restore stale model inventories, mandatory remote setup or unavailable
commands. These vendored files are maintained here; changing them does not update their external origin. Review project
memories individually and copy only reusable guidance, checking the seed index too. Preserve
dated session records in `docs/archive/` instead of importing a workstation's entire memory
directory as active guidance. Commit the reviewed source changes through the authorised workflow.
Keep `settings.json` hand-maintained: the workstation copy carries Windows-only entries
(the Shellular notification hook, Desktop Commander MCP permissions) that
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

A partial checkout may omit the skills tree. Fresh installation tolerates that absence, but an
existing installation with owned skills refuses ambiguous whole-tree absence. Use `--skip=skills`
for that partial checkout; `--uninstall` is the explicit retirement route. Removing individual
source files, or deliberately retaining an empty source skills directory, retires unchanged owned
files. Host modifications remain preserved. Fixture tests cover these distinct cases.

## What still needs a human

Provisioning cannot supply credentials or authorise connections. In a fresh cloud container:

1. **Credentials and provider authority.** Earlier Claude web documentation described shared-readable
   environment variables and no dedicated secrets store. Treat that as historical platform evidence,
   not proof of the current host's account settings. Inspect supported host metadata and current
   documentation when authorised; never inspect credential values to establish readiness or paste
   secrets into a shared-readable variables box.

   Demo mode is the default when Supabase and OpenAI configuration is absent: `isDemoMode()` serves
   synthetic data. Live/provider work needs applicable user authority, a supported authenticated
   route and the project safeguards. The provider-confirmation boundary applies on every host;
   it does not assume that the work happens on a workstation. Provisioning grants no such authority.

   Live mode would need `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PROJECT_NAME`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY`, plus
   `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` for browser journeys. `SUPABASE_SERVICE_ROLE_KEY` bypasses
   row-level security on a database holding clinical documents, so it is the one value that should
   never be pasted into a shared-readable box under any circumstances.

2. **GitHub access must be verified for the current session.** The `gh` tier installs a binary;
   it does not log it in or prove connector access. Git transport, shell REST/GraphQL and hosted
   connectors can have separate permissions. Prefer currently callable authenticated connectors
   for authorised work; no token copying or login repair is implied by this runbook.

   **Historical session, 2026-08-21:** injected GitHub REST access worked while selected GraphQL
   operations failed. The following records that session's limits and alternatives, not a current
   guarantee or authority to make those calls.

   In that session, `gh` GraphQL was refused with `HTTP 403: This GraphQL query is not enabled for this session — only
the pinned set of PR-review operations is served. Use REST via gh api repos/{owner}/{repo}/...`.
   That also affected subcommands that looked purely RESTful: `gh pr create` and
   `gh pr view` failed on their GraphQL repo-info preamble before doing any work. The error
   named GraphQL rather than the subcommand, which looked like a broken install rather than
   a scoped permission.

   What worked in that session, all through the injected credential: reading pull requests and their
   commits, files and check runs; posting a review-thread reply; deleting a review comment; and
   creating a pull request. That session used REST or GitHub MCP tools for those operations:

   ```bash
   gh api repos/{owner}/{repo}/pulls/{n} --jq '{state,merged,mergeable_state}'
   gh api repos/{owner}/{repo}/commits/{sha}/check-runs --jq '.check_runs[].name'
   # PR creation, replacing `gh pr create`: build the JSON body, then POST it
   gh api repos/{owner}/{repo}/pulls --method POST --input payload.json
   ```

   Review-thread **resolution** needed GraphQL and that mutation was outside the pinned set.
   The session used the hosted `resolve_review_thread` GitHub MCP tool instead. Verify current tool names and argument schemas;
   do not assume `resolve_review_thread` or `pull_request_read` exists on the current host.

   Treat the pinned set as liable to change: prefer the MCP tools when they cover the job, and fall
   back to REST rather than assuming a GraphQL path will keep working.

3. **MCP sign-in.** Tracked MCP files are secret-free templates, not proof of hosted registration,
   authentication or loaded tools. Keep disabled-by-default servers disabled and preserve the
   Supabase project/read-only feature scope. Inspect actual callable tools; a hosted connector
   configured through supported account settings is a separate route. Browser OAuth and connector
   support vary by host. Neither this document nor provisioner activation grants provider access.
4. **Plugins.** The supported route is the repository's `.claude/settings.json`: Claude Code installs
   anything in its `enabledPlugins` from the declared `extraKnownMarketplaces` when the session
   starts, where supported by the current host. Verify actual installation and loaded skills.
   The `plugins` tier is a repair path and runs `npm install` inside each plugin because earlier
   installs omitted runtime dependencies. Check current readiness before choosing that repair.
   Installation is separate from activation; use a supported reload or fresh session if required
   by the current host.
5. **Network egress for Playwright browsers and CI traces.** Earlier containers used a proxy at
   `/root/.ccr/` and blocked the mirrors below. These are recorded observations, not a diagnosis of
   this host. Check current network policy and dependency versions before proposing a repair;
   preserve host proxy/CA settings and do not bypass a denied route.

   **Hostnames blocked in the recorded environment (verified then by request):**
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
   If the current authorised workflow needs these hosts and current evidence confirms they are blocked,
   the operator can review the applicable environment egress settings for:
   - `cdn.playwright.dev`
   - `playwright.download.prss.microsoft.com`
   - `*.blob.core.windows.net`

   The earlier operator request was tracked under task `#PM71Z1`; recheck its current status rather
   than treating this record as an open task. Any host-policy change needs applicable authority.

## What cannot be replicated

The historical workstation used Desktop Commander, a Docker MCP toolbox, the frontend-checklist MCP
server, Claude in Chrome, computer-use and the Shellular notification hook. Their workstation
configuration does not transfer through this provisioner. Check current host tools instead of
assuming either their availability or permanent absence.

Cloud browser evidence is Playwright/Chromium, Firefox or WebKit container evidence. It does not close
physical Safari or installed-PWA acceptance gaps — the same limit `codex-cloud.md` records.
