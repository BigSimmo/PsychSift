# PsychSift

_Updated 2026-10-08 — corrected documentation guidance; operational evidence retains its original dates._

Local-first medical guideline RAG knowledge base for a psychiatrist in Perth,
Australia. The app uploads private clinical reference documents to Supabase
Storage, indexes text and extracted image captions into pgvector, and answers
questions with source citations that link back to the original PDF/document.

For agent tasks, start with [AGENTS.md](AGENTS.md) and the
[task navigator](docs/agents-guide.md). The [documentation index](docs/README.md)
distinguishes maintained guides, generated views and historical evidence.

## Setup

1. Use Node.js 24.x with npm 11.x. CI runs on Node 24, and `.nvmrc` /
   `.node-version` pin the same runtime for local version managers. CI also runs
   `npm run check:edge:functions`, which requires Deno v2.x.
2. Install dependencies:

```bash
npm ci --include=dev
```

This is the clean-checkout and validation install contract. Use `npm install`
only when intentionally changing dependencies and regenerating
`package-lock.json`.

Codex Desktop worktrees use `npm run setup:codex-worktree`. The local bootstrap
reuses dependencies only from a complete worktree with a byte-identical lockfile,
then validates the installed metadata. It falls back to the locked install above
when no safe local donor exists. Do not configure Windows Desktop worktrees to run
the Cloud-only Bash setup script.

For Codex Cloud, use the tracked environment setup and acceptance contract in
[`docs/codex-cloud.md`](docs/codex-cloud.md). It installs the complete repository
toolchain, installs the profile-loading Node command shims, and distinguishes safe offline
tasks from explicitly connected provider tasks. Fresh Cloud validation runs the direct
`npm run check:codex-cloud` commands without manually sourcing a profile.

3. For offline app development, use a credential-free `.env.local` containing
   `NEXT_PUBLIC_DEMO_MODE=true`. Use the synthetic corpus; leave Supabase and
   OpenAI credentials unset and do not start the ingestion worker. Preserve any
   existing environment file rather than overwriting it. Demo mode is an app
   setting, not a security boundary for workers or arbitrary scripts.
4. For separately authorised connected development, copy the full `.env.example`
   to a new `.env.local` and supply credentials only for the approved target and
   workload. Retain its worker/upload defaults, but do not assume those defaults
   isolate production. Confirm the Supabase target:

This is a provider-backed check. Obtain the required explicit authorisation before
running it; it is not a prerequisite to documentation or other offline-only work.

```bash
npm run check:supabase-project
```

The expected live project is `PsychSift Production`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://sjrfecxgysukkwxsowpy.supabase.co
SUPABASE_PROJECT_REF=sjrfecxgysukkwxsowpy
SUPABASE_PROJECT_NAME=PsychSift Production
```

Do not use the older unused Supabase project `Database`
(`qjgitjyhxrwxsrydablr`). Local checks and runtime guards warn or fall back to
demo mode if that stale ref appears in `.env.local`.

5. Database bootstrap:

- **Existing `PsychSift Production` project:** this is the live project. Normal
  local development does not require a SQL editor bootstrap step. Current schema
  and migration status require the approved live checks; this README is not proof
  that a particular migration has been applied.
- **New staging or fresh database:** with explicit authorisation for the target
  and migration application, link the Supabase CLI to that approved project, then
  apply committed migrations when local and remote histories align. Replace the
  placeholder below with that project's ref; the live ref above is not a staging target:

```bash
npx supabase link --project-ref <approved-staging-project-ref>
npx supabase migration list --linked
npx supabase db push
```

Treat `supabase/schema.sql` as a reconciled reference mirror, not the primary
onboarding path. For drift, repair policy, and live-only caveats, see
`docs/supabase-migration-reconciliation.md` and the retrieval RPC section in
`docs/process-hardening.md`.

6. Install Deno v2.x to run Edge Function type checks
   (`npm run check:edge:functions`). CI installs Deno automatically via
   `denoland/setup-deno`. For local use, follow the
   [Deno installation guide](https://docs.deno.com/runtime/getting_started/installation/)
   and ensure `deno --version` reports a 2.x release.
7. Install optional PDF/OCR worker dependencies:

```bash
python -m pip install -r worker/python/requirements.txt
```

8. Start the demo app:

Run the Next.js app:

```bash
npm run dev
```

The dev command uses a stable project-specific localhost port derived from this
folder path, so it does not silently reuse common ports such as `3000`, `3001`,
or `3002` from another local project. It prints the exact URL every time, for
example `http://localhost:37xx`. If the stable project port is already busy, it
uses the next free localhost port and prints that fallback URL.

For chat-driven work, use:

```bash
npm run ensure
```

This checks whether PsychSift is already running, verifies the local server
belongs to this project, and starts the dev server in the background if needed.
When you say `run` in this chat, Codex should use this command and return the
printed URL.

9. **Connected ingestion only:** after explicit approval for the database,
   workload, provider calls and spending, start the worker in a second terminal:

```bash
npm run worker
```

The Next.js API stores uploads and queues ingestion jobs. The worker performs
heavy parsing, OCR, image captioning, chunking, embedding, and database inserts.
It uses the worker defaults from `.env.example` when those vars are set in
`.env.local`. These defaults do not prevent live database claims or provider calls.

**Docker Compose also requires connected-workload approval.**
`docker compose up --build` starts both the app and ingestion worker and loads
`.env.local` into both. It does not create an isolated local Supabase database.
Production credentials can therefore let the worker consume production jobs.
Use only the explicitly approved target and workload. The Compose app mapping is
`http://localhost:3000`; stop this stack with `docker compose down`. This mapping
does not replace the project-identity checks for development servers above.

### Node.js runtime and lifecycle

`package.json` requires **Node >=24.15.0 <25 and npm 11.x**. The version-manager,
container and CI pins must remain compatible with that contract; Node 22 is not
a supported downgrade. The [official Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)
lists Node 24 end of life as **2028-04-30**. A future runtime migration needs an
intentional dependency/toolchain change and the applicable local and release
checks; this documentation correction changes no runtime pins.

### Codex Cloud

For isolated provider-free Cloud work, create the environment with the exact values in
[`docs/codex-cloud.md`](docs/codex-cloud.md). Its checked-in setup and maintenance
scripts match the Node/npm, Deno, Python/OCR, and Playwright toolchain without copying
local credentials or enabling live provider access.

## Environment Notes

- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it in the browser.
- `SUPABASE_PROJECT_REF` must stay `sjrfecxgysukkwxsowpy` for the live
  `PsychSift Production` project.
- Documents and extracted images are stored in private Supabase buckets.
- Initial assumptions are guideline/reference documents only, not patient
  identifiable records.
- OpenAI receives extracted document text/images for embeddings, image captions,
  and grounded answer generation.
- `MAX_UPLOAD_MB`, `CHUNK_SIZE`, and `CHUNK_OVERLAP` are deliberately
  conservative defaults for local-first indexing.

## Clinical Safety Status

- This project is a clinical reference prototype, not validated clinical
  decision support.
- Demo documents are synthetic and are not clinical guidance.
- Do not upload patient-identifiable documents unless local governance, privacy,
  and data-processing approvals explicitly allow it.
- Generated answers and copied drafts must be verified against linked source
  documents, source status, local policy, and patient context before clinical
  use.
- Production deployment needs clinical governance review, source approval rules,
  and TGA Software as a Medical Device screening where applicable.
- See `docs/clinical-governance.md` for the deployment governance checklist.

## Cursor MCP

### Supabase

This repo ships workspace Supabase MCP config in `.cursor/mcp.json` and agent
skills under `.cursor/skills/supabase*`. Use them for database inspection,
advisors, and docs lookup — not as a replacement for committed migrations.

1. Open **Cursor Settings → Tools & MCP** and enable the `supabase` server.
2. Complete the one-time OAuth flow in your browser. Choose the Supabase org that
   owns **PsychSift Production** (`sjrfecxgysukkwxsowpy`).
3. Reload the window, then verify with a prompt such as: _"List tables using
   Supabase MCP."_
4. Keep **manual tool-call approval** enabled. Review SQL and migration actions
   before they run on live data.
5. Run `npm run check:supabase-project` after any Supabase env or MCP config
   change.

Defaults in `.cursor/mcp.json`:

- `project_ref=sjrfecxgysukkwxsowpy` — scoped to the live `PsychSift Production` Supabase project
  only
- `read_only=true` — safer default for exploration and reviews

Remove `read_only=true` from the MCP URL only when you intentionally need write
access (for example `execute_sql` schema experiments). Prefer the Supabase CLI
and committed migrations for durable schema changes.

Cloud agents do not inherit desktop OAuth automatically. After merging this
config, authenticate MCP in the environment where the cloud agent runs and start
a fresh agent session.

Never put `SUPABASE_SERVICE_ROLE_KEY` or other secrets into MCP config. The
hosted Supabase MCP server uses OAuth, not repo secrets.

### Context7

Use the shared [Context7 guide](docs/agents/context7.md) for library resolution,
version matching, MCP/CLI authentication and query privacy. The checked-in
Cursor integration is local `@upstash/context7-mcp@3.2.5`; a selected hosted
connector has separate authentication. For Next.js APIs, read the installed
`node_modules/next/dist/docs/` as required by `AGENTS.md`. Never include patient
information or private document content in documentation queries.

### Figma

The Cursor **Figma** plugin plus `.cursor/mcp.json` (`https://mcp.figma.com/mcp`)
give design ↔ code access (capture live UI, read/write frames, Code Connect).
Enable the plugin / MCP server, complete browser OAuth once, then verify with a
prompt such as: _"Call Figma whoami and report only handle and plan tier."_

**Cursor Cloud Agents:** official Figma remote MCP is **not supported** there today
(Cloud/Automations return Forbidden; OAuth from desktop does not carry over). Use
**Cursor Desktop** (or Codex with its Figma plugin) for Figma MCP. Repo
`.cursor/mcp.json` still helps the IDE; it does not unlock Cloud Agents. Details:
`docs/agents-guide.md`, `docs/codex-cloud.md`.

## Documentation

Process and freshness (Documentation agent): [`docs/DOCS-SYSTEM.md`](docs/DOCS-SYSTEM.md) — pipeline, doc classes, recheck triggers, PsychSift registry.

Full categorized index: `docs/README.md` (maintained docs vs point-in-time
records vs archive). The most load-bearing entries:

- `docs/codebase-index.md` — architecture and module map (start here)
- `docs/site-map.md` — generated route map (`npm run docs:update`)
- `docs/process-hardening.md` — verification gates, CI expectations, known limits
- `docs/testing.md` — local test safety, focused/live commands, Playwright ownership, flake policy
- `docs/codex-cloud.md` — reproducible provider-free Codex Cloud setup and acceptance check
- `docs/clinical-governance.md` — deployment and source governance checklist
- `docs/deployment-architecture.md` — app/worker/Supabase deployment topology
- `docs/supabase-migration-reconciliation.md` — migration drift and repair policy

Run `npm run docs:check-links` to verify repo paths referenced from the
maintained docs still resolve.

## Commands

Verification gates (see `package.json` for the full chain):

```bash
npm run verify:cheap    # ordinary offline gate: check:installed-lock-parity
                        # + lint + typecheck + test (nothing else)
npm run verify:full     # 41 static/consistency gates (check:runtime through
                        # check:instructions; `npm run check:gate-manifest`
                        # lists them from verify:full:internal) then lint +
                        # typecheck + test — does not invoke the cheap script
npm run verify:pr-local # risk-routed PR mirror: focused docs/workflow contracts
                        # for recognised light scope; fail-closed lint/typecheck/
                        # full unit (+ build/domain) for executable or unknown
                        # scope. Inspect with `-- --dry-run --files <paths>`
npm run verify:ui       # check:runtime + required production Chromium journeys
npm run verify:release  # check:runtime + lint + typecheck + test + build + test:e2e
                        # + check:production-readiness + governance:release
                        # + eval:quality:release (needs live Supabase + OpenAI keys)
```

Use `npm run verify:pr-local -- --dry-run --files <comma-separated paths>` to
inspect which checks a change would trigger without running them.

CI is risk-scoped (`.github/workflows/ci.yml`): a `changes` job classifies
changed paths, `static-pr` always runs a small baseline (runtime alignment,
installed-lock parity, the CI-scope and verification-plan self-tests, diff
integrity, and the changed-file format check) and selects the rest — the
action-pin check, lint, typecheck, and the other static gates — by change
scope, and `pr-required` is the single
always-reporting required aggregate (required PR checks are Gitleaks plus that
aggregate). One full unit run with coverage, build, safety/config checks, the
production Chromium gate, the repo-owned Supabase `db-reset-verify` migration
replay, and both Docker image builds run only when their file scopes apply; a
failed applicable container build therefore fails `pr-required`. UI PRs also
get one non-blocking advisory Chromium invocation. The full Playwright browser matrix
(`release-browser-matrix`) runs on `main`, `release/*`, manual dispatch, and a
weekly schedule. Live drift and live eval canary checks remain provider-gated;
Docker image builds also run independently on main/release pushes, schedule,
and manual dispatch. They are not required for source-only PRs outside the
container scope.

```bash
npm run dev       # Next.js UI/API on this project's stable localhost port
npm run ensure    # check/start this project's dev server in the background
npm run start     # production preview on the same safe port selection
npm run worker    # local ingestion worker
npm run check:supabase-project
npm run check:production-readiness # run production readiness validation preflight
npm run check:production-readiness:ci # CI-safe readiness preflight (env-absent tolerant)
npm run samples   # generate synthetic upload corpus
npm run samples:check
npm run lint
npm run typecheck
npm run test
npm run test:focused -- --files src/lib/example.ts
npm run test:live # requires ALLOW_PROVIDER_TESTS=true
npm run test:coverage
npm run test:e2e
npm run test:e2e:pr
npm run test:e2e:advisory
npm run test:e2e:all
npm run test:e2e:accessibility
npm run test:e2e:chromium
npm run test:e2e:visual
npm run check:deployment-readiness
npm run format
npm run format:check
npm run build
```

You can still override the port explicitly when needed:

```bash
PORT=4200 npm run dev
npm run dev -- --port 4200
```

On Windows PowerShell:

```powershell
$env:PORT = "4200"; npm run dev
npm run dev -- --port 4200
```

When multiple chats or projects are open, use the URL printed by the command
instead of assuming a shared address such as `http://localhost:3000`.
Codex should also run `npm run ensure` before browser QA or before handing you a
local app link after meaningful frontend changes.

`npm run ensure` starts its dev server detached, so it keeps running after the
task/session that launched it ends. To stop these from accumulating, that
server self-exits after 45 minutes with no request or build activity by
default. Override with `DEV_SERVER_IDLE_MINUTES` (a plain `npm run dev` you
run interactively is unaffected unless you set it yourself); `0` disables the
idle shutdown entirely.

## Sample Corpus

Run `npm run samples` to generate synthetic documents under
`sample-documents/`. They cover PDF, DOCX, XLSX, TXT, PDF image extraction, and
a scanned-style PDF for OCR fallback testing. Upload those files through the UI
and start `npm run worker` to index them. The sample content is deliberately
synthetic and must not be used as clinical guidance.

`sample-documents/` is generated local test output and is intentionally ignored
by Git. The smaller `public/demo-documents/` set is tracked because the app uses
it for demo-mode source and image rendering when live Supabase setup is
unavailable.

## Security

Report vulnerabilities privately — see `SECURITY.md`. Do not open a public issue for
a security problem. Threat models and the privacy assessment live under `docs/`
(`rag-injection-threat-model.md`, `audit/tenancy-defense-in-depth-review.md`,
`privacy-impact-assessment.md`).

## License, ownership, and contributions

Copyright (c) 2026 BigSimmo, for material owned by or validly assigned to the
Repository Owner. Other rightsholders retain their respective rights. All
rights reserved.

This repository is publicly visible for inspection, but Repository
Owner-controlled material is proprietary, is not open source, and is not in the
public domain. No permission is granted to use, run, copy, modify, redistribute,
deploy, commercialise, scrape, or use that material for AI or machine-learning
development except as required by GitHub's applicable terms, applicable law, or
express prior written permission.

See [`LICENSE`](LICENSE) for the proprietary rights notice,
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the ownership boundary
and embedded licences, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the signed
assignment requirement that applies before an external contribution may be
merged. The `"license": "UNLICENSED"` declaration in `package.json` is
intentional.
