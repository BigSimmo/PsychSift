# Cloud platform acceptance

This runbook separates local fixture evidence, an observed native Windows CI run,
and a real forwarded browser preview. None establishes the other two. It changes
no host installation, remote environment, credentials, or clinical configuration.

## Native Windows bootstrap

`.github/workflows/cloud-platform-smoke.yml` runs one bounded `windows-2025` job
on relevant pull-request changes or an explicit manual dispatch. It uses a
read-only checkout without persisted credentials. There is no scheduled run,
browser install, app dependency install, deployment, or duplicated Linux unit job.
The declared npm version is staged below the runner's temporary directory with
install scripts disabled; job-local `APPDATA` makes the existing bootstrap resolve
that CLI. No global npm installation is changed.

```bash
node scripts/check-cloud-platform-smoke.mjs --windows
```

The command refuses to pass outside actual Windows. On Windows it requires Git
for Windows Bash and its native Windows `uname` result; WSL cannot supply this evidence.
It executes the existing `setup-codex-worktree.mjs` and `install-git-hooks.mjs`
inside a disposable Git worktree named `worktree's space`. It verifies the
missing-dependency dry run, complete matching donor selection, actual dependency
copy through Windows robocopy, copied file bytes, installed-tree parity, Git hook
registration, existing-install reuse, and refusal of a mismatched donor. Fixtures
contain tiny synthetic package files and inert hooks; no registry install fallback
is executed. Cleanup removes only the command's newly created temporary directory.

Without `--windows`, the same command exercises the current platform and reports
its actual platform. A Linux pass is local bootstrap evidence. It does not prove
Windows, Codex Desktop settings, cold `npm ci`, a full Windows app build, or the
user's ReFS workstation. The Windows command and workflow must actually finish
successfully before recording native Windows acceptance; authoring the workflow
is not a completed hosted run.

## Identity and synthetic forwarding

```bash
node scripts/run-vitest.mjs run tests/cloud-platform-smoke.test.ts
```

Use the repository's declared Node/npm toolchain. The suite runs the bootstrap
fixture and the actual Playwright base-URL helper against a disposable loopback
HTTP backend through a disposable loopback proxy. It accepts the matching project
payload and refuses a different app, different checkout, or unsafe-origin verdict.
Separate request fixtures exercise the actual local-project guard with forwarding
headers and an unsafe local caller. These tests do not build or attach to an app,
open a public port, use a forwarding provider, or prove TLS/browser behavior.

The unit CI job stages the declared real npm below its runner temporary directory
and supplies `CLOUD_PLATFORM_NPM_HOME` only to the test step. The fixture maps that
home to `APPDATA` only for its bootstrap child, so the existing setup script finds
`npm/node_modules/npm/bin/npm-cli.js` before ambient npm. An explicitly missing or
invalid home fails; the setup script still enforces the repository's exact npm
version. `packageManager` metadata alone does not install that version. Local
callers can use an already installed matching npm on PATH or provide the same
home layout; the fixture installs no toolchain and changes no caller environment.

Current URL behavior in `scripts/playwright-base-url.ts` is:

| Input                                                                                                  | Acceptance and identity                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit `http://localhost:<port>` or `http://127.0.0.1:<port>` with a non-default port                | GET `/api/local-project-id`; require `appName=PsychSift`, checkout-derived `projectId`, and `localServer.safeLocalOrigin=true`. Real app identity marks ports outside 3100–4599 unsafe.                  |
| HTTPS origin with literal `ALLOW_PREVIEW_URL=true`                                                     | Accept any hostname except parsed `localhost`, `127.0.0.1`, or `[::1]` after removing a terminal DNS dot; no remote identity request is performed. Custom HTTPS ports and non-loopback IPs are accepted. |
| HTTP remote host, HTTPS loopback (including trailing-dot localhost), or missing literal preview opt-in | Reject.                                                                                                                                                                                                  |
| Credentials, non-root path, query, fragment, invalid URL                                               | Reject.                                                                                                                                                                                                  |
| Ambient `PREVIEW_URL`, `PLAYWRIGHT_PREVIEW_URL`, or `VERCEL_URL` in shared config                      | Ignore; dedicated preview runner supplies the explicit target and opt-in.                                                                                                                                |

The HTTPS branch has no provider allowlist, DNS ownership check, or authenticated
project identity check. A trailing-dot `https://localhost.` is rejected as the same local host. HTTPS
opt-in authorizes a target; it does not verify a PsychSift deployment.
`SKIP_REMOTE_IDENTITY_CHECK` from the preview runner does not establish identity.

`localProjectRequestIdentityPayload` derives local-host/port classification from
`Request.url`, not `x-forwarded-host` or `x-forwarded-proto`. It retains this
checkout's project ID; a non-local request URL reports `currentUrl=null`,
`currentPort=null`, and a safe local-origin verdict unless an unsafe local
Origin/Referer is present. That verdict protects local port use; it cannot prove
ownership or authenticity of a forwarded remote host.

## Real host forwarding and browser preview

Reuse the existing `.github/workflows/preview-smoke.yml` and
`scripts/run-preview-smoke.mjs` for an explicitly authorized deployed preview.
There is no second remote browser workflow in this change. They run user journeys
against a supplied deployment and do not create a tunnel or prove its ownership.
Retain the repository's provider-confirmation boundary before dispatching them.

For a real forwarding acceptance run, first discover an available supported host
port-forwarding tool. Start/verify the actual app with `npm run ensure`, retain its
printed URL and matching `/api/local-project-id`, request a forwarded URL through
that host tool, then use an available browser capability against that exact URL.
Record the observed host, URL, revision, identity response semantics, and actual
journey result. Do not substitute an HTTPS-shaped string, loopback proxy, mocked
browser, or a deployment URL from another environment as evidence of forwarding.

When the host exposes no supported port-forwarding tool, real forwarded preview
acceptance remains **unavailable**. A browser tool alone cannot create forwarding;
shell access and a loopback server do not expose a public preview. If forwarding
exists but no browser capability does, browser acceptance remains unavailable
separately. Report the missing capability and retain this next acceptance step;
do not install a tunnel service, provision global tooling, use credentials, or
call paid/live providers to manufacture proof.
